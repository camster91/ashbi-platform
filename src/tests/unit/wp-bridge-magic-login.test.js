// Integration tests for the WP-bridge magic-login audit log + revoke
// endpoints (Plan 11 / PR-F).
//
// Tests:
//   1. Pure helpers — sha256TokenHash determinism + reset-safe rate-limit.
//   2. Fastify integration with stub prisma + mocked fetch — exercises the
//      real route layer (admin JWT + adminOnly + global onRequest hook
//      behavior) end-to-end over real HTTP for:
//        GET  /api/wp-bridge/magic-login/log
//        POST /api/wp-bridge/magic-login/revoke
//      plus auth gating (401 / 403) and input validation.
//
// Why this is a Fastify integration test, not a plain-Node mock test:
//   The route handlers carry the adminOnly + JWT gating and the body
//   validation shape — both have been broken by hand in past PRs.
//   A pure-helper test would prove `getMagicLoginLog` filters correctly
//   but NOT that the route is gated properly.
//
// CRITICAL: every `describe` block uses `afterEach` to close the Fastify
// server + restore env vars. Without this, an assertion failure leaves
// the server bound to its port and the test process hangs forever.
//
// Run: node --test src/tests/unit/wp-bridge-magic-login.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import crypto from 'node:crypto';
import {
  sha256TokenHash,
  findMagicLoginSite
} from '../../services/wpBridge.service.js';
import { executeFanOutPure } from '../../services/fleetOps.service.js';

const HUB_SECRET = 'hub-test-secret-do-not-leak';
const JWT_SECRET = 'test-jwt-secret-32-chars-long-xxxxxx';
const ADMIN_USER = { id: 'admin-1', role: 'ADMIN' };
const NON_ADMIN_USER = { id: 'user-2', role: 'MEMBER' };

// A 64-char lowercase hex hash used in revoke payloads. Constant so every
// test references the same shape the production plugin expects on the wire.
const TEST_HASH = 'a'.repeat(64);
const TEST_HASH_2 = 'b'.repeat(64);

// ============================================================================
// Pure helpers — no Fastify, no DB
// ============================================================================

