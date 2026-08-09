// Integration tests for the WP-bridge fleet ops orchestrator (Plan 7).
//
// Tests:
//   1. Pure helpers (buildPerSiteRequest, aggregateFleetOpResults,
//      executeFanOutPure) — no Fastify, no DB.
//   2. Fastify integration with stub prisma + mocked fetch — exercises the
//      real route layer (admin JWT + adminOnly + global onRequest hook
//      behavior) end-to-end over real HTTP.
//
// Why this is a Fastify integration test, not a plain-Node mock test:
//   We need the route handlers + adminOnly decorator + global hooks to
//   behave correctly. A plain-Node test of `executeFanOutPure()` would prove
//   the fan-out math is right but NOT prove the route is wired correctly
//   (auth gating, body validation, the wp_fleet_ops row gets persisted).
//   Both kinds of bugs have hit this codebase before.
//
// CRITICAL: every `describe` block uses `afterEach` to close the Fastify
// server + restore env vars. Without this, an assertion failure leaves the
// server bound to its port and the test process hangs forever.
//
// Run: node --test src/tests/unit/wp-bridge-fleet-ops.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { verifyRequest } from '../../lib/hmac-client.js';
import {
  buildPerSiteRequest,
  aggregateFleetOpResults,
  executeFanOutPure,
  PER_SITE_TIMEOUT_MS
} from '../../services/fleetOps.service.js';

const HUB_SECRET = 'hub-test-secret-do-not-leak';

// ===========================================================================
// Pure helpers — no Fastify, no DB
// ===========================================================================

