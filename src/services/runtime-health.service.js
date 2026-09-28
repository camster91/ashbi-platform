import IORedis from 'ioredis';
import { readFile } from 'node:fs/promises';

import { rawPrisma } from '../config/db.js';
import env from '../config/env.js';
import { QUEUES } from '../jobs/queue-names.js';
import { processCounters } from '../utils/process-lifecycle.js';

const WORKER_HEARTBEAT_KEY = 'ashbi:workers:heartbeat';
const REQUIRED_WORKER_FRESHNESS_MS = 45_000;
const CHECK_TIMEOUT_MS = 2_500;
const REQUIRED_BACKUP_FRESHNESS_MS = 30 * 60 * 60 * 1_000;
const READY_DEPENDENCIES = ['database', 'redis'];
const PUBLIC_CHECKS = ['database', 'redis', 'worker'];
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

  // Readiness means "this API process can serve requests": database and Redis.
  // A missing or stale worker heartbeat degrades the report (background jobs
  // are delayed) but must not take the whole API out of rotation. The deploy
  // controller still requires the worker through the strict view.
  const ready = READY_DEPENDENCIES.every((name) => checks[name].status === 'ok');
  const strictReady = ready && checks.worker.status === 'ok';
  const failedJobTotal = Object.values(failedJobs).reduce(
    (sum, count) => sum + (Number.isInteger(count) ? count : 0),
    0,
  );
  const alerting = {
    destinationConfigured: alertDestinationConfigured,
    ownerConfigured: alertOwnerConfigured,
  };
  const degraded = checks.worker.status !== 'ok'
    || failedJobTotal > 0
    || checks.backup.status !== 'ok'
    || !alerting.destinationConfigured
    || !alerting.ownerConfigured;
  return {
    ready,
    strictReady,
    status: !ready ? 'unavailable' : checks.worker.status === 'ok' ? 'ok' : 'degraded',
    degraded,
    checks,
    failedJobs,
    failedJobTotal,
    alerting,
    revision,
    imageDigest: process.env.APP_IMAGE_DIGEST || 'unknown',
    // Unhandled rejections are logged and counted, not fatal (yet).
    process: processCounters(),
    timestamp: new Date(now).toISOString(),
  };
}

/** `?strict=1` also requires a fresh, same-revision worker heartbeat. */
export function isStrictHealthQuery(query) {
  const value = query?.strict;
  return value === '1' || value === 'true';
}

export function healthStatusCode(report, { strict = false } = {}) {
  return (strict ? report.strictReady : report.ready) ? 200 : 503;
}

/**
 * The unauthenticated probe: dependency states and the running revision (the
 * same revision /api/live already publishes). Failure details, failed-job
 * counts, backup and alerting state, and the image digest are detail-only.
 */
export function publicHealthView(report) {
  return {
    ready: report.ready,
    status: report.status,
    degraded: report.degraded,
    checks: Object.fromEntries(
      PUBLIC_CHECKS.map((name) => [name, { status: report.checks?.[name]?.status ?? 'unavailable' }]),
    ),
    revision: report.revision,
    timestamp: report.timestamp,
  };
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * True when the TCP peer is this host's loopback interface. Uses the raw
 * socket address, never X-Forwarded-For, so a proxied request cannot claim it.
 * Inside the container only a local process (the deploy controller's
 * `docker exec`) can connect from loopback: Traefik and the published host
 * port both arrive from a Docker network address.
 */
export function isLoopbackPeer(request) {
  const address = request?.raw?.socket?.remoteAddress ?? request?.socket?.remoteAddress;
  return LOOPBACK_ADDRESSES.has(address);
}

export const HEALTH_DETAIL_ROLES = Object.freeze(['ADMIN', 'TEAM']);

export async function closeRuntimeHealth() {
  if (!healthRedis) return;
  healthRedis.disconnect();
  healthRedis = undefined;
}

export { REQUIRED_BACKUP_FRESHNESS_MS, REQUIRED_WORKER_FRESHNESS_MS, WORKER_HEARTBEAT_KEY };
