import IORedis from 'ioredis';
import { readFile } from 'node:fs/promises';

import { rawPrisma } from '../config/db.js';
import env from '../config/env.js';
import { QUEUES } from '../jobs/queue-names.js';

const WORKER_HEARTBEAT_KEY = 'ashbi:workers:heartbeat';
const REQUIRED_WORKER_FRESHNESS_MS = 45_000;
const CHECK_TIMEOUT_MS = 2_500;
const REQUIRED_BACKUP_FRESHNESS_MS = 30 * 60 * 60 * 1_000;
const BACKUP_STATUS_PATH = process.env.BACKUP_STATUS_PATH || '/app/config/backup-status.json';

// Health responses are consumed by operators and uptime probes, so a failing
// dependency must explain itself. Only a short, credential-free reason is
// exposed: driver errors can embed the connection string, so anything
// URL-shaped or key-shaped is stripped before it leaves this module.
const SECRET_SHAPED = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s]+|\b(?:password|passwd|pwd|secret|token|api[_-]?key)\b\s*[=:]\s*[^\s,;]+)/gi;

function describeFailure(error) {
  const name = error && error.constructor && error.constructor.name ? error.constructor.name : 'Error';
  const raw = error && typeof error.message === 'string' ? error.message : '';
  const message = raw.replace(SECRET_SHAPED, '[redacted]').replace(/\s+/g, ' ').trim();
  const shortened = message.length > 200 ? message.slice(0, 200) + '…' : message;
  return shortened ? `${name}: ${shortened}` : name;
}

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
  readBackupStatus = () => readFile(BACKUP_STATUS_PATH, 'utf8'),
} = {}) {
  const checks = {};

  try {
    await withTimeout(db.$queryRawUnsafe('SELECT 1'), 'database');
    checks.database = checkResult(true);
  } catch (error) {
    checks.database = checkResult(false, describeFailure(error));
  }

  try {
    if (redis.status === 'wait') await withTimeout(redis.connect(), 'redis connect');
    await withTimeout(redis.ping(), 'redis');
    checks.redis = checkResult(true);
  } catch (error) {
    checks.redis = checkResult(false, describeFailure(error));
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
    } catch (error) {
      checks.worker = checkResult(false, describeFailure(error));
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

  try {
    const backup = JSON.parse(await withTimeout(readBackupStatus(), 'backup status'));
    const ageMs = now - Date.parse(backup.completedAt);
    const fresh = backup.status === 'ok' && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= REQUIRED_BACKUP_FRESHNESS_MS;
    checks.backup = {
      status: fresh ? 'ok' : 'unavailable',
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      completedAt: typeof backup.completedAt === 'string' ? backup.completedAt : null,
    };
  } catch (error) {
    checks.backup = checkResult(false, describeFailure(error));
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
    degraded: failedJobTotal > 0 || checks.backup.status !== 'ok' || !alerting.destinationConfigured || !alerting.ownerConfigured,
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

export { REQUIRED_BACKUP_FRESHNESS_MS, REQUIRED_WORKER_FRESHNESS_MS, WORKER_HEARTBEAT_KEY };