describe('buildPerSiteRequest — wire format', () => {
  test('strips hub-side routing fields and injects _timestamp', () => {
    const payload = {
      filePath: '/tmp/x',
      find: 'a',
      replace: 'b',
      targetSites: ['https://a.com'],
      targetAll: false,
      _timestamp: 99999 // must be stripped
    };
    const req = buildPerSiteRequest({
      siteUrl: 'https://a.com',
      endpoint: 'file/patch',
      payload,
      secret: HUB_SECRET,
      timestamp: 1718000000
    });
    assert.equal(req.url, 'https://a.com/wp-json/ashbi/v1/file/patch');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.match(req.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
    assert.equal(req.headers['X-Ashbi-Timestamp'], '1718000000');
    assert.equal(req.parsedBody._timestamp, 1718000000);
    assert.equal(req.parsedBody.targetSites, undefined);
    assert.equal(req.parsedBody.targetAll, undefined);
    assert.equal(req.parsedBody.filePath, '/tmp/x');
    // rawBody MUST be JSON.stringify(parsedBody) exactly — used for HMAC.
    assert.equal(req.rawBody, JSON.stringify(req.parsedBody));
  });

  test('outgoing HMAC verifies via replay (proves wire-format compat)', () => {
    const req = buildPerSiteRequest({
      siteUrl: 'https://a.com',
      endpoint: 'command',
      payload: { cmd: 'wp option get blogname' },
      secret: HUB_SECRET,
      timestamp: 1718000000
    });
    const ok = verifyRequest({
      signatureHeader: req.headers['X-Ashbi-Signature'],
      timestamp: req.headers['X-Ashbi-Timestamp'],
      body: req.rawBody,
      secret: HUB_SECRET
    });
    assert.equal(ok, true, 'outgoing signature must verify with replayed body+timestamp+secret');
    // And tampering with even one byte must fail verification.
    const tampered = req.rawBody.replace('blogname', 'EVILKEY');
    assert.equal(verifyRequest({
      signatureHeader: req.headers['X-Ashbi-Signature'],
      timestamp: req.headers['X-Ashbi-Timestamp'],
      body: tampered,
      secret: HUB_SECRET
    }), false, 'tampered body must NOT verify');
  });
});

describe('aggregateFleetOpResults', () => {
  test('counts ok vs error correctly', () => {
    const results = [
      { siteUrl: 'https://a.com', status: 'ok' },
      { siteUrl: 'https://b.com', status: 'error', error: 'HTTP 500' },
      { siteUrl: 'https://c.com', status: 'ok' }
    ];
    const out = aggregateFleetOpResults(results);
    assert.equal(out.succeeded, 2);
    assert.equal(out.failed, 1);
    assert.equal(out.results.length, 3);
  });

  test('empty array returns zeros', () => {
    const out = aggregateFleetOpResults([]);
    assert.equal(out.succeeded, 0);
    assert.equal(out.failed, 0);
    assert.deepEqual(out.results, []);
  });

  test('unknown status counted as failure (defensive default)', () => {
    const out = aggregateFleetOpResults([{ status: 'weird' }, { status: 'ok' }]);
    assert.equal(out.succeeded, 1);
    assert.equal(out.failed, 1);
  });
});

describe('executeFanOutPure — concurrency + isolation', () => {
  test('each site receives a signature made with only its provisioned credential', async () => {
    const seen = [];
    const mockFetch = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const sites = [
      { id: 's1', url: 'https://a.com', bridgeSecret: 'site-a-secret' },
      { id: 's2', url: 'https://b.com', bridgeSecret: 'site-b-secret' }
    ];
    const out = await executeFanOutPure({
      targetSites: sites,
      endpoint: 'command',
      payload: { cmd: 'wp option get blogname' },
      fetchImpl: mockFetch,
      now: () => 1718000000000
    });

    assert.equal(out.succeeded, 2);
    for (const [index, call] of seen.entries()) {
      const expectedSecret = sites[index].bridgeSecret;
      assert.equal(verifyRequest({
        signatureHeader: call.init.headers['X-Ashbi-Signature'],
        timestamp: call.init.headers['X-Ashbi-Timestamp'],
        body: call.init.body,
        secret: expectedSecret
      }), true);
      assert.equal(verifyRequest({
        signatureHeader: call.init.headers['X-Ashbi-Signature'],
        timestamp: call.init.headers['X-Ashbi-Timestamp'],
        body: call.init.body,
        secret: sites[1 - index].bridgeSecret
      }), false);
    }
  });

  test('an unprovisioned site fails individually without a fleet-secret fallback', async () => {
    const out = await executeFanOutPure({
      targetSites: [{ id: 's1', url: 'https://a.com', bridgeSecret: null }],
      endpoint: 'command',
      payload: { cmd: 'wp option get blogname' },
      fetchImpl: async () => { throw new Error('fetch must not run'); }
    });
    assert.equal(out.failed, 1);
    assert.match(out.results[0].error, /credential is not provisioned/);
  });

  test('empty target list short-circuits to zeros', async () => {
    const out = await executeFanOutPure({
      targetSites: [],
      endpoint: 'file/patch',
      payload: { find: 'a', replace: 'b', filePath: '/x' },
      secret: HUB_SECRET
    });
    assert.deepEqual(out, { total: 0, succeeded: 0, failed: 0, results: [] });
  });

  test('3-site fan-out: 2 ok, 1 fail -> success_count=2 failure_count=1', async () => {
    let calls = 0;
    const mockFetch = async (url, init) => {
      calls += 1;
      const isFailingSite = url.startsWith('https://b.com');
      return {
        ok: !isFailingSite,
        status: isFailingSite ? 500 : 200,
        text: async () => isFailingSite ? '{"error":"server error"}' : '{"success":true}'
      };
    };
    const out = await executeFanOutPure({
      targetSites: [
        { id: 's1', url: 'https://a.com' },
        { id: 's2', url: 'https://b.com' },
        { id: 's3', url: 'https://c.com' }
      ],
      endpoint: 'file/patch',
      payload: { filePath: '/x', find: 'a', replace: 'b' },
      secret: HUB_SECRET,
      fetchImpl: mockFetch
    });
    assert.equal(calls, 3);
    assert.equal(out.total, 3);
    assert.equal(out.succeeded, 2);
    assert.equal(out.failed, 1);
    assert.equal(out.results.length, 3);
    const byUrl = new Map(out.results.map((r) => [r.siteUrl, r]));
    assert.equal(byUrl.get('https://a.com').status, 'ok');
    assert.equal(byUrl.get('https://b.com').status, 'error');
    assert.match(byUrl.get('https://b.com').error, /HTTP 500/);
    assert.equal(byUrl.get('https://c.com').status, 'ok');
  });

  test('dryRun=true does NOT call fetch; returns the would-be request envelope', async () => {
    let calls = 0;
    const mockFetch = async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}' }; };
    const out = await executeFanOutPure({
      targetSites: [
        { id: 's1', url: 'https://a.com' },
        { id: 's2', url: 'https://b.com' }
      ],
      endpoint: 'file/patch',
      payload: { filePath: '/x', find: 'a', replace: 'b' },
      secret: HUB_SECRET,
      fetchImpl: mockFetch,
      dryRun: true
    });
    assert.equal(calls, 0, 'dryRun must NOT call fetch');
    assert.equal(out.succeeded, 2);
    assert.equal(out.failed, 0);
    for (const r of out.results) {
      assert.equal(r.status, 'ok');
      assert.equal(r.output.dryRun, true);
      assert.match(r.output.url, /\/wp-json\/ashbi\/v1\/file\/patch$/);
      assert.match(r.output.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
      assert.equal(r.output.headers['content-type'], 'application/json');
      assert.equal(r.output.method, 'POST');
      assert.equal(r.output.body._timestamp, parseInt(r.output.headers['X-Ashbi-Timestamp'], 10));
    }
  });

  test('all-failing sites (network errors) still produce per-site errors + counts', async () => {
    const mockFetch = async () => { throw new Error('ECONNREFUSED'); };
    const out = await executeFanOutPure({
      targetSites: [
        { id: 's1', url: 'https://a.com' },
        { id: 's2', url: 'https://b.com' }
      ],
      endpoint: 'command',
      payload: { cmd: 'wp option get blogname' },
      secret: HUB_SECRET,
      fetchImpl: mockFetch
    });
    assert.equal(out.total, 2);
    assert.equal(out.succeeded, 0);
    assert.equal(out.failed, 2);
    for (const r of out.results) {
      assert.equal(r.status, 'error');
      assert.match(r.error, /ECONNREFUSED/);
    }
  });

  test('fan-out is concurrent: parallel requests overlap in time (not serial)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const mockFetch = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 80));
      inFlight -= 1;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const out = await executeFanOutPure({
      targetSites: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, url: `https://s${i}.com` })),
      endpoint: 'command',
      payload: { cmd: 'wp option get blogname' },
      secret: HUB_SECRET,
      fetchImpl: mockFetch
    });
    assert.equal(out.total, 5);
    assert.equal(out.succeeded, 5);
    assert.ok(maxInFlight > 1, `expected overlapping requests, observed max concurrency ${maxInFlight}`);
  });
});

