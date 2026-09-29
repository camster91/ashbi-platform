// BullMQ Queue Setup

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { redisConnectionArgs, resolveRedisUrl } from '../config/redis.js';
import { withCurrentTenantJobData } from './tenant-iteration.js';
import { QUEUES } from './queue-names.js';
export { QUEUES } from './queue-names.js';

export { redisConnectionArgs, resolveRedisUrl };

// Do not connect to real Redis during tests
const isTestEnv = process.env.NODE_ENV === 'test';

// Producers (API routes, the scheduler bootstrap) must fail fast while Redis
// is down instead of parking the HTTP request in ioredis' offline queue.
export const PRODUCER_REDIS_OPTIONS = Object.freeze({
  enableOfflineQueue: false,
  connectTimeout: 2_000,
  maxRetriesPerRequest: 1,
});
export const PRODUCER_ADD_TIMEOUT_MS = 5_000;

// BullMQ workers issue blocking commands and require unlimited retries.
export const WORKER_REDIS_OPTIONS = Object.freeze({ maxRetriesPerRequest: null });

// Pub/sub (support-view socket revocation) must queue SUBSCRIBE until Redis is
// reachable and resubscribe after reconnects: default offline queue on.
export const PUBSUB_REDIS_OPTIONS = Object.freeze({ maxRetriesPerRequest: null, enableOfflineQueue: true });

function createConnection(overrides) {
  const redis = new IORedis(...redisConnectionArgs(process.env.REDIS_URL, overrides));
  // An unhandled 'error' event would crash the process; readiness and the
  // producer guard report the outage instead.
  redis.on('error', () => {});
  return redis;
}

const connection = isTestEnv ? {} : createConnection(PRODUCER_REDIS_OPTIONS);
let workerConnection;

/**
 * Source for pub/sub connections: `duplicate()` opens a new connection with
 * PUBSUB_REDIS_OPTIONS (callers own and close it). Null in tests.
 */
export function pubSubRedisSource() {
  if (isTestEnv) return null;
  return { duplicate: () => createConnection(PUBSUB_REDIS_OPTIONS) };
}

/** Blocking-safe connection for BullMQ workers and the worker heartbeat. */
export function getWorkerConnection() {
  if (isTestEnv) return connection;
  if (!workerConnection) workerConnection = createConnection(WORKER_REDIS_OPTIONS);
  return workerConnection;
}

export class QueueUnavailableError extends Error {
  constructor(message = 'Job queue is unavailable') {
    super(message);
    this.name = 'QueueUnavailableError';
    this.code = 'QUEUE_UNAVAILABLE';
    this.statusCode = 503;
  }
}

/**
 * Wrap a queue's add() so it rejects immediately while the producer
 * connection is not ready, and after `timeoutMs` if Redis stalls mid-command.
 * Without this BullMQ waits for the connection's first 'ready' indefinitely.
 */