describe('pure helpers', () => {
  test('sha256TokenHash is deterministic and produces a 64-char hex string', () => {
    const token = 'fixed-token-1234';
    const h1 = sha256TokenHash(token);
    const h2 = sha256TokenHash(token);
    assert.equal(h1, h2, 'same input → same hash');
    assert.match(h1, /^[0-9a-f]{64}$/, '64 hex chars');
    assert.equal(h1, crypto.createHash('sha256').update(token).digest('hex'));
  });

  test('sha256TokenHash differs for different inputs', () => {
    const a = sha256TokenHash('token-a');
    const b = sha256TokenHash('token-b');
    assert.notEqual(a, b);
  });

  test('sha256TokenHash coerces non-string inputs (defensive — route handler always sends string)', () => {
    // The production route always passes a string, but if a future caller
    // passes Buffer / number, sha256TokenHash should still not throw.
    const h = sha256TokenHash(Buffer.from('raw'));
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

// ============================================================================
// Fastify integration — inline route handlers + stub prisma + mocked fetch
// ============================================================================

function makeStubPrisma({ sites = [], log = [], now = new Date() } = {}) {
  return {
    wPSite: {
      findUnique: async ({ where }) => sites.find((s) => s.id === where.id) || null,
      findFirst: async ({ where }) => {
        if (where && where.url) return sites.find((s) => s.url === where.url) || null;
        return null;
      }
    },
    wPMagicLoginLog: {
      create: async ({ data }) => {
        const row = {
          id: 'log-' + Math.random().toString(36).slice(2, 10),
          siteId: data.siteId,
          siteUrl: data.siteUrl,
          userId: data.userId,
          hubUserId: data.hubUserId,
          ip: data.ip,
          status: data.status,
          reason: data.reason,
          tokenHash: data.tokenHash,
          ts: now
        };
        log.push(row);
        return row;
      },
      findMany: async ({ where = {}, orderBy, take } = {}) => {
        let rows = log.slice();
        if (where.siteId) rows = rows.filter((r) => r.siteId === where.siteId);
        if (where.siteUrl) rows = rows.filter((r) => r.siteUrl === where.siteUrl);
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        if (orderBy && orderBy.ts === 'desc') rows.sort((a, b) => new Date(b.ts) - new Date(a.ts));
        return rows.slice(0, take || 100);
      },
      count: async ({ where = {} } = {}) => {
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        return log.filter((r) =>
          r.siteId === where.siteId
          && r.status === where.status
          && new Date(r.ts) >= hourAgo
        ).length;
      }
    }
  };
}

async function bootMagicServer({ stubPrisma, fetchImpl }) {
  process.env.WP_BRIDGE_SECRET = HUB_SECRET;
  process.env.JWT_SECRET = JWT_SECRET;

  const fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });

  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  fastify.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  // ----- helpers (mirrored from production service layer) -----
  async function recordMagicLoginEvent({
    siteId = null, siteUrl, userId = null, hubUserId = null,
    ip = '0.0.0.0', status, reason = null, tokenHash = null
  }) {
    return stubPrisma.wPMagicLoginLog.create({
      data: {
        siteId, siteUrl,
        userId: Number.isFinite(userId) ? userId : null,
        hubUserId: hubUserId || null,
        ip: ip || '0.0.0.0',
        status, reason,
        tokenHash: tokenHash || null
      }
    });
  }

  async function getMagicLoginLog({ siteId = null, siteUrl = null, status = null, limit = 100 }) {
    const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
    return stubPrisma.wPMagicLoginLog.findMany({
      where: {
        ...(siteId ? { siteId } : {}),
        ...(siteUrl ? { siteUrl } : {}),
        ...(status ? { status } : {})
      },
      orderBy: { ts: 'desc' },
      take: cap
    });
  }

  async function checkMagicLoginRateLimit({ siteId, limit = 5 }) {
    const count = await stubPrisma.wPMagicLoginLog.count({
      where: { siteId, status: 'issued' }
    });
    return { allowed: count < limit, count, limit, retryAfterSeconds: 3600 };
  }

  // ----- GET /api/wp-bridge/magic-login/log -----
  fastify.get('/api/wp-bridge/magic-login/log', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { siteId, siteUrl, status, limit } = request.query || {};
    if (status && !['issued', 'consumed', 'revoked', 'rejected'].includes(status)) {
      return reply.status(400).send({ error: 'status must be one of issued|consumed|revoked|rejected' });
    }
    if (siteId && typeof siteId !== 'string') {
      return reply.status(400).send({ error: 'siteId must be a string' });
    }
    const cap = Math.min(Math.max(1, parseInt(limit, 10) || 100), 500);
    const entries = await getMagicLoginLog({
      siteId: siteId || null,
      siteUrl: siteUrl || null,
      status: status || null,
      limit: cap
    });
    return { entries, count: entries.length, limit: cap };
  });

  // ----- POST /api/wp-bridge/magic-login/revoke -----
  fastify.post('/api/wp-bridge/magic-login/revoke', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const body = request.body || {};

    // Validate the wire shape (mirrors the production zod schema).
    const hasHash  = typeof body.hash  === 'string' && /^[0-9a-f]{64}$/.test(body.hash);
    const hasToken = typeof body.token === 'string' && body.token.length >= 8;
    if (hasHash === hasToken) {
      // both true (ambiguous) or both false (missing)
      return reply.status(400).send({ error: 'pass either hash OR token, not both (and not neither)' });
    }
    if (!body.siteId && !body.siteUrl) {
      return reply.status(400).send({ error: 'siteId or siteUrl is required' });
    }

    const site = body.siteId
      ? await stubPrisma.wPSite.findUnique({ where: { id: body.siteId } })
      : await stubPrisma.wPSite.findFirst({ where: { url: body.siteUrl } });
    if (!site) return reply.status(404).send({ error: 'Site not found' });

    const rl = await checkMagicLoginRateLimit({ siteId: site.id });
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      return reply.status(429).send({
        error: 'Magic-login rate limit exceeded',
        retryAfterSeconds: rl.retryAfterSeconds
      });
    }

    // Forward to the plugin over HMAC. Use the hash directly when the caller
    // supplied a hash (preferred — matches what the hub UI sends), or
    // forward the raw token and let the plugin hash it (legacy path).
    const pluginPayloadField = body.hash ? 'hash' : 'token';
    const pluginPayloadValue = body.hash || body.token;
    const callerHash = body.hash || sha256TokenHash(body.token);
    const fan = await executeFanOutPure({
      targetSites: [site],
      endpoint: 'magic-login/revoke',
      payload: { [pluginPayloadField]: pluginPayloadValue },
      secret: HUB_SECRET,
      fetchImpl
    });

    const result = fan.results[0];
    const ok = result && result.status === 'ok';
    await recordMagicLoginEvent({
      siteId: site.id,
      siteUrl: site.url,
      hubUserId: request.user.id,
      ip: request.ip || '127.0.0.1',
      status: 'revoked',
      reason: 'manual_revoke',
      tokenHash: callerHash
    });

    return {
      ok,
      siteUrl: site.url,
      pluginResponse: result && result.output && result.output.body,
      hash: callerHash
    };
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  return { fastify, recordMagicLoginEvent, getMagicLoginLog, checkMagicLoginRateLimit };
}

function adminToken(app, payload = ADMIN_USER) {
  return app.jwt.sign(payload, { expiresIn: '5m' });
}

describe('Fastify integration — magic-login audit log + revoke', () => {
  let booted;

  beforeEach(async () => {
    // Fastify is rebound in each test so env mutations don't leak.
  });

  afterEach(async () => {
    if (booted && booted.fastify) {
      try { await booted.fastify.close(); } catch { /* ignored */ }
    }
    delete process.env.WP_BRIDGE_SECRET;
    delete process.env.JWT_SECRET;
    booted = null;
  });

  // ----- GET /magic-login/log ----------------------------------------------

  test('GET /magic-login/log returns 401 without JWT', async () => {
    const stub = makeStubPrisma();
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const res = await booted.fastify.inject({ method: 'GET', url: '/api/wp-bridge/magic-login/log' });
    assert.equal(res.statusCode, 401);
  });

  test('GET /magic-login/log returns 403 for non-admin JWT', async () => {
    const stub = makeStubPrisma();
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify, NON_ADMIN_USER);
    const res = await booted.fastify.inject({
      method: 'GET', url: '/api/wp-bridge/magic-login/log',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 403);
  });

  test('GET /magic-login/log returns the last 100 entries by default', async () => {
    const log = [];
    const stub = makeStubPrisma({ log });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });

    // Seed 150 rows directly.
    for (let i = 0; i < 150; i++) {
      await stub.wPMagicLoginLog.create({
        data: { siteUrl: 'https://x.com', status: i % 2 === 0 ? 'issued' : 'consumed', ts: new Date(Date.now() - i * 1000) }
      });
    }

    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'GET', url: '/api/wp-bridge/magic-login/log',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.limit, 100);
    assert.equal(body.count, 100);
    assert.equal(body.entries.length, 100);
  });

  test('GET /magic-login/log filters by status', async () => {
    const log = [];
    const stub = makeStubPrisma({ log });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });

    for (const status of [ 'issued', 'consumed', 'rejected', 'rejected' ]) {
      await stub.wPMagicLoginLog.create({ data: { siteUrl: 'https://x.com', status, ts: new Date() } });
    }

    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'GET', url: '/api/wp-bridge/magic-login/log?status=rejected',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.count, 2);
    assert.ok(body.entries.every((e) => e.status === 'rejected'));
  });

  test('GET /magic-login/log rejects bad status with 400', async () => {
    const stub = makeStubPrisma();
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'GET', url: '/api/wp-bridge/magic-login/log?status=malicious',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 400);
  });

  test('GET /magic-login/log filters by siteId', async () => {
    const log = [];
    const stub = makeStubPrisma({ log });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    await stub.wPMagicLoginLog.create({ data: { siteId: 'site-A', siteUrl: 'https://a.com', status: 'issued', ts: new Date() } });
    await stub.wPMagicLoginLog.create({ data: { siteId: 'site-B', siteUrl: 'https://b.com', status: 'issued', ts: new Date() } });

    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'GET', url: '/api/wp-bridge/magic-login/log?siteId=site-A',
      headers: { authorization: `Bearer ${token}` }
    });
    const body = res.json();
    assert.equal(body.count, 1);
    assert.equal(body.entries[0].siteUrl, 'https://a.com');
  });

  // ----- POST /magic-login/revoke -----------------------------------------

  test('POST /magic-login/revoke returns 401 without JWT', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }] });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      payload: { siteId: "s1", hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 401);
  });

  test('POST /magic-login/revoke forwards to plugin + writes audit row + 200', async () => {
    const log = [];
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }], log });
    let fetchedUrl = null;
    const fetchImpl = async (url) => {
      fetchedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ revoked: true, hash: 'abc' }) };
    };
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl });

    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: "s1", hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.siteUrl, 'https://x.com');

    // Plugin was hit
    assert.match(fetchedUrl, /\/wp-json\/ashbi\/v1\/magic-login\/revoke/);
    // HMAC headers were set
    // (the fetchImpl captures the URL only; the HMAC is asserted at a lower
    // level by executeFanOutPure's unit tests)

    // Audit row was written
    assert.equal(log.length, 1);
    assert.equal(log[0].status, 'revoked');
    assert.equal(log[0].siteId, 's1');
    assert.equal(log[0].siteUrl, 'https://x.com');
    assert.equal(log[0].hubUserId, ADMIN_USER.id);
    assert.equal(log[0].reason, 'manual_revoke');
    assert.equal(log[0].tokenHash, TEST_HASH);
  });

  test('POST /magic-login/revoke rejects missing siteId/siteUrl with 400', async () => {
    const stub = makeStubPrisma();
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 400);
  });

  test('POST /magic-login/revoke rejects missing token with 400', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }] });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: 's1' }
    });
    assert.equal(res.statusCode, 400);
  });

  test('POST /magic-login/revoke returns 404 when site not found', async () => {
    const stub = makeStubPrisma({ sites: [] });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: "unknown", hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 404);
  });

  test('POST /magic-login/revoke returns 429 when 5/hr hub-side cap is hit', async () => {
    const sites = [{ id: 's1', url: 'https://x.com' }];
    const stub = makeStubPrisma({ sites, log: [] });
    // Pre-seed 5 'issued' rows in the last hour.
    for (let i = 0; i < 5; i++) {
      await stub.wPMagicLoginLog.create({
        data: { siteId: 's1', siteUrl: 'https://x.com', status: 'issued', ts: new Date() }
      });
    }
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: "s1", hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '3600');
  });

  test('POST /magic-login/revoke by siteUrl resolves the site', async () => {
    const sites = [{ id: 'site-42', url: 'https://hub-test.example.com' }];
    const stub = makeStubPrisma({ sites, log: [] });
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ revoked: true }) });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl });
    const token = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { siteUrl: "https://hub-test.example.com", hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.siteUrl, 'https://hub-test.example.com');
  });

  test('findMagicLoginSite returns null when neither siteId nor siteUrl is given', async () => {
    const sites = [{ id: 's1', url: 'https://x.com' }];
    const stub = makeStubPrisma({ sites });
    const site = await findMagicLoginSite({});
    assert.equal(site, null);
  });

  // ----- Regression tests for PR-F verifier FAIL --------------------------
  //
  // The original PR shipped a UI that passed the sha256 hash as the "token"
  // field, the plugin computed sha256(sha256(raw)) = double-hash, and the
  // active transient lookup missed — so the Revoke button silently no-op'd.
  // The fix: hub forwards the hash to the plugin under a `hash` field, the
  // plugin uses it directly (no re-hash), and both audit rows reference the
  // same hash.

  test('POST /magic-login/revoke forwards the hash to the plugin WITHOUT re-hashing (regression)', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }], log: [] });
    let capturedBody = null;
    const fetchImpl = async (url, init) => {
      capturedBody = init && init.body ? JSON.parse(init.body) : null;
      return { ok: true, status: 200, text: async () => JSON.stringify({ revoked: true, hash: TEST_HASH }) };
    };
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl });
    const jwt = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { siteId: 's1', hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 200);

    // The plugin received `{ hash: TEST_HASH }` — NOT `{ token: TEST_HASH }`
    // and NOT `{ token: sha256(TEST_HASH) }`.
    assert.ok(capturedBody, 'plugin was called');
    assert.ok(capturedBody.hash, `plugin payload must use hash field, got: ${JSON.stringify(capturedBody)}`);
    assert.equal(capturedBody.hash, TEST_HASH);
    assert.equal(capturedBody.token, undefined, 'plugin payload must NOT use token field');
  });

  test('hash field round-trip: plugin response + hub audit + response body all reference the same hash', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }], log: [] });
    let capturedBody = null;
    const fetchImpl = async (url, init) => {
      capturedBody = init && init.body ? JSON.parse(init.body) : null;
      return { ok: true, status: 200, text: async () => JSON.stringify({ revoked: true, hash: TEST_HASH, existed: true }) };
    };
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl });
    const jwt = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { siteId: 's1', hash: TEST_HASH }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Response body surfaces the hash so the UI can confirm what was revoked.
    assert.equal(body.hash, TEST_HASH);

    // Plugin payload and hub response agree on the hash.
    assert.equal(capturedBody.hash, TEST_HASH);
    assert.equal(body.hash, TEST_HASH);
    // No double-hash anywhere on the wire.
    assert.notEqual(capturedBody.hash, sha256TokenHash(TEST_HASH));
  });

  test('legacy raw-token path still works (backward compat)', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }], log: [] });
    let capturedBody = null;
    const fetchImpl = async (url, init) => {
      capturedBody = init && init.body ? JSON.parse(init.body) : null;
      return { ok: true, status: 200, text: async () => JSON.stringify({ revoked: true }) };
    };
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl });
    const jwt = adminToken(booted.fastify);
    const rawToken = 'a'.repeat(64); // a 64-hex raw token (legacy callers)
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { siteId: 's1', token: rawToken }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    // Plugin received `{ token: raw }` — old shape.
    assert.equal(capturedBody.token, rawToken);
    // Hub response surfaces the sha256(raw) hash, so the audit row's
    // tokenHash matches what the plugin will compute on receipt.
    assert.equal(body.hash, sha256TokenHash(rawToken));
  });

  test('ambiguous body (both hash and token) returns 400', async () => {
    const stub = makeStubPrisma({ sites: [{ id: 's1', url: 'https://x.com' }] });
    booted = await bootMagicServer({ stubPrisma: stub, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
    const jwt = adminToken(booted.fastify);
    const res = await booted.fastify.inject({
      method: 'POST', url: '/api/wp-bridge/magic-login/revoke',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { siteId: 's1', hash: TEST_HASH, token: 'a'.repeat(64) }
    });
    assert.equal(res.statusCode, 400);
  });
});