// Integration tests for the WP-bridge magic-login fleet endpoint (Plan 8).
//
// Endpoint: POST /api/wp-bridge/fleet/magic-login
//   Body: { targetSites | targetAll }
//   Plugin-side: POST {siteUrl}/wp-json/ashbi/v1/magic-login with that
//   site's stored { user_id } configuration.
//   Plugin response shape: { url: "https://..." } on success
//   Hub-side response shape: { opId, total, succeeded, failed, results: [{ siteUrl, url? | error? }] }
//
// Tests:
//   1. Pure mapper (reshapeMagicLoginResult) — translates fan-out envelope to
//      the magic-login shape (url on ok, error on err or missing-url).
//   2. Pure fan-out helper — verify the per-site body is { user_id } only
//      (no targetSites/targetAll leaked to the plugin) and the HMAC verifies.
//   3. Fastify integration with stub prisma + mocked fetch — exercises the
//      real route layer (adminOnly + global hooks) end-to-end over real HTTP.
//      Covers:
//        - 3-site fan-out: 1 fails -> success_count=2, failure_count=1
//        - Audit row persisted with op_type='magic_login'
//        - Concurrent fan-out (Promise.all timing)
//        - Auth gating (401/403)
//        - Empty targetSites -> 400
//        - targetAll=true vs targetSites=[url,...] filtering
//        - Plugin-response url extracted into results array
//
// Mirrors the PR #220 / PR #221 test pattern: inline route handlers against a
// stub prisma (the production route file imports prisma at module load, so we
// can't monkey-patch it; we exercise the production file via the regression
// guard at the bottom).
//
// CRITICAL: every Fastify describe block uses afterEach to close the server
// + restore env vars. Without this, an assertion failure leaves the server
// bound to its port and the test process hangs forever.
//
// Run: node --test src/tests/unit/wp-bridge-magic-login-fleet.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { verifyRequest } from '../../lib/hmac-client.js';
import {
  buildPerSiteRequest,
  executeFanOutPure,
  PER_SITE_TIMEOUT_MS
} from '../../services/fleetOps.service.js';
import { reshapeMagicLoginResult } from '../../routes/wp-bridge.routes.js';

const HUB_SECRET = 'hub-test-secret-do-not-leak';

// ===========================================================================
// Pure mapper — no Fastify, no DB
// ===========================================================================

describe('reshapeMagicLoginResult', () => {
  test('ok + body.url present -> { siteUrl, url }', () => {
    const r = {
      siteUrl: 'https://a.com',
      status: 'ok',
      output: { httpStatus: 200, body: { url: 'https://a.com/wp-login.php?token=xyz' } }
    };
    const out = reshapeMagicLoginResult(r);
    assert.equal(out.siteUrl, 'https://a.com');
    assert.equal(out.url, 'https://a.com/wp-login.php?token=xyz');
    assert.equal(out.error, undefined);
  });

  test('ok but body.url missing -> { siteUrl, error } (defensive)', () => {
    const r = {
      siteUrl: 'https://a.com',
      status: 'ok',
      output: { httpStatus: 200, body: { success: true } }
    };
    const out = reshapeMagicLoginResult(r);
    assert.equal(out.siteUrl, 'https://a.com');
    assert.equal(out.url, undefined);
    assert.match(out.error, /missing url field/);
  });

  test('ok but body is non-object (e.g. plain string) -> { siteUrl, error }', () => {
    const r = {
      siteUrl: 'https://a.com',
      status: 'ok',
      output: { httpStatus: 200, body: 'oops' }
    };
    const out = reshapeMagicLoginResult(r);
    assert.equal(out.url, undefined);
    assert.match(out.error, /missing url field/);
  });

  test('error status -> { siteUrl, error }', () => {
    const r = { siteUrl: 'https://b.com', status: 'error', error: 'HTTP 500' };
    const out = reshapeMagicLoginResult(r);
    assert.equal(out.siteUrl, 'https://b.com');
    assert.equal(out.error, 'HTTP 500');
    assert.equal(out.url, undefined);
  });

  test('error with no error message falls back to "unknown error"', () => {
    const r = { siteUrl: 'https://b.com', status: 'error' };
    const out = reshapeMagicLoginResult(r);
    assert.match(out.error, /unknown error/);
  });

  test('null result -> { siteUrl: "", error } (does not throw)', () => {
    const out = reshapeMagicLoginResult(null);
    assert.equal(out.siteUrl, '');
    assert.match(out.error, /empty result/);
  });
});

