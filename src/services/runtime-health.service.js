import IORedis from 'ioredis';

import { rawPrisma } from '../config/db.js';
import env from '../config/env.js';
import { QUEUES } from '../jobs/queue-names.js';

const WORKER_HEARTBEAT_KEY = 'ashbi:workers:heartbeat';
const REQUIRED_WORKER_FRESHNESS_MS = 45_000;
const CHECK_TIMEOUT_MS = 2_500;

let healthRedis;

function getHealthRedis() {
  if (!healthRedis) {
    healthRedis = new IORedis(env.redisUrl, {
      lazyConnect: true,
      connectTimeout: 1_500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
    });
    healthRedis.on('error', () => {});
  }
  return healthRedis;
}

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), CHECK_TIMEOUT_MS);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function checkResult(ok, detail) {
  return detail ? { status: ok ? 'ok' : 'unavailable', detail } : { status: ok ? 'ok' : 'unavailable' };
}

export async function checkRuntimeHealth({
  db = rawPrisma,
  redis = getHealthRedis(),
  revision = process.env.APP_REVISION || 'unknown',
  now = Date.now(),
  alertDestinationConfigured = Boolean(env.sentryDsn || env.otlpEndpoint || env.notificationWebhookUrl),
  alertOwnerConfigured = Boolean(env.observabilityOwner),
} = {}) {
  const checks = {};

  try {
    await withTimeout(db.$queryRawUnsafe('SELECT 1'), 'database');
    checks.database = checkResult(true);
  } catch {
    checks.database = checkResult(false);
  }

  try {
    if (redis.status === 'wait') await withTimeout(redis.connect(), 'redis connect');
    await withTimeout(redis.ping(), 'redis');
    checks.redis = checkResult(true);
  } catch {
    checks.redis = checkResult(false);
  }

  let workerHeartbeat;
  if (checks.redis.status === 'ok') {
    try {
      workerHeartbeat = JSON.parse(await withTimeout(redis.get(WORKER_HEARTBEAT_KEY), 'worker heartbeat'));
      const ageMs = now - Date.parse(workerHeartbeat.timestamp);
      const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= REQUIRED_WORKER_FRESHNESS_MS;
      const sameRevision = revision === 'unknown' || workerHeartbeat.revision === revision;
      checks.worker = {
        status: fresh && sameRevision ? 'ok' : 'unavailable',
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
        revision: workerHeartbeat.revision || 'unknown',
      };
    } catch {
      checks.worker = checkResult(false);
    }
  } else {
    checks.worker = checkResult(false, 'redis unavailable');
  }

  let failedJobs = {};
  if (checks.redis.status === 'ok') {
    try {
      const queueNames = Object.values(QUEUES);
      const counts = await withTimeout(
        Promise.all(queueNames.map((queue) => redis.zcard(`bull:${queue}:failed`))),
        'queue failure counts',
      );
      failedJobs = Object.fromEntries(queueNames.map((queue, index) => [queue, counts[index]]));
    } catch {
      failedJobs = { status: 'unavailable' };
    }
  }

  const ready = ['database', 'redis', 'worker'].every((name) => checks[name].status === 'ok');
  const failedJobTotal = Object.values(failedJobs).reduce(
    (sum, count) => sum + (Number.isInteger(count) ? count : 0),
    0,
  );
  const alerting = {
    destinationConfigured: alertDestinationConfigured,
    ownerConfigured: alertOwnerConfigured,
  };
  return {
    ready,
    status: ready ? 'ok' : 'unavailable',
    degraded: failedJobTotal > 0 || !alerting.destinationConfigured || !alerting.ownerConfigured,
    checks,
    failedJobs,
    failedJobTotal,
    alerting,
    revision,
    imageDigest: process.env.APP_IMAGE_DIGEST || 'unknown',
    timestamp: new Date(now).toISOString(),
  };
}

export async function closeRuntimeHealth() {
  if (!healthRedis) return;
  healthRedis.disconnect();
  healthRedis = undefined;
}

export { REQUIRED_WORKER_FRESHNESS_MS, WORKER_HEARTBEAT_KEY };
