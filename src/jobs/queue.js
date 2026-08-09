// BullMQ Queue Setup

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import env from '../config/env.js';
import { withCurrentTenantJobData } from './tenant-iteration.js';

// Create Redis connection - parse URL manually to handle special chars in password
function parseRedisUrl(url) {
  const match = url.match(/^redis:\/\/(?::(.+)@)?([^:]+):(\d+)/);
  if (match) {
    return { password: match[1] ? decodeURIComponent(match[1]) : undefined, host: match[2], port: parseInt(match[3]) };
  }
  return { host: 'localhost', port: 6379 };
}
const { host: redisHost, port: redisPort, password: redisPassword } = parseRedisUrl(env.redisUrl);

// Do not connect to real Redis during tests
const isTestEnv = process.env.NODE_ENV === 'test';

const connection = isTestEnv ? {} : new IORedis({
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  maxRetriesPerRequest: null
});

// Mock Queue classes for tests
class MockQueue {
  constructor(name) { this.name = name; }
  async add() { return { id: 'mock-job-id' }; }
  async upsertJobScheduler() { return { id: 'mock-scheduler-id' }; }
  async removeRepeatable() { return true; }
  async removeJobScheduler() { return true; }
  async getJobs() { return []; }
  async close() {}
}

class MockQueueEvents {
  constructor(name) { this.name = name; }
  on() {}
  async close() {}
}

const QueueClass = isTestEnv ? MockQueue : Queue;
const QueueEventsClass = isTestEnv ? MockQueueEvents : QueueEvents;

// Queue names
export const QUEUES = {
  EMAIL_PROCESSING: 'email-processing',
  PROJECT_HEALTH: 'project-health',
  ESCALATION: 'escalation',
  NOTIFICATIONS: 'notifications',
  WEEKLY_DIGEST: 'weekly-digest',
  EMBEDDING: 'embedding',
  SCHEDULED: 'scheduled-maintenance'
};

// Create queues
export const emailQueue = new QueueClass(QUEUES.EMAIL_PROCESSING, { connection });
export const healthQueue = new QueueClass(QUEUES.PROJECT_HEALTH, { connection });
export const escalationQueue = new QueueClass(QUEUES.ESCALATION, { connection });
export const notificationQueue = new QueueClass(QUEUES.NOTIFICATIONS, { connection });
export const weeklyDigestQueue = new QueueClass(QUEUES.WEEKLY_DIGEST, { connection });
export const embeddingQueue = new QueueClass(QUEUES.EMBEDDING, { connection });
export const scheduledQueue = new QueueClass(QUEUES.SCHEDULED, { connection });

// Queue event handlers
const emailQueueEvents = new QueueEventsClass(QUEUES.EMAIL_PROCESSING, { connection });
emailQueueEvents.on('completed', ({ jobId }) => {
  console.log(`Email processing job ${jobId} completed`);
});
emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Email processing job ${jobId} failed: ${failedReason}`);
});

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
  ]);
  const deprecatedWorkflowJobs = await scheduledQueue.getJobs(['wait', 'delayed', 'failed']);
  for (const job of deprecatedWorkflowJobs.filter((candidate) => candidate.name === 'scheduled-workflows')) {
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
    ['fleet-digest-daily-toronto', { pattern: '0 9 * * *', tz: 'America/Toronto' }, 'fleet-digest'],
  ];
  for (const [schedulerId, repeat, name] of scheduledJobs) {
    await scheduledQueue.upsertJobScheduler(
      schedulerId,
      repeat,
      { name, data: {}, opts: defaults },
    );
  }

  console.log('Recurring jobs scheduled');
}

export async function closeQueueInfrastructure() {
  await Promise.all([
    emailQueueEvents.close(),
    emailQueue.close(),
    healthQueue.close(),
    escalationQueue.close(),
    notificationQueue.close(),
    weeklyDigestQueue.close(),
    embeddingQueue.close(),
    scheduledQueue.close(),
  ]);
  if (!isTestEnv) await connection.quit();
}

export { connection };