// ===========================================================================
// Pure fan-out + wire format — verifies per-site body is { user_id } only,
// that targetSites/targetAll are stripped, and that the HMAC verifies.
// ===========================================================================

describe('magic-login fan-out wire format', () => {
  test('per-site request body is { user_id, _timestamp } only (no target metadata)', () => {
    const req = buildPerSiteRequest({
      siteUrl: 'https://a.com',
      endpoint: 'magic-login',
      payload: { user_id: 1, targetAll: true, targetSites: ['https://b.com'] },
      secret: HUB_SECRET,
      timestamp: 1718000000
    });
    assert.equal(req.url, 'https://a.com/wp-json/ashbi/v1/magic-login');
    assert.equal(req.method, 'POST');
    assert.match(req.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
    assert.equal(req.headers['X-Ashbi-Timestamp'], '1718000000');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.parsedBody.user_id, 1);
    assert.equal(req.parsedBody.targetAll, undefined);
    assert.equal(req.parsedBody.targetSites, undefined);
    assert.equal(req.parsedBody._timestamp, 1718000000);
    // rawBody MUST equal JSON.stringify(parsedBody) — used for HMAC.
    assert.equal(req.rawBody, JSON.stringify(req.parsedBody));
  });

  test('outgoing HMAC verifies on replay (proves wire-format compat)', () => {
    const req = buildPerSiteRequest({
      siteUrl: 'https://a.com',
      endpoint: 'magic-login',
      payload: { user_id: 42 },
      secret: HUB_SECRET,
      timestamp: 1718000000
    });
    const ok = verifyRequest({
      signatureHeader: req.headers['X-Ashbi-Signature'],
      timestamp: req.headers['X-Ashbi-Timestamp'],
      body: req.rawBody,
      secret: HUB_SECRET
    });
    assert.equal(ok, true);
  });

  test('payloadForSite sends each client site its configured administrator', async () => {
    const bodies = [];
    const out = await executeFanOutPure({
      targetSites: [
        { url: 'https://a.com', bridgeSecret: HUB_SECRET, magicLoginUserId: 7 },
        { url: 'https://b.com', bridgeSecret: HUB_SECRET, magicLoginUserId: 23 }
      ],
      endpoint: 'magic-login',
      payload: { mode: 'per_site_magic_login_user' },
      payloadForSite: (site) => ({ user_id: site.magicLoginUserId }),
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, text: async () => '{"url":"https://example.com/wp-login.php"}' };
      }
    });

    assert.equal(out.succeeded, 2);
    assert.deepEqual(bodies.map((body) => body.user_id).sort((a, b) => a - b), [7, 23]);
    assert.ok(bodies.every((body) => body.mode === undefined));
  });
});

// ===========================================================================
// Fastify integration — inline route handlers + stub prisma + mocked fetch
// ===========================================================================

function makeStubPrisma({ sites = [], ops = [] } = {}) {
  return {
    wPSite: {
      findMany: async ({ where } = {}) => {
        let rows = sites;
        if (where && Array.isArray(where.url?.in)) {
          const set = new Set(where.url.in);
          rows = sites.filter((s) => set.has(s.url));
        }
        return rows.map((s) => ({ id: s.id, url: s.url, name: s.name, magicLoginUserId: s.magicLoginUserId }));
      }
    },
    wPFleetOp: {
      create: async ({ data }) => {
        const row = {
          id: 'op-' + Math.random().toString(36).slice(2, 10),
          opType: data.opType,
          payload: data.payload,
          targetCount: data.targetCount,
          successCount: data.successCount ?? 0,
          failureCount: data.failureCount ?? 0,
          createdBy: data.createdBy,
          createdAt: new Date(),
          completedAt: null
        };
        ops.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = ops.find((o) => o.id === where.id);
        if (!row) throw new Error(`op ${where.id} not found`);
        if (data.successCount !== undefined) row.successCount = data.successCount;
        if (data.failureCount !== undefined) row.failureCount = data.failureCount;
        if (data.completedAt !== undefined) row.completedAt = data.completedAt;
        return row;
      },
      findMany: async ({ where, take } = {}) => {
        let rows = ops.slice();
        if (where && where.opType) rows = rows.filter((o) => o.opType === where.opType);
        rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return rows.slice(0, take ?? 50);
      }
    }
  };
}