// ===========================================================================
// Fastify integration — inline route handlers + stub prisma + mocked fetch
// ===========================================================================
//
// Mirrors PR #220's test pattern: don't import the production route file
// directly because it boots the daily digest cron on plugin registration.
// Instead, inline minimal handlers that mirror the production ones (same
// adminOnly decorator shape, same body validation, same fetch wiring).

function makeStubPrisma({ sites = [], ops = [] } = {}) {
  return {
    wPSite: {
      findMany: async ({ where } = {}) => {
        let rows = sites;
        if (where && Array.isArray(where.url?.in)) {
          const set = new Set(where.url.in);
          rows = sites.filter((s) => set.has(s.url));
        }
        return rows.map((s) => ({ id: s.id, url: s.url, name: s.name }));
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

async function bootOpsServer({ stubPrisma, fetchImpl, routeValidator }) {
  const prevSecret = process.env.WP_BRIDGE_SECRET;
  process.env.WP_BRIDGE_SECRET = HUB_SECRET;
  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-jwt-secret-32-chars-long-xxxxxx';

  const fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });

  // Admin auth decorator — same shape as production (src/index.js lines 166-171).
  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  fastify.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  function validateFleetRequest(body) {
    if (!body || typeof body !== 'object') return { error: 'Request body required' };
    const { targetSites, targetAll } = body;
    if (targetAll !== true && (!Array.isArray(targetSites) || targetSites.length === 0)) {
      return { error: 'Either targetAll=true or a non-empty targetSites[] is required' };
    }
    return null;
  }

  async function executeFleetOpStub({ opType, payload, targetSites, endpoint, createdBy, dryRun = false }) {
    const opId = (await stubPrisma.wPFleetOp.create({
      data: { opType, payload, targetCount: targetSites.length, createdBy }
    })).id;
    const fan = await executeFanOutPure({
      targetSites,
      endpoint,
      payload,
      secret: process.env.WP_BRIDGE_SECRET,
      fetchImpl,
      dryRun
    });
    await stubPrisma.wPFleetOp.update({
      where: { id: opId },
      data: { successCount: fan.succeeded, failureCount: fan.failed, completedAt: new Date() }
    });
    return { opId, total: fan.total, succeeded: fan.succeeded, failed: fan.failed, results: fan.results };
  }

  fastify.post('/api/wp-bridge/fleet/file/patch', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const err = validateFleetRequest(request.body);
    if (err) return reply.status(400).send(err);
    const { filePath, find, replace, targetSites, targetAll, dryRun } = request.body;
    if (!filePath || typeof find !== 'string' || typeof replace !== 'string') {
      return reply.status(400).send({ error: 'filePath, find, replace are required strings' });
    }
    const sites = await stubPrisma.wPSite.findMany({
      where: targetAll ? undefined : { url: { in: targetSites } },
      select: { id: true, url: true, name: true }
    });
    if (sites.length === 0) return reply.status(404).send({ error: 'No matching sites found' });
    return executeFleetOpStub({
      opType: 'file_patch',
      payload: { filePath, find, replace },
      targetSites: sites,
      endpoint: 'file/patch',
      createdBy: request.user.id,
      dryRun: !!dryRun
    });
  });

  fastify.post('/api/wp-bridge/fleet/command', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const err = validateFleetRequest(request.body);
    if (err) return reply.status(400).send(err);
    const { cmd, targetSites, targetAll } = request.body;
    if (!cmd || typeof cmd !== 'string') return reply.status(400).send({ error: 'cmd is required (string)' });
    const sites = await stubPrisma.wPSite.findMany({
      where: targetAll ? undefined : { url: { in: targetSites } },
      select: { id: true, url: true, name: true }
    });
    if (sites.length === 0) return reply.status(404).send({ error: 'No matching sites found' });
    return executeFleetOpStub({
      opType: 'command',
      payload: { cmd },
      targetSites: sites,
      endpoint: 'command',
      createdBy: request.user.id
    });
  });

  fastify.post('/api/wp-bridge/fleet/option/set', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const err = validateFleetRequest(request.body);
    if (err) return reply.status(400).send(err);
    const { name, value, targetSites, targetAll } = request.body;
    if (!name || typeof name !== 'string') return reply.status(400).send({ error: 'name is required (string)' });
    if (value === undefined) return reply.status(400).send({ error: 'value is required (cannot be undefined)' });
    const sites = await stubPrisma.wPSite.findMany({
      where: targetAll ? undefined : { url: { in: targetSites } },
      select: { id: true, url: true, name: true }
    });
    if (sites.length === 0) return reply.status(404).send({ error: 'No matching sites found' });
    return executeFleetOpStub({
      opType: 'option_set',
      payload: { name, value },
      targetSites: sites,
      endpoint: 'option/set',
      createdBy: request.user.id
    });
  });

  fastify.get('/api/wp-bridge/fleet/ops', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { limit, op_type: opType } = request.query;
    if (opType && !['file_patch', 'command', 'option_set'].includes(opType)) {
      return reply.status(400).send({ error: 'op_type must be one of file_patch | command | option_set' });
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
// /api/wp-bridge/fleet/file/patch — fan-out integration
// ===========================================================================

describe('POST /api/wp-bridge/fleet/file/patch — Fastify integration', () => {
  let app, port, restore, fetchCalls, fetchImpl;
  let stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({
      sites: [
        { id: 's1', url: 'https://a.com', name: 'A' },
        { id: 's2', url: 'https://b.com', name: 'B' },
        { id: 's3', url: 'https://c.com', name: 'C' }
      ],
      ops
    });
    fetchCalls = [];
    fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init, time: Date.now() });
      const isFailing = url.startsWith('https://b.com');
      await new Promise((r) => setTimeout(r, 50));
      return {
        ok: !isFailing,
        status: isFailing ? 500 : 200,
        text: async () => isFailing ? '{"error":"plugin crash"}' : '{"success":true,"changed":1}'
      };
    };
    const booted = await bootOpsServer({ stubPrisma: stub, fetchImpl });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;
  });

  afterEach(async () => {
    if (app) { try { await app.close(); } catch { /* ignore */ } app = null; }
    if (restore) { try { restore(); } catch { /* ignore */ } restore = null; }
  });

  test('3-site fan-out: 2 succeed, 1 fails -> success=2 failure=1, results match', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/srv/www/wp-config.php',
      find: 'WP_DEBUG = false',
      replace: 'WP_DEBUG = true',
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
    assert.equal(byUrl.get('https://a.com').status, 'ok');
    assert.equal(byUrl.get('https://a.com').output.httpStatus, 200);
    assert.equal(byUrl.get('https://b.com').status, 'error');
    assert.match(byUrl.get('https://b.com').error, /HTTP 500/);
    assert.equal(byUrl.get('https://c.com').status, 'ok');

    assert.equal(fetchCalls.length, 3);
    for (const call of fetchCalls) {
      assert.match(call.url, /\/wp-json\/ashbi\/v1\/file\/patch$/);
      assert.equal(call.init.method, 'POST');
      assert.match(call.init.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
      assert.match(call.init.headers['X-Ashbi-Timestamp'], /^\d+$/);
    }

    // One wp_fleet_ops row persisted, completedAt set.
    assert.equal(ops.length, 1);
    assert.equal(ops[0].opType, 'file_patch');
    assert.equal(ops[0].targetCount, 3);
    assert.equal(ops[0].successCount, 2);
    assert.equal(ops[0].failureCount, 1);
    assert.equal(ops[0].createdBy, 'admin-1');
    assert.ok(ops[0].completedAt instanceof Date);
  });

  test('HMAC on every outgoing request verifies with the shared secret', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b',
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

  test('targetAll=true calls every site in wPSite (NOT a subset)', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b', targetAll: true
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(fetchCalls.length, 3);
    const urls = fetchCalls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      'https://a.com/wp-json/ashbi/v1/file/patch',
      'https://b.com/wp-json/ashbi/v1/file/patch',
      'https://c.com/wp-json/ashbi/v1/file/patch'
    ]);
  });

  test('targetSites=[a,c] filters out b — only 2 calls made', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b',
      targetSites: ['https://a.com', 'https://c.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(fetchCalls.length, 2);
    const urls = fetchCalls.map((c) => c.url).sort();
    assert.deepEqual(urls, [
      'https://a.com/wp-json/ashbi/v1/file/patch',
      'https://c.com/wp-json/ashbi/v1/file/patch'
    ]);
  });

  test('dryRun=true: NO POST sent to plugin, body still contains the would-be envelope', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/srv/wp-config.php', find: 'old', replace: 'new',
      targetSites: ['https://a.com', 'https://b.com', 'https://c.com'],
      dryRun: true
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);
    assert.equal(body.succeeded, 3);
    assert.equal(fetchCalls.length, 0, 'dryRun must NOT POST to the plugin');
    for (const r of body.results) {
      assert.equal(r.status, 'ok');
      assert.equal(r.output.dryRun, true);
      assert.equal(r.output.method, 'POST');
      assert.match(r.output.url, /\/wp-json\/ashbi\/v1\/file\/patch$/);
      assert.match(r.output.headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
      assert.equal(r.output.headers['content-type'], 'application/json');
      assert.equal(r.output.body.filePath, '/srv/wp-config.php');
      assert.equal(r.output.body.find, 'old');
      assert.equal(r.output.body.replace, 'new');
    }
    assert.equal(ops.length, 1);
    assert.equal(ops[0].successCount, 3);
    assert.equal(ops[0].failureCount, 0);
  });

  test('auth: missing JWT -> 401', async () => {
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b', targetSites: ['https://a.com']
    });
    assert.equal(res.status, 401);
  });

  test('auth: non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b', targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
  });

  test('validation: empty targetSites AND no targetAll -> 400', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/file/patch', {
      filePath: '/x', find: 'a', replace: 'b'
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// /api/wp-bridge/fleet/command + /option/set — parallel coverage
// ===========================================================================

describe('POST /api/wp-bridge/fleet/command', () => {
  let app, port, restore, fetchCalls, fetchImpl, stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({
      sites: [
        { id: 's1', url: 'https://a.com', name: 'A' },
        { id: 's2', url: 'https://b.com', name: 'B' }
      ],
      ops
    });
    fetchCalls = [];
    fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"stdout":"3.14"}' };
    };
    const booted = await bootOpsServer({ stubPrisma: stub, fetchImpl });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;
  });

  afterEach(async () => {
    if (app) { try { await app.close(); } catch {} app = null; }
    if (restore) { try { restore(); } catch {} restore = null; }
  });

  test('forwards cmd to /wp-json/ashbi/v1/command with HMAC', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/command', {
      cmd: 'wp option get blogname',
      targetSites: ['https://a.com', 'https://b.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.succeeded, 2);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].opType, 'command');
    for (const call of fetchCalls) {
      assert.match(call.url, /\/wp-json\/ashbi\/v1\/command$/);
      const parsed = JSON.parse(call.init.body);
      assert.equal(parsed.cmd, 'wp option get blogname');
    }
  });

  test('non-admin -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/command', {
      cmd: 'x', targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
  });
});

