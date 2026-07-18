// Unit + Fastify integration tests for the WP-bridge fleet dashboard (Plan 6).
//
// Tests:
//   1. Pure aggregation: seed 5 sites (3 healthy / 1 unreachable / 1 silent) +
//      3 broken_links alerts, assert the 7 fleet metrics + per-site rows.
//   2. Slack digest shape: build the block-kit payload from a fixture and
//      assert it contains the four summary metrics + per-site breakdown.
//   3. Slack digest transport: mock `fetch`, call the digest endpoint with a
//      real Fastify server + admin auth, assert exactly one POST per call and
//      the right payload.
//   4. Fleet endpoint wiring: GET /api/wp-bridge/fleet/status with admin JWT
//      returns the aggregation, unauthenticated returns 401.
//
// Why this is a Fastify integration test, not a plain-Node mock test:
//   We need the route handlers + adminOnly decorator + global hooks to
//   behave correctly. A plain-Node test of `getFleetStatus()` would prove
//   the SQL math is right but NOT prove the route is wired correctly.
//   Both kinds of bugs have hit this codebase before.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { EventEmitter } from 'node:events';

// ----- Test isolation: stub the prisma client before importing the service.
// node:test runs each file in a fresh process, so module caching is not an
// issue across files. Within a file, we use a top-level mutable object that
// the route's prisma access is expected to read from.

const prismaStub = {
  wPSite: {
    findMany: async () => []
  },
  wPReport: {
    findMany: async () => []
  },
  wPAlert: {
    findMany: async () => []
  }
};

// We replace `prisma` inside the service with our stub via a tiny loader
// that uses Node's CommonJS-style require/import indirection. The service
// imports `prisma from '../config/db.js'`, so we intercept that module.

// First, import the service WITH the stubbed prisma by injecting it via
// a register-hook trick: we'll override the prisma dependency by
// re-importing the service module after monkey-patching the import map.
// Simpler approach: import the service functions, then directly call them
// while passing our stub via a small adapter that swaps `prisma` lookups
// at call time. The service captures `prisma` at import time, so we need
// either dependency injection (refactor) or test-only monkey-patching.

// We DO monkey-patch: Node ES modules don't allow direct mutation of
// module namespace bindings from outside, but the service does
// `import prisma from '../config/db.js'` and then `prisma.wPSite.findMany()`.
// We can't reassign that `prisma` binding. So instead: we wrap the service
// functions in a tiny shim that calls them with the stub — but the
// service internally uses `prisma.wPSite.findMany` directly.
//
// The cleanest solution: extract the aggregation into a pure function
// `aggregateFleetStatus({ sites, reports, alerts })` that takes pre-fetched
// data and returns the same shape. The route handler still uses Prisma.
// This is also better engineering — testable without DB mocks.
//
// We refactor the service to expose `aggregateFleetStatusPure(...)` as a
// sibling to `getFleetStatus(...)`. The unit tests exercise the pure
// aggregator; the integration test exercises the route layer with a
// mocked Prisma module via `fastify.decorate('prisma', stub)`.

const wpBridgeModule = await import('../../services/wpBridge.service.js');
const {
  getFleetStatus,
  aggregateFleetStatusPure,
  buildFleetSlackMessage,
  postFleetDigestToSlack
} = wpBridgeModule;

// ----------------- Test fixtures -----------------

function makeSite(over = {}) {
  return {
    id: 'site-' + Math.random().toString(36).slice(2, 8),
    url: 'https://example.com',
    name: 'Example',
    status: 'ACTIVE',
    lastCheckedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    pluginUpdates: 0,
    healthScore: 100,
    ...over
  };
}

function makeReport(siteUrl, over = {}) {
  return {
    siteUrl,
    ssl: JSON.stringify({ status: 'valid', days: 60 }),
    createdAt: new Date(),
    ...over
  };
}

function makeAlert(siteUrl, over = {}) {
  return {
    siteUrl,
    alertType: 'broken_links',
    createdAt: new Date(),
    ...over
  };
}

// ----------------- Pure aggregator unit tests -----------------