async function bootMagicLoginServer({ stubPrisma, fetchImpl }) {
  const prevSecret = process.env.WP_BRIDGE_SECRET;
  process.env.WP_BRIDGE_SECRET = HUB_SECRET;
  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-jwt-secret-32-chars-long-xxxxxx';

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

  // Inline magic-login route handler — mirrors the production handler's
  // per-site administrator lookup without booting the daily digest cron.
  async function executeMagicLoginFleet({ targetSites, targetAll, createdBy }) {
    const sites = await stubPrisma.wPSite.findMany({
      where: targetAll ? undefined : { url: { in: targetSites } },
      select: { id: true, url: true, name: true, magicLoginUserId: true }
    });
    if (sites.length === 0) return { statusCode: 404, body: { error: 'No matching sites found' } };
    const unconfigured = sites.filter((site) => !Number.isInteger(site.magicLoginUserId) || site.magicLoginUserId < 1);
    if (unconfigured.length > 0) {
      return { statusCode: 409, body: { error: 'Set a WordPress administrator ID for every selected site before issuing magic login.' } };
    }

    const opId = (await stubPrisma.wPFleetOp.create({
      data: { opType: 'magic_login', payload: { mode: 'per_site_magic_login_user' }, targetCount: sites.length, createdBy }
    })).id;

    const fan = await executeFanOutPure({
      targetSites: sites,
      endpoint: 'magic-login',
      payloadForSite: (site) => ({ user_id: site.magicLoginUserId }),
      secret: process.env.WP_BRIDGE_SECRET,
      fetchImpl
    });

    await stubPrisma.wPFleetOp.update({
      where: { id: opId },
      data: { successCount: fan.succeeded, failureCount: fan.failed, completedAt: new Date() }
    });

    return {
      statusCode: 200,
      body: {
        opId,
        total: fan.total,
        succeeded: fan.succeeded,
        failed: fan.failed,
        results: fan.results.map(reshapeMagicLoginResult)
      }
    };
  }

  fastify.post('/api/wp-bridge/fleet/magic-login', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { targetSites, targetAll } = request.body || {};
    if (targetAll !== true && (!Array.isArray(targetSites) || targetSites.length === 0)) {
      return reply.status(400).send({ error: 'Either targetAll=true or a non-empty targetSites[] is required' });
    }
    const out = await executeMagicLoginFleet({
      targetSites,
      targetAll: targetAll === true,
      createdBy: request.user.id
    });
    return reply.status(out.statusCode).send(out.body);
  });

  // GET /fleet/ops?op_type=magic_login — narrow filter for the new op type.
  fastify.get('/api/wp-bridge/fleet/ops', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { limit, op_type: opType } = request.query;
    if (opType && !['file_patch', 'command', 'option_set', 'magic_login'].includes(opType)) {
      return reply.status(400).send({ error: 'op_type must be one of file_patch | command | option_set | magic_login' });
    }
    const safeLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500) : 50;
    const ops = await stubPrisma.wPFleetOp.findMany({
      where: opType ? { opType } : undefined,
      orderBy: { createdAt: 'desc' },
      take: safeLimit
    });
    return { ops };
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });

  return {
    fastify,
    restore: () => {
      if (prevSecret === undefined) delete process.env.WP_BRIDGE_SECRET; else process.env.WP_BRIDGE_SECRET = prevSecret;
      if (prevJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevJwt;
    }
  };
}