export function guardProducerAdd(add, redis, timeoutMs = PRODUCER_ADD_TIMEOUT_MS) {
  return async function guardedAdd(...args) {
    if (redis?.status !== 'ready') {
      throw new QueueUnavailableError(`Job queue is unavailable (redis ${redis?.status || 'unknown'})`);
    }
    let timer;
    try {
      return await Promise.race([
        add.apply(this, args),
        new Promise((_, reject) => {
          // Not unref'd: an in-flight add is real work, and the timer is
          // always cleared when the add settles.
          timer = setTimeout(() => reject(new QueueUnavailableError('Job queue add timed out')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

// Retention for every queue: completed jobs are kept for a day (at most
// 1000), failed jobs for 14 days, so Redis memory stays bounded while
// failures remain inspectable. Explicit per-add options still win.
export const DEFAULT_JOB_RETENTION = Object.freeze({
  removeOnComplete: Object.freeze({ age: 24 * 60 * 60, count: 1000 }),
  removeOnFail: Object.freeze({ age: 14 * 24 * 60 * 60 }),
});

// Mock Queue class for tests
class MockQueue {
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    this.defaultJobOptions = opts.defaultJobOptions;
  }
  async add() { return { id: 'mock-job-id' }; }
  async upsertJobScheduler() { return { id: 'mock-scheduler-id' }; }
  async removeRepeatable() { return true; }
  async removeJobScheduler() { return true; }
  async getJobs() { return []; }
  async close() {}
}

class ProducerQueue extends Queue {
  constructor(name, opts) {
    super(name, opts);
    this.add = guardProducerAdd(super.add, connection).bind(this);
  }
}

const QueueClass = isTestEnv ? MockQueue : ProducerQueue;

function createQueue(name) {
  return new QueueClass(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { ...DEFAULT_JOB_RETENTION.removeOnComplete },
      removeOnFail: { ...DEFAULT_JOB_RETENTION.removeOnFail },
    },
  });
}

// Create queues
export const emailQueue = createQueue(QUEUES.EMAIL_PROCESSING);
export const healthQueue = createQueue(QUEUES.PROJECT_HEALTH);
export const escalationQueue = createQueue(QUEUES.ESCALATION);
export const notificationQueue = createQueue(QUEUES.NOTIFICATIONS);
export const weeklyDigestQueue = createQueue(QUEUES.WEEKLY_DIGEST);
export const embeddingQueue = createQueue(QUEUES.EMBEDDING);
export const scheduledQueue = createQueue(QUEUES.SCHEDULED);
export const domainEventsQueue = createQueue(QUEUES.DOMAIN_EVENTS);
export const ALL_QUEUES = Object.freeze([
  emailQueue,
  healthQueue,
  escalationQueue,
  notificationQueue,
  weeklyDigestQueue,
  embeddingQueue,
  scheduledQueue,
  domainEventsQueue,
]);

/**
 * Add email to processing queue
 */
export async function queueEmailForProcessing(emailData) {
  const job = await emailQueue.add('process-email', withCurrentTenantJobData(emailData), {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  });
  return job.id;
}

/**
 * Hand a verified inbound email delivery to the worker. `jobId` makes the
 * enqueue idempotent: a retry of the same delivery (for example after this
 * process died before recording the receipt) does not create a second job
 * while the first is retained.
 *
 * The pipeline is not idempotent (it creates the thread or unmatched email
 * before its AI steps), so the job runs once: automatic retries could
 * duplicate threads. A failed delivery is kept in the queue's failed set for
 * 30 days and can be replayed deliberately once the cause is fixed.
 */
export const INBOUND_EMAIL_JOB_OPTIONS = Object.freeze({
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 30 * 24 * 60 * 60 },
});

export async function queueInboundEmailDelivery(emailData, { organizationId, jobId }) {
  if (!organizationId) throw new Error('Tenancy Error: an organization is required to enqueue an inbound email');
  const job = await emailQueue.add('process-email', { ...emailData, organizationId }, { ...INBOUND_EMAIL_JOB_OPTIONS, jobId });
  return job.id;
}

/**
 * Schedule project health update
 */
export async function scheduleHealthUpdate(projectId) {
  await healthQueue.add('update-health', withCurrentTenantJobData({ projectId }), {
    delay: 60000, // 1 minute delay to batch updates
    jobId: `health-${projectId}`, // Prevent duplicate jobs
    removeOnComplete: true
  });
}

/**
 * Schedule escalation check
 */
export async function scheduleEscalationCheck(threadId, delayMs) {
  await escalationQueue.add('check-escalation', withCurrentTenantJobData({ threadId }), {
    delay: delayMs,
    jobId: `escalation-${threadId}`,
    removeOnComplete: true
  });
}

/**
 * Queue notification for delivery
 */
export async function queueNotification(notification) {
  await notificationQueue.add('send-notification', withCurrentTenantJobData(notification), {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
}

/**
 * Queue embedding generation for a client
 */
export async function queueEmbedding(clientId, content, source, sourceId = null, metadata = {}) {
  await embeddingQueue.add('generate-embedding', withCurrentTenantJobData({ clientId, content, source, sourceId, metadata }), {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true
  });
}

/**
 * Set up recurring jobs
 */
// Retired schedules: queued copies are removed, or completed as no-ops by the worker.
export const DOMAIN_EVENT_DISPATCH_INTERVAL_MS = 15 * 1000;

export const RETIRED_SCHEDULED_JOBS = new Set(['scheduled-workflows', 'fleet-digest']);

export async function setupRecurringJobs() {
  const defaults = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  };

  // Remove the pre-job-scheduler repeat keys created by older API replicas,
  // plus one checker that targeted unmodeled legacy bootstrap tables. This is
  // safe to repeat and prevents an upgrade from retaining duplicate schedules.
  await Promise.all([
    healthQueue.removeRepeatable(
      'update-all-health',
      { every: 60 * 60 * 1000 },
      'recurring-health-check',
    ),
    escalationQueue.removeRepeatable(
      'check-all-escalations',
      { every: 15 * 60 * 1000 },
      'recurring-escalation-check',
    ),
    weeklyDigestQueue.removeRepeatable(
      'generate-weekly-digest',
      { pattern: '0 14 * * 1' },
      'recurring-weekly-digest',
    ),
    scheduledQueue.removeJobScheduler('scheduled-workflows-minutely'),
    scheduledQueue.removeJobScheduler('fleet-digest-daily-toronto'),
  ]);
  const deprecatedWorkflowJobs = await scheduledQueue.getJobs(['wait', 'delayed', 'failed']);
  for (const job of deprecatedWorkflowJobs.filter((candidate) => RETIRED_SCHEDULED_JOBS.has(candidate.name))) {
    try {
      await job.remove();
    } catch (error) {
      // A previous worker may have locked the last occurrence during a rolling
      // cutover. The compatibility processor completes it as a no-op below.
      if (!error.message.includes('locked by another worker')) throw error;
      console.warn(`[scheduler] Deprecated workflow job ${job.id} is active; allowing no-op completion`);
    }
  }

  // upsertJobScheduler gives every logical schedule a stable Redis identity.
  // Multiple worker replicas can run this bootstrap without creating duplicate
  // repeat schedules.
  await healthQueue.upsertJobScheduler(
    'project-health-hourly',
    { every: 60 * 60 * 1000 },
    { name: 'update-all-health', data: {}, opts: defaults },
  );
  await escalationQueue.upsertJobScheduler(
    'escalation-quarter-hourly',
    { every: 15 * 60 * 1000 },
    { name: 'check-all-escalations', data: {}, opts: defaults },
  );
  await weeklyDigestQueue.upsertJobScheduler(
    'weekly-digest-monday-toronto',
    { pattern: '0 9 * * 1', tz: 'America/Toronto' },
    { name: 'generate-weekly-digest', data: {}, opts: defaults },
  );

  const scheduledJobs = [
    ['recurring-invoices-hourly', { every: 60 * 60 * 1000 }, 'recurring-invoices'],
    ['overdue-invoices-hourly', { every: 60 * 60 * 1000 }, 'overdue-invoices'],
    ['trash-purge-daily-toronto', { pattern: '0 4 * * *', tz: 'America/Toronto' }, 'trash-purge'],
  ];
  for (const [schedulerId, repeat, name] of scheduledJobs) {
    await scheduledQueue.upsertJobScheduler(
      schedulerId,
      repeat,
      { name, data: {}, opts: defaults },
    );
  }

  // Outbox dispatcher tick (#412). One attempt per tick: the dispatcher keeps
  // its own per-event retry/backoff state in domain_events, so a failed tick
  // is simply retried by the next one. Replicas are safe (SKIP LOCKED claims).
  await domainEventsQueue.upsertJobScheduler(
    'domain-events-dispatch',
    { every: DOMAIN_EVENT_DISPATCH_INTERVAL_MS },
    { name: 'dispatch-domain-events', data: {}, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 500 } },
  );

  console.log('Recurring jobs scheduled');
}

let queueInfrastructureClosing;

async function closeRedis(redis) {
  if (!redis || typeof redis.quit !== 'function' || redis.status === 'end') return;
  try {
    // quit() waits for Redis; while Redis is down disconnect() is immediate.
    if (redis.status === 'ready') await redis.quit();
    else redis.disconnect();
  } catch {
    redis.disconnect();
  }
}

/**
 * Close every queue plus the producer and worker Redis connections. Safe to
 * call more than once (API shutdown and worker shutdown both use it).
 */
export function closeQueueInfrastructure() {
  if (!queueInfrastructureClosing) {
    queueInfrastructureClosing = (async () => {
      await Promise.allSettled(ALL_QUEUES.map((queue) => queue.close()));
      if (isTestEnv) return;
      await Promise.all([closeRedis(connection), closeRedis(workerConnection)]);
    })();
  }
  return queueInfrastructureClosing;
}

export { connection };