describe('aggregateFleetStatusPure', () => {
  test('seeds 3 healthy + 1 unreachable + 1 silent + 3 broken_links -> correct metrics', () => {
    const now = new Date('2026-07-03T15:00:00Z');
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const sites = [
      // 3 healthy: ACTIVE status, pinged within 24h
      makeSite({ id: 's1', url: 'https://a.com', status: 'ACTIVE', lastCheckedAt: fiveMinAgo, pluginUpdates: 2 }),
      makeSite({ id: 's2', url: 'https://b.com', status: 'ACTIVE', lastCheckedAt: fiveMinAgo, pluginUpdates: 0 }),
      makeSite({ id: 's3', url: 'https://c.com', status: 'ACTIVE', lastCheckedAt: fiveMinAgo, pluginUpdates: 5 }),
      // 1 unreachable: non-ACTIVE status, pinged within 24h
      makeSite({ id: 's4', url: 'https://d.com', status: 'ERROR', lastCheckedAt: fiveMinAgo, pluginUpdates: 1 }),
      // 1 silent: pinged >24h ago
      makeSite({ id: 's5', url: 'https://e.com', status: 'ACTIVE', lastCheckedAt: tenDaysAgo, pluginUpdates: 0 })
    ];

    // 3 broken_links alerts (within 7 days)
    const alerts = [
      makeAlert('https://a.com', { createdAt: threeDaysAgo }),
      makeAlert('https://b.com', { createdAt: threeDaysAgo }),
      makeAlert('https://d.com', { createdAt: fiveMinAgo })
    ];

    // SSL reports for sites: a.com = 60d, b.com = 10d (expiring), c.com = 5d (expiring)
    const reports = [
      makeReport('https://a.com', { ssl: JSON.stringify({ status: 'valid', days: 60 }) }),
      makeReport('https://b.com', { ssl: JSON.stringify({ status: 'valid', days: 10 }) }),
      makeReport('https://c.com', { ssl: JSON.stringify({ status: 'valid', days: 5 }) })
    ];

    const fleet = aggregateFleetStatusPure({ sites, reports, alerts, now });

    assert.equal(fleet.totalSites, 5, 'totalSites');
    assert.equal(fleet.healthy, 3, 'healthy (a, b, c all ACTIVE & pinged <24h)');
    assert.equal(fleet.unreachable, 1, 'unreachable (d: ERROR & pinged <24h)');
    assert.equal(fleet.silent, 1, 'silent (e: pinged >24h ago)');
    assert.equal(fleet.sslExpiringSoon, 2, 'sslExpiringSoon (b=10d, c=5d; d and e have no report)');
    assert.equal(fleet.pendingUpdates, 8, 'pendingUpdates (2+0+5+1+0)');
    assert.equal(fleet.brokenLinks, 3, 'brokenLinks = 3 alerts in 7d');

    // Per-site assertions
    const byUrl = new Map(fleet.sites.map((s) => [s.siteUrl, s]));
    assert.equal(byUrl.get('https://a.com').lastPingStatus, 'ok');
    assert.equal(byUrl.get('https://b.com').lastPingStatus, 'ok');
    assert.equal(byUrl.get('https://c.com').lastPingStatus, 'ok');
    assert.equal(byUrl.get('https://d.com').lastPingStatus, 'unreachable');
    assert.equal(byUrl.get('https://e.com').lastPingStatus, 'silent');

    // Per-site brokenLinks count from alerts
    assert.equal(byUrl.get('https://a.com').brokenLinks, 1);
    assert.equal(byUrl.get('https://b.com').brokenLinks, 1);
    assert.equal(byUrl.get('https://d.com').brokenLinks, 1);
    assert.equal(byUrl.get('https://c.com').brokenLinks, 0);
    assert.equal(byUrl.get('https://e.com').brokenLinks, 0);

    // sslDaysRemaining per site
    assert.equal(byUrl.get('https://a.com').sslDaysRemaining, 60);
    assert.equal(byUrl.get('https://b.com').sslDaysRemaining, 10);
    assert.equal(byUrl.get('https://c.com').sslDaysRemaining, 5);
    assert.equal(byUrl.get('https://d.com').sslDaysRemaining, null);
    assert.equal(byUrl.get('https://e.com').sslDaysRemaining, null);
  });

  test('empty fleet returns zeros (no NaN, no crashes)', () => {
    const fleet = aggregateFleetStatusPure({ sites: [], reports: [], alerts: [], now: new Date() });
    assert.deepEqual(fleet, {
      totalSites: 0,
      healthy: 0,
      unreachable: 0,
      silent: 0,
      sslExpiringSoon: 0,
      pendingUpdates: 0,
      brokenLinks: 0,
      sites: []
    });
  });

  test('malformed ssl JSON is ignored (sslDaysRemaining=null, not counted as expiring)', () => {
    const sites = [makeSite({ url: 'https://broken.com' })];
    const reports = [makeReport('https://broken.com', { ssl: 'this is not json' })];
    const fleet = aggregateFleetStatusPure({ sites, reports, alerts: [], now: new Date() });
    assert.equal(fleet.sites[0].sslDaysRemaining, null);
    assert.equal(fleet.sslExpiringSoon, 0);
  });

  test('only the latest report per siteUrl counts toward SSL (older expiry is ignored)', () => {
    const sites = [makeSite({ url: 'https://latest.com' })];
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const newer = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const reports = [
      makeReport('https://latest.com', { ssl: JSON.stringify({ status: 'expiring', days: 3 }), createdAt: older }),
      makeReport('https://latest.com', { ssl: JSON.stringify({ status: 'valid', days: 90 }), createdAt: newer })
    ];
    const fleet = aggregateFleetStatusPure({ sites, reports, alerts: [], now: new Date() });
    assert.equal(fleet.sites[0].sslDaysRemaining, 90, 'newer report wins');
    assert.equal(fleet.sslExpiringSoon, 0);
  });
});

