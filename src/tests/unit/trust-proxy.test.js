// TRUST_PROXY (#417 security review, docs/deployment-and-rollback.md): per-IP
// rate limits must see the client behind Traefik, and stay unchanged when the
// setting is absent.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { parseTrustProxy } = await import('../../config/trust-proxy.js');

test('TRUST_PROXY is off unless it is a small hop count', () => {
  for (const value of [undefined, '', ' ', 'false', 'FALSE', '0']) {
    assert.deepEqual(parseTrustProxy(value), { trustProxy: false, invalid: false }, String(value));
  }
  assert.equal(parseTrustProxy('1').trustProxy.hops, 1);
  assert.equal(parseTrustProxy(' 2 ').trustProxy.hops, 2);
  assert.deepEqual(parseTrustProxy('172.16.0.0/12, loopback'), { trustProxy: '172.16.0.0/12,loopback', invalid: false });
  assert.deepEqual(parseTrustProxy('10.0.0.2'), { trustProxy: '10.0.0.2', invalid: false });
  // `true` would trust any client-supplied X-Forwarded-For.
  for (const value of ['true', 'yes', 'bad', '6', '-1', '1.5', 'example.com']) {
    assert.deepEqual(parseTrustProxy(value), { trustProxy: false, invalid: true }, value);
  }
});

async function appIp(trustProxy) {
  const { buildApp } = await import('../../index.js');
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret', ...(trustProxy === undefined ? {} : { trustProxy }) });
  app.get('/__ip', async (request) => ({ ip: request.ip }));
  try {
    const response = await app.inject({ method: 'GET', url: '/__ip', remoteAddress: '10.0.0.2', headers: { 'x-forwarded-for': '203.0.113.50, 198.51.100.7' } });
    return response.json().ip;
  } finally {
    await app.close();
  }
}

test('the application factory trusts no proxy by default and one hop with TRUST_PROXY=1', async () => {
  assert.equal(await appIp(undefined), '10.0.0.2');
  assert.equal(await appIp(false), '10.0.0.2');
  // One hop: the address Traefik appended (last entry), never the
  // client-supplied one further left.
  assert.equal(await appIp(1), '198.51.100.7');
  assert.equal(await appIp(parseTrustProxy('1').trustProxy), '198.51.100.7');
  // Address list: only the named proxy is trusted.
  assert.equal(await appIp(parseTrustProxy('10.0.0.0/8').trustProxy), '198.51.100.7');
  assert.equal(await appIp(parseTrustProxy('172.16.0.0/12').trustProxy), '10.0.0.2');
});

test('behind one trusted hop, per-IP limits are per client instead of one shared bucket', async (t) => {
  const counts = {};
  const { trustHops } = await import('../../config/trust-proxy.js');
  for (const trustProxy of [false, 1]) {
    const app = Fastify({ trustProxy: trustProxy ? trustHops(trustProxy) : false });
    await app.register(rateLimit, { global: true, max: 2, timeWindow: '1 minute' });
    app.get('/limited', async () => ({ ok: true }));
    t.after(() => app.close());
    let limited = 0;
    for (const client of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      for (let i = 0; i < 2; i += 1) {
        const response = await app.inject({ method: 'GET', url: '/limited', remoteAddress: '10.0.0.2', headers: { 'x-forwarded-for': client } });
        if (response.statusCode === 429) limited += 1;
      }
    }
    counts[trustProxy] = limited;
  }
  assert.equal(counts[false], 4, 'without trust, three clients share the proxy bucket');
  assert.equal(counts[1], 0, 'with one trusted hop, each client has its own bucket');
});
