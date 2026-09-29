import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkRuntimeHealth,
  closeRuntimeHealth,
  healthStatusCode,
  isLoopbackPeer,
  loopbackHealthDetailsEnabled,
  isStrictHealthQuery,
  publicHealthView,
  REQUIRED_BACKUP_FRESHNESS_MS,
  WORKER_HEARTBEAT_KEY,
} from '../../services/runtime-health.service.js';
import { buildApp } from '../../index.js';
import { QUEUES } from '../../jobs/queue-names.js';

function healthyDependencies({ failed = {}, heartbeat = {} } = {}) {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  return {
    now,
    alertDestinationConfigured: true,
    alertOwnerConfigured: true,
    readBackupStatus: async () => JSON.stringify({ status: 'ok', completedAt: new Date(now - 60_000).toISOString() }),
    db: { $queryRawUnsafe: async () => [{ '?column?': 1 }] },
    redis: {
      status: 'ready',
      ping: async () => 'PONG',
      get: async (key) => {
        assert.equal(key, WORKER_HEARTBEAT_KEY);
        return JSON.stringify({
          revision: 'release-1',
          timestamp: new Date(now - 1_000).toISOString(),
          ...heartbeat,
        });
      },
      zcard: async (key) => failed[key.replace(/^bull:|:failed$/g, '')] || 0,
    },
  };
}

test('readiness proves database, Redis, worker freshness, and release identity', async () => {
  const dependencies = healthyDependencies();
  const report = await checkRuntimeHealth({ ...dependencies, revision: 'release-1' });
  assert.equal(report.ready, true);
  assert.equal(report.status, 'ok');
  assert.equal(report.degraded, false);
  assert.equal(report.checks.backup.status, 'ok');
  assert.deepEqual(Object.keys(report.failedJobs).sort(), Object.values(QUEUES).sort());
});

test('readiness fails closed when a required dependency is unavailable', async () => {
  const dependencies = healthyDependencies();
  dependencies.db.$queryRawUnsafe = async () => { throw new Error('database unavailable'); };
  const report = await checkRuntimeHealth({ ...dependencies, revision: 'release-1' });
  assert.equal(report.ready, false);
  assert.equal(report.checks.database.status, 'unavailable');
  assert.equal(report.checks.redis.status, 'ok');
});

test('readiness rejects stale or wrong-release worker heartbeats', async () => {
  const stale = healthyDependencies({ heartbeat: { timestamp: '2026-08-09T11:58:00.000Z' } });
  const staleReport = await checkRuntimeHealth({ ...stale, revision: 'release-1' });
  assert.equal(staleReport.checks.worker.status, 'unavailable');

  const wrongRelease = healthyDependencies({ heartbeat: { revision: 'release-old' } });
  const wrongReport = await checkRuntimeHealth({ ...wrongRelease, revision: 'release-1' });
  assert.equal(wrongReport.checks.worker.status, 'unavailable');
});

test('retained job failures produce a degraded but dependency-ready report', async () => {
  const dependencies = healthyDependencies({ failed: { embedding: 3 } });
  const report = await checkRuntimeHealth({ ...dependencies, revision: 'release-1' });
  assert.equal(report.ready, true);
  assert.equal(report.degraded, true);
  assert.equal(report.failedJobTotal, 3);
  assert.equal(report.failedJobs.embedding, 3);
});

test('missing, invalid, or stale backups degrade health without taking dependencies offline', async () => {
  const missing = healthyDependencies();
  missing.readBackupStatus = async () => { throw new Error('missing'); };
  const missingReport = await checkRuntimeHealth({ ...missing, revision: 'release-1' });
  assert.equal(missingReport.ready, true);
  assert.equal(missingReport.degraded, true);
  assert.equal(missingReport.checks.backup.status, 'unavailable');

  const stale = healthyDependencies();
  stale.readBackupStatus = async () => JSON.stringify({
    status: 'ok',
    completedAt: new Date(stale.now - REQUIRED_BACKUP_FRESHNESS_MS - 1).toISOString(),
    archive: 'must-not-be-exposed.tar.age',
    sha256: 'must-not-be-exposed',
  });
  const staleReport = await checkRuntimeHealth({ ...stale, revision: 'release-1' });
  assert.equal(staleReport.ready, true);
  assert.equal(staleReport.degraded, true);
  assert.equal(staleReport.checks.backup.status, 'unavailable');
  assert.equal(staleReport.checks.backup.ageMs, REQUIRED_BACKUP_FRESHNESS_MS + 1);
  assert.equal('archive' in staleReport.checks.backup, false);
  assert.equal('sha256' in staleReport.checks.backup, false);
});