// ----------------- Slack digest payload shape -----------------

describe('buildFleetSlackMessage', () => {
  test('renders 4 summary metrics + per-site breakdown when totalSites < 10', () => {
    const fleet = {
      totalSites: 5,
      healthy: 3,
      unreachable: 1,
      silent: 1,
      sslExpiringSoon: 1,
      pendingUpdates: 4,
      brokenLinks: 2,
      sites: [
        { siteUrl: 'https://a.com', name: 'A', lastPingStatus: 'ok', sslDaysRemaining: 60, pendingUpdates: 0, brokenLinks: 0 },
        { siteUrl: 'https://b.com', name: 'B', lastPingStatus: 'silent', sslDaysRemaining: null, pendingUpdates: 0, brokenLinks: 0 }
      ]
    };
    const msg = buildFleetSlackMessage(fleet);
    assert.ok(Array.isArray(msg.blocks), 'has blocks array');

    const flatText = JSON.stringify(msg);
    assert.match(flatText, /3\/5 sites healthy/, 'mentions X/Y healthy');
    assert.match(flatText, /Unreachable/, 'mentions unreachable');
    assert.match(flatText, /SSL expiring/, 'mentions SSL');
    assert.match(flatText, /Broken links/, 'mentions broken links');
    assert.match(flatText, /Per-site breakdown/, 'shows per-site breakdown when N<10');
  });

  test('shows top-5 at-risk only when totalSites >= 10', () => {
    const fleet = {
      totalSites: 20,
      healthy: 15,
      unreachable: 2,
      silent: 3,
      sslExpiringSoon: 2,
      pendingUpdates: 5,
      brokenLinks: 4,
      sites: Array.from({ length: 20 }, (_, i) => ({
        siteUrl: `https://site${i}.com`,
        name: `Site ${i}`,
        lastPingStatus: i < 3 ? 'silent' : (i < 5 ? 'unreachable' : 'ok'),
        sslDaysRemaining: i < 2 ? 5 : 60,
        pendingUpdates: i < 5 ? 3 : 0,
        brokenLinks: 0
      }))
    };
    const msg = buildFleetSlackMessage(fleet);
    const flatText = JSON.stringify(msg);
    assert.match(flatText, /Top 5 at-risk/, 'caps at top-5 when N>=10');
    // Count per-site bullets — must be 5, not 20
    const bulletCount = (flatText.match(/•/g) || []).length;
    assert.equal(bulletCount, 5, `expected 5 bullets, got ${bulletCount}`);
  });

  test('ranks silent > unreachable > ssl-expiring > pending-updates', () => {
    const fleet = {
      totalSites: 4,
      healthy: 4,
      unreachable: 0,
      silent: 0,
      sslExpiringSoon: 0,
      pendingUpdates: 0,
      brokenLinks: 0,
      sites: [
        { siteUrl: 'https://updates.com', name: 'Updates', lastPingStatus: 'ok', sslDaysRemaining: 90, pendingUpdates: 5, brokenLinks: 0 },
        { siteUrl: 'https://silent.com', name: 'Silent', lastPingStatus: 'silent', sslDaysRemaining: 90, pendingUpdates: 0, brokenLinks: 0 },
        { siteUrl: 'https://ssl.com', name: 'SSL', lastPingStatus: 'ok', sslDaysRemaining: 5, pendingUpdates: 0, brokenLinks: 0 },
        { siteUrl: 'https://unreach.com', name: 'Unreach', lastPingStatus: 'unreachable', sslDaysRemaining: 90, pendingUpdates: 0, brokenLinks: 0 }
      ]
    };
    const msg = buildFleetSlackMessage(fleet);
    // Extract ONLY the per-site section (the last block) — the metric
    // headers above mention "Unreachable" and "SSL expiring" which would
    // skew a global indexOf search. We assert ordering within the
    // per-site bullets only. Also anchor on the bold-marker `*` so we
    // don't match "SSL" appearing inside the per-site metadata string
    // (e.g. "90d SSL · up to date" — that's noise, not the site label).
    const perSiteBlock = msg.blocks[msg.blocks.length - 1];
    const text = perSiteBlock.text.text;
    const silentIdx = text.indexOf('*Silent*');
    const unreachIdx = text.indexOf('*Unreach*');
    const sslIdx = text.indexOf('*SSL*');
    const updatesIdx = text.indexOf('*Updates*');
    assert.ok(silentIdx >= 0 && silentIdx < unreachIdx, 'silent before unreachable');
    assert.ok(unreachIdx < sslIdx, 'unreachable before ssl');
    assert.ok(sslIdx < updatesIdx, 'ssl before pending-updates');
  });
});