describe('POST /api/wp-bridge/fleet/option/set', () => {
  let app, port, restore, fetchCalls, fetchImpl, stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({
      sites: [{ id: 's1', url: 'https://a.com', name: 'A' }],
      ops
    });
    fetchCalls = [];
    fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"success":true}' };
    };
    const booted = await bootOpsServer({ stubPrisma: stub, fetchImpl });
    app = booted.fastify;
    port = app.server.address().port;
    restore = booted.restore;
  });

  afterEach(async () => {
    if (app) { try { await app.close(); } catch {} app = null; }
    if (restore) { try { restore(); } catch {} restore = null; }
  });

  test('forwards name+value (JSON value supported)', async () => {
    const token = makeAdminToken(app);
    const complexValue = { theme: 'twentytwentyfour', mods: [1, 2, 3] };
    const res = await postJson(port, '/api/wp-bridge/fleet/option/set', {
      name: 'ashbi_config',
      value: complexValue,
      targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.succeeded, 1);
    assert.equal(ops[0].opType, 'option_set');
    const parsed = JSON.parse(fetchCalls[0].init.body);
    assert.deepEqual(parsed.value, complexValue);
  });

  test('value undefined -> 400', async () => {
    const token = makeAdminToken(app);
    const res = await postJson(port, '/api/wp-bridge/fleet/option/set', {
      name: 'foo', targetSites: ['https://a.com']
    }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// GET /api/wp-bridge/fleet/ops
// ===========================================================================

describe('GET /api/wp-bridge/fleet/ops', () => {
  let app, port, restore, stub, ops;

  beforeEach(async () => {
    ops = [];
    stub = makeStubPrisma({ sites: [], ops });
    // Seed 3 prior ops.
    const now = Date.now();
    ops.push({ id: 'op-1', opType: 'file_patch', payload: { filePath: '/x' }, targetCount: 2, successCount: 2, failureCount: 0, createdBy: 'admin-1', createdAt: new Date(now - 60_000), completedAt: new Date(now - 50_000) });
    ops.push({ id: 'op-2', opType: 'command', payload: { cmd: 'wp option get blogname' }, targetCount: 5, successCount: 4, failureCount: 1, createdBy: 'admin-1', createdAt: new Date(now - 30_000), completedAt: new Date(now - 25_000) });
    ops.push({ id: 'op-3', opType: 'option_set', payload: { name: 'foo', value: 1 }, targetCount: 1, successCount: 0, failureCount: 1, createdBy: 'admin-2', createdAt: new Date(now - 5_000), completedAt: new Date(now - 1_000) });

    const booted = await bootOpsServer({
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

  test('admin JWT -> 200 with ops list, newest first', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.ops));
    assert.equal(body.ops.length, 3);
    assert.equal(body.ops[0].id, 'op-3');
    assert.equal(body.ops[1].id, 'op-2');
    assert.equal(body.ops[2].id, 'op-1');
    for (const op of body.ops) {
      assert.ok(typeof op.opType === 'string');
      assert.equal(typeof op.targetCount, 'number');
      assert.equal(typeof op.successCount, 'number');
      assert.equal(typeof op.failureCount, 'number');
      assert.ok(typeof op.createdBy === 'string');
      assert.ok(op.createdAt);
    }
  });

  test('op_type filter narrows results', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?op_type=command', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ops.length, 1);
    assert.equal(body.ops[0].opType, 'command');
  });

  test('limit query caps results', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?limit=2', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ops.length, 2);
  });

  test('invalid op_type -> 400', async () => {
    const token = makeAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops?op_type=bogus', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
  });

  test('non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await getJson(port, '/api/wp-bridge/fleet/ops', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
  });
});

// ===========================================================================
// Production route file smoke check
// ===========================================================================

describe('production route file contains the fleet ops endpoints (regression guard)', () => {
  test('wp-bridge.routes.js declares all 3 fleet endpoints + list endpoint, all adminOnly', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fileURLToPath = (await import('node:url')).fileURLToPath;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const routePath = path.resolve(__dirname, '..', '..', 'routes', 'wp-bridge.routes.js');
    const src = fs.readFileSync(routePath, 'utf-8');

    assert.match(src, /fastify\.post\(\s*['"]\/fleet\/file\/patch['"]/, 'must register POST /fleet/file/patch');
    assert.match(src, /fastify\.post\(\s*['"]\/fleet\/command['"]/, 'must register POST /fleet/command');
    assert.match(src, /fastify\.post\(\s*['"]\/fleet\/option\/set['"]/, 'must register POST /fleet/option/set');
    assert.match(src, /fastify\.get\(\s*['"]\/fleet\/ops['"]/, 'must register GET /fleet/ops');

    // Each endpoint must use adminOnly.
    assert.match(src, /\/fleet\/file\/patch['"][\s\S]{0,400}adminOnly/, 'file/patch must be adminOnly');
    assert.match(src, /\/fleet\/command['"][\s\S]{0,400}adminOnly/, 'command must be adminOnly');
    assert.match(src, /\/fleet\/option\/set['"][\s\S]{0,400}adminOnly/, 'option/set must be adminOnly');
    assert.match(src, /\/fleet\/ops['"][\s\S]{0,400}adminOnly/, 'list endpoint must be adminOnly');

    assert.match(src, /from\s+['"]\.\.\/services\/fleetOps\.service\.js['"]/, 'must import fleetOps service');

    const svcPath = path.resolve(__dirname, '..', '..', 'services', 'fleetOps.service.js');
    const svcSrc = fs.readFileSync(svcPath, 'utf-8');
    assert.match(svcSrc, /Promise\.all/, 'service must use Promise.all for concurrent fan-out');
  });
});
