import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRuntimeHealth, WORKER_HEARTBEAT_KEY } from '../../services/runtime-health.service.js';
import { QUEUES } from '../../jobs/queue-names.js';

function healthyDependencies({ failed = {}, heartbeat = {} } = {}) {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  return {
    now,
    alertDestinationConfigured: true,
    alertOwnerConfigured: true,
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