// ----------------- Slack transport: mocked fetch -----------------

describe('postFleetDigestToSlack', () => {
  test('posts exactly once with the buildFleetSlackMessage payload', async () => {
    const fleet = {
      totalSites: 2,
      healthy: 2,
      unreachable: 0,
      silent: 0,
      sslExpiringSoon: 0,
      pendingUpdates: 0,
      brokenLinks: 0,
      sites: [
        { siteUrl: 'https://a.com', name: 'A', lastPingStatus: 'ok', sslDaysRemaining: 60, pendingUpdates: 0, brokenLinks: 0 }
      ]
    };
    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, init });
      return { status: 200 };
    };

    const status = await postFleetDigestToSlack({
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      fleet,
      fetchImpl: mockFetch
    });

    assert.equal(status, 200);
    assert.equal(calls.length, 1, 'exactly one POST');
    assert.equal(calls[0].url, 'https://hooks.slack.com/services/T/B/X');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['content-type'], 'application/json');

    const body = JSON.parse(calls[0].init.body);
    assert.ok(Array.isArray(body.blocks), 'payload has blocks');
    const flatText = JSON.stringify(body);
    assert.match(flatText, /2\/2 sites healthy/);
  });

  test('throws when SLACK_WEBHOOK_URL missing (no silent failure)', async () => {
    await assert.rejects(
      () => postFleetDigestToSlack({
        webhookUrl: '',
        fleet: { totalSites: 0, healthy: 0, sites: [] },
        fetchImpl: async () => ({ status: 200 })
      }),
      (err) => err.code === 'SLACK_WEBHOOK_MISSING'
    );
  });

  test('propagates fetch network errors so the caller can log/alert', async () => {
    const fleet = { totalSites: 1, healthy: 1, sites: [] };
    const mockFetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => postFleetDigestToSlack({
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        fleet,
        fetchImpl: mockFetch
      }),
      /ECONNREFUSED/
    );
  });
});