test('unavailable dependencies explain themselves without leaking credentials', async () => {
  const dependencies = healthyDependencies();
  dependencies.db.$queryRawUnsafe = async () => {
    throw new Error(
      "Can't reach database server at postgresql://ashbi:hunter2@db.internal:5432/ashbi"
    );
  };
  const report = await checkRuntimeHealth({ ...dependencies, revision: 'release-1' });
  assert.equal(report.checks.database.status, 'unavailable');
  assert.match(report.checks.database.detail, /Can't reach database server/);
  assert.equal(report.checks.database.detail.includes('hunter2'), false);
  assert.equal(report.checks.database.detail.includes('postgresql://'), false);
  assert.match(report.checks.database.detail, /\[redacted\]/);
});

test('health reasons stay short and never expose key-shaped values', async () => {
  const dependencies = healthyDependencies();
  dependencies.redis.ping = async () => {
    throw new Error(`auth failed token=super-secret-value ${'x'.repeat(400)}`);
  };
  const report = await checkRuntimeHealth({ ...dependencies, revision: 'release-1' });
  const detail = report.checks.redis.detail;
  assert.equal(report.checks.redis.status, 'unavailable');
  assert.equal(detail.includes('super-secret-value'), false);
  assert.ok(detail.length <= 220, `detail too long: ${detail.length}`);
});

test('a stale worker degrades readiness (200) but fails the strict deploy gate (503)', async () => {
  const stale = healthyDependencies({ heartbeat: { timestamp: '2026-08-09T11:58:00.000Z' } });
  const report = await checkRuntimeHealth({ ...stale, revision: 'release-1' });
  assert.equal(report.ready, true, 'database + redis decide readiness');
  assert.equal(report.strictReady, false);
  assert.equal(report.status, 'degraded');
  assert.equal(report.degraded, true);
  assert.equal(healthStatusCode(report), 200);
  assert.equal(healthStatusCode(report, { strict: true }), 503);

  const missing = healthyDependencies();
  missing.redis.get = async () => null;
  const missingReport = await checkRuntimeHealth({ ...missing, revision: 'release-1' });
  assert.equal(missingReport.ready, true);
  assert.equal(missingReport.checks.worker.status, 'unavailable');

  const healthy = await checkRuntimeHealth({ ...healthyDependencies(), revision: 'release-1' });
  assert.equal(healthy.strictReady, true);
  assert.equal(healthStatusCode(healthy, { strict: true }), 200);
});

test('database or Redis outages still take readiness down', async () => {
  const deps = healthyDependencies();
  deps.redis.ping = async () => { throw new Error('ECONNREFUSED'); };
  const report = await checkRuntimeHealth({ ...deps, revision: 'release-1' });
  assert.equal(report.ready, false);
  assert.equal(report.status, 'unavailable');
  assert.equal(healthStatusCode(report), 503);
});

test('the public view omits failure details, failed-job counts, backup state and the image digest', async () => {
  const deps = healthyDependencies({ failed: { embedding: 3 } });
  deps.db.$queryRawUnsafe = async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:5432'); };
  const report = await checkRuntimeHealth({ ...deps, revision: 'release-1' });
  const view = publicHealthView(report);
  assert.deepEqual(Object.keys(view).sort(), ['checks', 'degraded', 'ready', 'revision', 'status', 'timestamp']);
  assert.deepEqual(view.checks, {
    database: { status: 'unavailable' },
    redis: { status: 'ok' },
    worker: { status: 'ok' },
  });
  const serialized = JSON.stringify(view);
  for (const secretish of ['imageDigest', 'failedJob', 'backup', 'alerting', '10.0.0.7', 'detail']) {
    assert.equal(serialized.includes(secretish), false, secretish);
  }
});

test('strict query parsing and loopback detection use the raw socket only', () => {
  assert.equal(isStrictHealthQuery({ strict: '1' }), true);
  assert.equal(isStrictHealthQuery({ strict: 'true' }), true);
  assert.equal(isStrictHealthQuery({ strict: '0' }), false);
  assert.equal(isStrictHealthQuery(undefined), false);
  const on = { enabled: true };
  assert.equal(isLoopbackPeer({ headers: {}, raw: { socket: { remoteAddress: '127.0.0.1' } } }, on), true);
  assert.equal(isLoopbackPeer({ headers: {}, raw: { socket: { remoteAddress: '::ffff:127.0.0.1' } } }, on), true);
  assert.equal(isLoopbackPeer({
    ip: '127.0.0.1',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    raw: { socket: { remoteAddress: '172.18.0.4' } },
  }, on), false, 'forwarded-for cannot claim loopback');
  for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
    assert.equal(isLoopbackPeer({ headers: { [header]: '203.0.113.9' }, raw: { socket: { remoteAddress: '127.0.0.1' } } }, on), false, `${header} from a local proxy is remote`);
  }
  assert.equal(isLoopbackPeer({ headers: {}, raw: { socket: { remoteAddress: '127.0.0.1' } } }, { enabled: false }), false, 'off unless the image enables it');
  assert.equal(loopbackHealthDetailsEnabled(undefined), false);
  assert.equal(loopbackHealthDetailsEnabled('true'), true);
  assert.equal(loopbackHealthDetailsEnabled('1'), false);
});