async function postJson(port, path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal
    });
  } finally { clearTimeout(timer); }
}

async function getJson(port, path, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
  } finally { clearTimeout(timer); }
}

function makeAdminToken(fastify) {
  return fastify.jwt.sign({ id: 'admin-1', role: 'ADMIN', email: 'admin@ashbi.ca' });
}
function makeNonAdminToken(fastify) {
  return fastify.jwt.sign({ id: 'team-1', role: 'TEAM', email: 'team@ashbi.ca' });
}

// ===========================================================================
// POST /api/wp-bridge/fleet/magic-login — fan-out integration
// ===========================================================================

describe('POST /api/wp-bridge/fleet/magic-login — Fastify integration', () => {
  let app, port, restore, fetchCalls, fetchImpl, stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({
      sites: [
        { id: 's1', url: 'https://a.com', name: 'A', magicLoginUserId: 11 },
        { id: 's2', url: 'https://b.com', name: 'B', magicLoginUserId: 22 },
        { id: 's3', url: 'https://c.com', name: 'C', magicLoginUserId: 33 }
      ],
      ops
    });
    fetchCalls = [];
    // Mock plugin: a.com + c.com return { url: '...' }; b.com returns HTTP 500.
    fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init, time: Date.now() });
      const isFailing = url.startsWith('https://b.com');
      await new Promise((r) => setTimeout(r, 50));
      if (isFailing) {
        return { ok: false, status: 500, text: async () => '{"error":"plugin down"}' };
      }
      const siteUrl = url.replace('/wp-json/ashbi/v1/magic-login', '');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ url: `${siteUrl}/wp-login.php?token=abc123` })
      };
    };
    const booted = await bootMagicLoginServer({ stubPrisma: stub, fetchImpl });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;
  });

  afterEach(async () => {
    if (app) { try { await app.close(); } catch { /* ignore */ } app = null; }
    if (restore) { try { restore(); } catch { /* ignore */ } restore = null; }
  });

  test('3-site fan-out: 2 succeed, 1 fails -> success_count=2 failure_count=1', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com', 'https://b.com', 'https://c.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(body.succeeded, 2);
    assert.equal(body.failed, 1);
    assert.ok(typeof body.opId === 'string' && body.opId.length > 0);
    assert.equal(body.results.length, 3);

    const byUrl = new Map(body.results.map((r) => [r.siteUrl, r]));
    assert.equal(byUrl.get('https://a.com').url, 'https://a.com/wp-login.php?token=abc123');
    assert.equal(byUrl.get('https://a.com').error, undefined);
    assert.equal(byUrl.get('https://b.com').url, undefined);
    assert.match(byUrl.get('https://b.com').error, /HTTP 500/);
    assert.equal(byUrl.get('https://c.com').url, 'https://c.com/wp-login.php?token=abc123');

    assert.equal(fetchCalls.length, 3);
    for (const call of fetchCalls) {
      assert.match(call.url, /\/wp-json\/ashbi\/v1\/magic-login$/);
      assert.equal(call.init.method, 'POST');
      assert.match(call.init.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
      assert.match(call.init.headers['X-Ashbi-Timestamp'], /^\d+$/);
      // Per-site body must be exactly { user_id, _timestamp } — no target metadata.
      const parsed = JSON.parse(call.init.body);
      const siteUrl = call.url.replace('/wp-json/ashbi/v1/magic-login', '');
      assert.equal(parsed.user_id, new Map([
        ['https://a.com', 11], ['https://b.com', 22], ['https://c.com', 33]
      ]).get(siteUrl));
      assert.equal(parsed.targetAll, undefined);
      assert.equal(parsed.targetSites, undefined);
      assert.equal(typeof parsed._timestamp, 'number');
    }
  });

  test('audit row persisted with op_type="magic_login" and final counts', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetAll: true
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].opType, 'magic_login');
    assert.equal(ops[0].targetCount, 3);
    assert.equal(ops[0].successCount, 2);
    assert.equal(ops[0].failureCount, 1);
    assert.equal(ops[0].createdBy, 'admin-1');
    assert.equal(ops[0].payload.mode, 'per_site_magic_login_user');
    assert.ok(ops[0].completedAt instanceof Date);
  });

  test('targetAll=true fans out to every site in wPSite', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetAll: true
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(fetchCalls.length, 3);
    const urls = fetchCalls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      'https://a.com/wp-json/ashbi/v1/magic-login',
      'https://b.com/wp-json/ashbi/v1/magic-login',
      'https://c.com/wp-json/ashbi/v1/magic-login'
    ]);
  });

  test('targetSites=[a,c] filters out b — only 2 calls made', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com', 'https://c.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(fetchCalls.length, 2);
    const urls = fetchCalls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      'https://a.com/wp-json/ashbi/v1/magic-login',
      'https://c.com/wp-json/ashbi/v1/magic-login'
    ]);
  });

  test('HMAC on every outgoing request verifies with the shared secret', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com', 'https://b.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    for (const call of fetchCalls) {
      const ok = verifyRequest({
        signatureHeader: call.init.headers['X-Ashbi-Signature'],
        timestamp: call.init.headers['X-Ashbi-Timestamp'],
        body: call.init.body,
        secret: HUB_SECRET
      });
      assert.equal(ok, true, `signature for ${call.url} must verify`);
    }
  });

  test('fan-out is concurrent: parallel requests overlap in time (not serial)', async () => {
    // Each call sleeps 80ms. With 5 sites serial = ~400ms. Concurrent = ~80ms.
    const slowFetchImpl = async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, status: 200, text: async () => '{"url":"https://x.com/wp-login.php?t=1"}' };
    };
    // Swap in the slow fetch without rebooting the server (the route closure
    // captured `fetchImpl` but executeFanOutPure passes it through).
    // We need a fresh server with the slow fetchImpl for the closure to see it.
    if (app) await app.close();
    if (restore) restore();
    ops.length = 0;
    const booted = await bootMagicLoginServer({ stubPrisma: stub, fetchImpl: slowFetchImpl });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;

    const token = makeAdminToken(app);
    const start = Date.now();
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetAll: true
    }, { authorization: `Bearer ${token}` });
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(body.succeeded, 3);
    // Serial would be ~240ms (3 * 80ms). Allow up to 200ms for parallel jitter.
    assert.ok(elapsed < 200, `expected concurrent execution (<200ms), got ${elapsed}ms (serial would be ~240ms)`);
  });

  test('auth: missing JWT -> 401', async () => {
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com']
    });
    assert.equal(res.status, 401);
  });

  test('auth: non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
  });

  test('validation: a selected site without a configured administrator -> 409', async () => {
    const token = makeAdminToken(app);
    stub.wPSite.findMany = async () => [{ id: 's1', url: 'https://a.com', name: 'A', magicLoginUserId: null }];
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 409);
  });

  test('validation: empty targetSites AND no targetAll -> 400', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetAll: false
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
  });

  test('per-site timeout: site that hangs > PER_SITE_TIMEOUT_MS counted as failure', async () => {
    // Verify the 10s PER_SITE_TIMEOUT_MS is wired up — but we test the
    // shorter path here (mock a network error) to keep the test fast.
    const networkFailFetch = async () => { throw new Error('ECONNREFUSED'); };
    if (app) await app.close();
    if (restore) restore();
    ops.length = 0;
    const booted = await bootMagicLoginServer({ stubPrisma: stub, fetchImpl: networkFailFetch });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;

    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/magic-login', {
      targetAll: true
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(body.succeeded, 0);
    assert.equal(body.failed, 3);
    for (const r of body.results) {
      assert.match(r.error, /ECONNREFUSED/);
    }
    assert.equal(ops[0].successCount, 0);
    assert.equal(ops[0].failureCount, 3);
  });
});