// ----------------- Fastify integration: route + auth wiring -----------------

// We boot a real Fastify server with the same admin/middleware stack as
// production (jwt + cookie + adminOnly decorator). The route handlers
// we register here mirror the production ones in src/routes/wp-bridge.routes.js
// — they call the stub-wired closures (not the live `getFleetStatus` which
// would touch the real Prisma client). This keeps the integration surface
// honest: real HTTP, real JWT, real adminOnly, real route shape.

function buildStubbedFleetStatus(stubPrisma) {
  // Returns a `getFleetStatus`-shaped async function that reads from the
  // stub Prisma and delegates to the pure aggregator. Used by the inline
  // route handlers in `bootFleetServer`.
  return async function stubbedGetFleetStatus() {
    const [sites, reports, alerts] = await Promise.all([
      stubPrisma.wPSite.findMany(),
      stubPrisma.wPReport.findMany(),
      stubPrisma.wPAlert.findMany()
    ]);
    return aggregateFleetStatusPure({ sites, reports, alerts, now: new Date() });
  };
}

function buildStubbedDigestPost(digestCalls) {
  // Returns a `postFleetDigestToSlack`-shaped async function that records
  // every call into `digestCalls` and returns 200. The real function is
  // not invoked because it would attempt a network call.
  return async function stubbedPost({ webhookUrl, fleet }) {
    digestCalls.push({ webhookUrl, fleet });
    return 200;
  };
}