test('health routes: public probe is minimal, details need staff or container loopback', async () => {
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    const live = await app.inject({ method: 'GET', url: '/api/live', remoteAddress: '203.0.113.9' });
    assert.equal(live.statusCode, 200);

    for (const url of ['/api/health', '/api/health?strict=1']) {
      const pub = await app.inject({ method: 'GET', url, remoteAddress: '203.0.113.9' });
      assert.ok([200, 503].includes(pub.statusCode), `${url}: ${pub.statusCode} ${pub.body}`);
      const body = pub.json();
      assert.deepEqual(Object.keys(body).sort(), ['checks', 'degraded', 'ready', 'revision', 'status', 'timestamp'], url);
      assert.equal('imageDigest' in body, false);
      assert.equal('failedJobs' in body, false);
    }

    const anonymous = await app.inject({ method: 'GET', url: '/api/health/details', remoteAddress: '203.0.113.9' });
    assert.equal(anonymous.statusCode, 401);
    const spoofed = await app.inject({
      method: 'GET',
      url: '/api/health/details',
      remoteAddress: '172.18.0.4',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    assert.equal(spoofed.statusCode, 401);

    const previous = process.env.HEALTH_DETAILS_LOOPBACK;
    delete process.env.HEALTH_DETAILS_LOOPBACK;
    const localDisabled = await app.inject({ method: 'GET', url: '/api/health/details', remoteAddress: '127.0.0.1' });
    assert.equal(localDisabled.statusCode, 401, 'loopback trust is off outside the container image');
    process.env.HEALTH_DETAILS_LOOPBACK = 'true';
    const proxied = await app.inject({
      method: 'GET',
      url: '/api/health/details',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    assert.equal(proxied.statusCode, 401, 'a proxy on loopback is not trusted');
    const local = await app.inject({ method: 'GET', url: '/api/health/details?strict=1', remoteAddress: '127.0.0.1' });
    if (previous === undefined) delete process.env.HEALTH_DETAILS_LOOPBACK;
    else process.env.HEALTH_DETAILS_LOOPBACK = previous;
    assert.ok([200, 503].includes(local.statusCode));
    const detail = local.json();
    assert.ok('imageDigest' in detail);
    assert.ok('failedJobs' in detail);
    assert.equal(typeof detail.strictReady, 'boolean');
    assert.equal(typeof detail.process.unhandledRejections, 'number');
  } finally {
    await app.close();
    await closeRuntimeHealth();
  }
});

test('health details are open to every staff role (ADMIN, TEAM, STAFF), never to clients or bots', async () => {
  const { HEALTH_DETAIL_ROLES } = await import('../../services/runtime-health.service.js');
  for (const role of ['ADMIN', 'TEAM', 'STAFF']) assert.ok(HEALTH_DETAIL_ROLES.includes(role), role);
  for (const role of ['CLIENT', 'BOT']) assert.equal(HEALTH_DETAIL_ROLES.includes(role), false, role);
});