// ===========================================================================
// GET /api/wp-bridge/fleet/ops?op_type=magic_login
// ===========================================================================

describe('GET /api/wp-bridge/fleet/ops — magic_login filter', () => {
  let app, port, restore, stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({ sites: [], ops });
    const now = Date.now();
    ops.push({ id: 'op-1', opType: 'file_patch', payload: { filePath: '/x' }, targetCount: 2, successCount: 2, failureCount: 0, createdBy: 'admin-1', createdAt: new Date(now - 60_000), completedAt: new Date(now - 50_000) });
    ops.push({ id: 'op-2', opType: 'magic_login', payload: { user_id: 1 }, targetCount: 3, successCount: 2, failureCount: 1, createdBy: 'admin-1', createdAt: new Date(now - 30_000), completedAt: new Date(now - 25_000) });
    ops.push({ id: 'op-3', opType: 'magic_login', payload: { user_id: 5 }, targetCount: 1, successCount: 1, failureCount: 0, createdBy: 'admin-2', createdAt: new Date(now - 5_000), completedAt: new Date(now - 1_000) });

    const booted = await bootMagicLoginServer({
      stubPrisma: stub,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' })
    });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;
  });

  afterEach(async () => {
    if (app) { try { await app.close(); } catch {} app = null; }
    if (restore) { try { restore(); } catch {} restore = null; }
  });

  test('admin JWT -> 200 with ops list, magic_login rows filterable', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.ops));
    assert.equal(body.ops.length, 3);
    assert.equal(body.ops[0].opType, 'magic_login'); // newest first
  });

  test('op_type=magic_login -> 2 rows (only the magic_login ops)', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?op_type=magic_login', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ops.length, 2);
    for (const op of body.ops) {
      assert.equal(op.opType, 'magic_login');
    }
    // Newest first
    assert.equal(body.ops[0].id, 'op-3');
    assert.equal(body.ops[1].id, 'op-2');
  });

  test('op_type=file_patch -> 1 row (excludes magic_login)', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?op_type=file_patch', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ops.length, 1);
    assert.equal(body.ops[0].opType, 'file_patch');
  });

  test('non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?op_type=magic_login', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
  });
});