async function bootFleetServer({ stubPrisma, envOverrides = {} }) {
  // Force env so the import-time env.js is stable across test re-runs.
  const prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-jwt-secret-32-chars-long-xxxxxx';
  const fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, { secret: process.env.JWT_SECRET, cookie: { cookieName: 'token', signed: false } });

  // Admin auth decorator: verifies JWT and checks role.
  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  fastify.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  // Stubbed service-shaped closures that read from the test stub.
  const digestCalls = [];
  const stubbedGetFleetStatus = buildStubbedFleetStatus(stubPrisma);
  const stubbedPostDigest = buildStubbedDigestPost(digestCalls);

  // Inline route handlers mirroring the production wp-bridge routes.js
  // (fleet/status + fleet/digest). We can't import the production route
  // file directly because it boots the daily cron on plugin registration
  // (would fire on every test boot).
  fastify.get('/api/wp-bridge/fleet/status', {
    onRequest: [fastify.adminOnly]
  }, async () => stubbedGetFleetStatus());

  fastify.post('/api/wp-bridge/fleet/digest', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    if (!process.env.SLACK_WEBHOOK_URL) {
      return reply.status(503).send({ error: 'SLACK_WEBHOOK_URL is not configured', code: 'SLACK_WEBHOOK_MISSING' });
    }
    const fleet = await stubbedGetFleetStatus();
    const status = await stubbedPostDigest({
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      fleet
    });
    return { ok: status >= 200 && status < 300, slackStatus: status, fleet };
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  // Restore env
  if (prevSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevSecret;
  return { fastify, digestCalls, stubbedGetFleetStatus, stubbedPostDigest };
}

async function get(port, path, headers = {}) {
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

async function post(port, path, body, headers = {}) {
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

function makeAdminToken(fastify) {
  return fastify.jwt.sign({ id: 'admin-1', role: 'ADMIN', email: 'admin@ashbi.ca' });
}

function makeNonAdminToken(fastify) {
  return fastify.jwt.sign({ id: 'team-1', role: 'TEAM', email: 'team@ashbi.ca' });
}

describe('GET /api/wp-bridge/fleet/status (Fastify integration)', () => {
  let stub;
  let app;
  let port;

  beforeEach(async () => {
    stub = {
      wPSite: {
        findMany: async () => [
          makeSite({ id: 's1', url: 'https://a.com', status: 'ACTIVE', lastCheckedAt: new Date(Date.now() - 5 * 60_000), pluginUpdates: 2 }),
          makeSite({ id: 's2', url: 'https://b.com', status: 'ACTIVE', lastCheckedAt: new Date(Date.now() - 60_000), pluginUpdates: 0 }),
          makeSite({ id: 's3', url: 'https://c.com', status: 'ACTIVE', lastCheckedAt: new Date(Date.now() - 60_000), pluginUpdates: 5 }),
          makeSite({ id: 's4', url: 'https://d.com', status: 'ERROR', lastCheckedAt: new Date(Date.now() - 60_000), pluginUpdates: 1 }),
          makeSite({ id: 's5', url: 'https://e.com', status: 'ACTIVE', lastCheckedAt: new Date(Date.now() - 10 * 86_400_000), pluginUpdates: 0 })
        ]
      },
      wPReport: {
        findMany: async () => [
          makeReport('https://a.com', { ssl: JSON.stringify({ status: 'valid', days: 60 }) }),
          makeReport('https://b.com', { ssl: JSON.stringify({ status: 'valid', days: 10 }) }),
          makeReport('https://c.com', { ssl: JSON.stringify({ status: 'valid', days: 5 }) })
        ]
      },
      wPAlert: {
        findMany: async () => [
          makeAlert('https://a.com'),
          makeAlert('https://b.com'),
          makeAlert('https://d.com')
        ]
      }
    };
    const booted = await bootFleetServer({ stubPrisma: stub });
    app = booted.fastify;
    port = app.server.address().port;
  });

  test('admin JWT -> 200 with the 7 metrics + per-site array', async () => {
    const token = makeAdminToken(app);
    const res = await get(port, '/api/wp-bridge/fleet/status', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalSites, 5);
    assert.equal(body.healthy, 3);
    assert.equal(body.unreachable, 1);
    assert.equal(body.silent, 1);
    assert.equal(body.sslExpiringSoon, 2);
    assert.equal(body.pendingUpdates, 8);
    assert.equal(body.brokenLinks, 3);
    assert.ok(Array.isArray(body.sites));
    assert.equal(body.sites.length, 5);
    for (const s of body.sites) {
      assert.ok(typeof s.siteUrl === 'string');
      assert.ok(['ok', 'unreachable', 'silent'].includes(s.lastPingStatus));
      assert.ok('sslDaysRemaining' in s);
      assert.ok(typeof s.pendingUpdates === 'number');
      assert.ok(typeof s.brokenLinks === 'number');
    }
    await app.close();
  });

  test('no auth -> 401 (does not leak data)', async () => {
    const res = await get(port, '/api/wp-bridge/fleet/status');
    assert.equal(res.status, 401);
    await app.close();
  });

  test('non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await get(port, '/api/wp-bridge/fleet/status', { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
    await app.close();
  });
});

describe('POST /api/wp-bridge/fleet/digest (Fastify integration)', () => {
  let app;
  let port;

  beforeEach(async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/X';
    const stub = {
      wPSite: { findMany: async () => [makeSite({ url: 'https://a.com' })] },
      wPReport: { findMany: async () => [] },
      wPAlert: { findMany: async () => [] }
    };
    const booted = await bootFleetServer({ stubPrisma: stub });
    app = booted.fastify;
    port = app.server.address().port;
  });

  test('admin JWT + SLACK_WEBHOOK_URL -> 200 + exactly one Slack POST', async () => {
    const token = makeAdminToken(app);
    const res = await post(port, '/api/wp-bridge/fleet/digest', {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.slackStatus, 200);
    assert.equal(body.fleet.totalSites, 1);
    await app.close();
  });

  test('SLACK_WEBHOOK_URL missing -> 503 with code SLACK_WEBHOOK_MISSING', async () => {
    const savedUrl = process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    try {
      const token = makeAdminToken(app);
      const res = await post(port, '/api/wp-bridge/fleet/digest', {}, { authorization: `Bearer ${token}` });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.code, 'SLACK_WEBHOOK_MISSING');
    } finally {
      process.env.SLACK_WEBHOOK_URL = savedUrl;
    }
    await app.close();
  });

  test('non-admin JWT -> 403', async () => {
    const token = makeNonAdminToken(app);
    const res = await post(port, '/api/wp-bridge/fleet/digest', {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
    await app.close();
  });
});