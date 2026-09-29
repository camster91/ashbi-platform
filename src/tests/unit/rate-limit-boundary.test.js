import test from 'node:test';
import assert from 'node:assert/strict';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import {
  API_RATE_LIMIT_OVERRIDE_CEILING,
  DEFAULT_API_RATE_LIMIT_MAX,
  DEFAULT_API_USER_RATE_LIMIT_MAX,
  apiRateLimitKey,
  apiRateLimitMax,
  apiUserRateLimitMax,
  createApiRateLimitMax,
  createRateLimitRedis,
  isNonApiRequest,
} from '../../config/rateLimit.js';

test('frontend and static requests are excluded from the global API limiter', () => {
  for (const url of ['/', '/search', '/assets/app.js', '/icon-192.png', '/sw.js']) {
    assert.equal(isNonApiRequest({ raw: { url } }), true, url);
  }
});

test('API requests remain protected, including queries and the API root', () => {
  for (const url of ['/api', '/api/', '/api/search?q=test', '/api/auth/login']) {
    assert.equal(isNonApiRequest({ raw: { url } }), false, url);
  }
  assert.equal(isNonApiRequest({ raw: { url: '/apiary' } }), true);
});

test('liveness and readiness probes are never exhausted by the API limiter', () => {
  for (const url of ['/api/live', '/api/health', '/api/health?source=probe']) {
    assert.equal(isNonApiRequest({ raw: { url } }), true, url);
  }
});

test('the per-IP API limit defaults to 100 and only accepts a positive override', () => {
  assert.equal(DEFAULT_API_RATE_LIMIT_MAX, 100);
  assert.equal(apiRateLimitMax(undefined, 'test'), 100);
  assert.equal(apiRateLimitMax('', 'test'), 100);
  for (const invalid of ['0', '-5', 'many']) assert.equal(apiRateLimitMax(invalid, 'test'), 100, invalid);
  assert.equal(apiRateLimitMax('2000', 'test'), 2000);
});

test('an override is clamped to the ceiling', () => {
  assert.equal(API_RATE_LIMIT_OVERRIDE_CEILING, 5000);
  assert.equal(apiRateLimitMax('5000', 'test'), 5000);
  assert.equal(apiRateLimitMax('999999999', 'development'), 5000);
});

test('production ignores the override and keeps the default limit', () => {
  assert.equal(apiRateLimitMax('2000', 'production'), 100);
  assert.equal(apiRateLimitMax('1', 'production'), 100);
});

test('signed-in traffic is keyed by the verified user; anonymous traffic by IP', async () => {
  const server = {
    jwt: {
      verify: async (token) => {
        if (token === 'good-staff') return { id: 'user-1', role: 'TEAM' };
        if (token === 'good-portal') return { contactId: 'contact-9', role: 'CLIENT' };
        throw new Error('invalid signature');
      },
    },
  };
  const base = { ip: '198.51.100.7', headers: {}, cookies: {}, server };
  assert.equal(await apiRateLimitKey({ ...base, user: { id: 'from-hook' } }), 'user:from-hook');
  assert.equal(await apiRateLimitKey({ ...base, cookies: { token: 'good-staff' } }), 'user:user-1');
  assert.equal(await apiRateLimitKey({ ...base, headers: { authorization: 'Bearer good-portal' } }), 'user:contact-9');
  assert.equal(await apiRateLimitKey({ ...base, cookies: { token: 'forged' } }), 'ip:198.51.100.7');
  assert.equal(await apiRateLimitKey(base), 'ip:198.51.100.7');
  // Bot tokens keep the per-IP bucket (and the 100/min anonymous limit).
  assert.equal(await apiRateLimitKey({ ...base, user: { id: 'bot', role: 'BOT' } }), 'ip:198.51.100.7');
  server.jwt.verify = async () => ({ id: 'bot', role: 'BOT' });
  assert.equal(await apiRateLimitKey({ ...base, cookies: { token: 'bot-token' } }), 'ip:198.51.100.7');
});

test('per-user limit defaults to 600/min, is env-configurable and never below the IP limit', () => {
  assert.equal(DEFAULT_API_USER_RATE_LIMIT_MAX, 600);
  assert.equal(apiUserRateLimitMax(undefined), 600);
  assert.equal(apiUserRateLimitMax('1200'), 1200);
  assert.equal(apiUserRateLimitMax('10'), 100);
  assert.equal(apiUserRateLimitMax('999999'), 5000);
  const max = createApiRateLimitMax({ ipMax: 100, userMax: 600 });
  assert.equal(max({}, 'user:u1'), 600);
  assert.equal(max({}, 'ip:1.2.3.4'), 100);
  assert.equal(createApiRateLimitMax({ ipMax: 2000, userMax: 600 })({}, 'user:u1'), 2000);
});

test('the in-memory store is used in tests; Redis is used when configured', () => {
  assert.equal(createRateLimitRedis({ nodeEnv: 'test', redisUrl: 'redis://localhost:6379' }), null);
  assert.equal(createRateLimitRedis({ nodeEnv: 'development', redisUrl: '' }), null);
  // Deployed environments (staging too) never fall back to per-process counters.
  assert.throws(() => createRateLimitRedis({ nodeEnv: 'staging', redisUrl: '' }), /REDIS_URL is required/);
  const redis = createRateLimitRedis({ nodeEnv: 'development', redisUrl: 'redis://127.0.0.1:1/0' });
  try {
    assert.equal(redis.options.enableOfflineQueue, false);
    assert.equal(Number(redis.options.db), 0);
  } finally {
    redis.disconnect();
  }
});

test('users sharing one IP get separate buckets; anonymous callers share the IP bucket', async () => {
  const app = Fastify();
  await app.register(cookie);
  await app.register(jwt, { secret: 'test-only-secret', cookie: { cookieName: 'token', signed: false } });
  await app.register(rateLimit, {
    global: true,
    keyGenerator: apiRateLimitKey,
    max: createApiRateLimitMax({ ipMax: 3, userMax: 5 }),
    timeWindow: '1 minute',
  });
  app.get('/api/thing', async () => ({ ok: true }));
  await app.ready();
  try {
    const alice = app.jwt.sign({ id: 'alice' });
    const bob = app.jwt.sign({ id: 'bob' });
    const hit = (token) => app.inject({
      method: 'GET',
      url: '/api/thing',
      remoteAddress: '203.0.113.50',
      ...(token ? { cookies: { token } } : {}),
    });
    const codes = async (token, n) => {
      const out = [];
      for (let i = 0; i < n; i += 1) out.push((await hit(token)).statusCode);
      return out;
    };
    assert.deepEqual(await codes(alice, 6), [200, 200, 200, 200, 200, 429]);
    assert.deepEqual(await codes(bob, 5), [200, 200, 200, 200, 200], 'bob is not throttled by alice on the same IP');
    assert.deepEqual(await codes(null, 4), [200, 200, 200, 429], 'anonymous keeps the per-IP limit');
  } finally {
    await app.close();
  }
});