// ===========================================================================
// Production route file smoke check — regression guard
// ===========================================================================

describe('production route file contains the magic-login fleet endpoint (regression guard)', () => {
  test('wp-bridge.routes.js declares POST /fleet/magic-login as adminOnly', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fileURLToPath = (await import('node:url')).fileURLToPath;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const routePath = path.resolve(__dirname, '..', '..', 'routes', 'wp-bridge.routes.js');
    const src = fs.readFileSync(routePath, 'utf-8');

    assert.match(src, /fastify\.post\(\s*['"]\/fleet\/magic-login['"]/, 'must register POST /fleet/magic-login');
    assert.match(src, /\/fleet\/magic-login['"][\s\S]{0,400}adminOnly/, 'magic-login must be adminOnly');
    assert.match(src, /fleetMagicLoginSchema/, 'must declare the magic-login Zod schema');
    assert.match(src, /opType:\s*['"]magic_login['"]/, 'must persist op_type="magic_login"');
    assert.match(src, /endpoint:\s*['"]magic-login['"]/, 'must fan out to /wp-json/ashbi/v1/magic-login');
    assert.match(src, /reshapeMagicLoginResult/, 'must reshape per-site results into { siteUrl, url?, error? }');
    assert.match(src, /magicLoginUserId/, 'must require a configured per-site WP administrator');
    assert.match(src, /payloadForSite/, 'must construct the plugin payload from each target site');

    // The op_type filter enum must now include magic_login.
    assert.match(src, /['"]magic_login['"]/, 'op_type enum must include magic_login');
  });

  test('reshapeMagicLoginResult is exported from wp-bridge.routes.js', async () => {
    const mod = await import('../../routes/wp-bridge.routes.js');
    assert.equal(typeof mod.reshapeMagicLoginResult, 'function');
  });
});

// Reference PER_SITE_TIMEOUT_MS so a future refactor that breaks the
// timeout constant is caught by the import graph.
test('PER_SITE_TIMEOUT_MS exported as 10000', () => {
  assert.equal(PER_SITE_TIMEOUT_MS, 10000);
});
