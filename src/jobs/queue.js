// BullMQ Queue Setup

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import env from '../config/env.js';

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
}

class MockQueueEvents {
  constructor(name) { this.name = name; }
  on() {}
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
  EMBEDDING: 'embedding'
};

// Create queues
export const emailQueue = new QueueClass(QUEUES.EMAIL_PROCESSING, { connection });
export const healthQueue = new QueueClass(QUEUES.PROJECT_HEALTH, { connection });
export const escalationQueue = new QueueClass(QUEUES.ESCALATION, { connection });
export const notificationQueue = new QueueClass(QUEUES.NOTIFICATIONS, { connection });
export const weeklyDigestQueue = new QueueClass(QUEUES.WEEKLY_DIGEST, { connection });
export const embeddingQueue = new QueueClass(QUEUES.EMBEDDING, { connection });

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
  const job = await emailQueue.add('process-email', emailData, {
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
  await healthQueue.add('update-health', { projectId }, {
    delay: 60000, // 1 minute delay to batch updates
    jobId: `health-${projectId}`, // Prevent duplicate jobs
    removeOnComplete: true
  });
}

/**
 * Schedule escalation check
 */
export async function scheduleEscalationCheck(threadId, delayMs) {
  await escalationQueue.add('check-escalation', { threadId }, {
    delay: delayMs,
    jobId: `escalation-${threadId}`,
    removeOnComplete: true
  });
}

/**
 * Queue notification for delivery
 */
export async function queueNotification(notification) {
  await notificationQueue.add('send-notification', notification, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
}

/**
 * Queue embedding generation for a client
 */
export async function queueEmbedding(clientId, content, source, sourceId = null, metadata = {}) {
  await embeddingQueue.add('generate-embedding', { clientId, content, source, sourceId, metadata }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true
  });
}

/**
 * Set up recurring jobs
 */
export async function setupRecurringJobs() {
  // Health check every hour
  await healthQueue.add('update-all-health', {}, {
    repeat: { every: 3600000 }, // 1 hour
    jobId: 'recurring-health-check'
  });

  // Escalation check every 15 minutes
  await escalationQueue.add('check-all-escalations', {}, {
    repeat: { every: 900000 }, // 15 minutes
    jobId: 'recurring-escalation-check'
  });

  // Weekly digest every Monday at 9am EST (14:00 UTC)
  await weeklyDigestQueue.add('generate-weekly-digest', {}, {
    repeat: { pattern: '0 14 * * 1' }, // Monday 9am EST
    jobId: 'recurring-weekly-digest'
  });

  console.log('Recurring jobs scheduled');
}

export { connection };
