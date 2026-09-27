// BullMQ Workers — graceful Redis connection handling

import { Worker } from 'bullmq';
import os from 'node:os';

import {
  closeQueueInfrastructure,
  getWorkerConnection,
  QUEUES,
  scheduleEscalationCheck,
  setupRecurringJobs,
} from './queue.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { updateAllProjectHealth } from '../services/project.service.js';
import { storeEmbedding } from '../services/embedding.service.js';
import { AiDisabledError } from '../ai/errors.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import prisma, { prisma as backgroundPrisma } from '../config/db.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';
import { runWeeklyDigest } from './weekly-digest.js';
import { processRecurringInvoicesForAllOrganizations } from './recurring-invoices.js';
import { purgeExpiredTrashForAllOrganizations } from './trash-purge.js';
import {
  checkOverdueInvoicesForAllOrganizations,
} from '../services/automation.service.js';
import { resolveEmbeddingOrganizationId } from './embedding-ownership.js';
import { checkAllEscalations, checkThreadEscalation, runForEachOrganization } from './escalation.js';
import { dispatchDomainEvents } from '../services/domain-event-dispatcher.service.js';
import { initSentry, Sentry } from '../observability/sentry.js';
import { sendOperationalAlert } from '../observability/alerts.js';

initSentry('worker');

// Workers and the heartbeat use the blocking-safe connection; producers in
// queue.js keep their own fail-fast connection.
const connection = getWorkerConnection();

// Helper to create workers with error handling for Redis unavailability
function createWorker(queueName, processor, options = {}) {
  try {
    const worker = new Worker(queueName, processor, { connection, ...options });

    worker.on('completed', (job) => {
      console.log(`[${queueName}] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      logger.error({
        errorName: err.name,
        errorCode: err.code,
        queue: queueName,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
      }, 'Worker job failed');
      if (env.sentryDsn) {
        Sentry.captureException(err, {
          tags: { queue: queueName, jobName: job?.name || 'unknown' },
          extra: { jobId: job?.id, attemptsMade: job?.attemptsMade },
        });
      }
      const configuredAttempts = job?.opts?.attempts || 1;
      if ((job?.attemptsMade || 0) >= configuredAttempts) {
        sendOperationalAlert({
          event: 'job_failed',
          severity: 'error',
          service: 'worker',
          queue: queueName,
          jobName: job?.name || 'unknown',
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
        }).catch((alertError) => {
          logger.error({
            errorName: alertError.name,
            queue: queueName,
            jobId: job?.id,
          }, 'Operational alert delivery failed');
        });
      }
    });

    worker.on('error', (err) => {
      console.error(`[${queueName}] Worker error:`, err.message);
    });

    return worker;
  } catch (err) {
    console.error(`[${queueName}] Failed to start worker:`, err.message);
    console.error(`[${queueName}] Jobs will not be processed until Redis is available`);
    return null;
  }
}

// Email Processing Worker
const emailWorker = createWorker(
  QUEUES.EMAIL_PROCESSING,
  async (job) => {
    console.log(`Processing email job ${job.id}`);
    const result = await runTenantJob(
      prisma,
      job.data?.organizationId,
      () => processEmailPipeline(job.data),
      backgroundPrisma,
    );

    // Schedule escalation if thread was created
    if (result.threadId) {
      const priority = result.analysis?.urgency || 'NORMAL';
      const delayHours = env.slaDefaults[priority] || 24;
      await scheduleEscalationCheck(result.threadId, delayHours * 3600000);
    }

    return result;
  },
  { concurrency: 5 }
);

// Project Health Worker
const healthWorker = createWorker(
  QUEUES.PROJECT_HEALTH,
  async (job) => {
    if (job.name === 'update-all-health') {
      console.log('Updating all project health scores');
      const organizationIds = await resolveTenantOrganizationIds(prisma);
      let updated = 0;
      for (const organizationId of organizationIds) {
        updated += await runTenantJob(
          prisma,
          organizationId,
          (tenantPrisma) => updateAllProjectHealth(tenantPrisma),
          backgroundPrisma,
        );
      }
      return { updated, organizations: organizationIds.length };
    }

    if (job.name === 'update-health' && job.data.projectId) {
      return runTenantJob(prisma, job.data?.organizationId, async (tenantPrisma) => {
        const { calculateHealthScore, getHealthStatus } = await import('../services/project.service.js');

        const project = await tenantPrisma.project.findUnique({
          where: { id: job.data.projectId },
          include: { threads: { where: { status: { not: 'RESOLVED' } } } }
        });

      if (project) {
        const score = calculateHealthScore(project, project.threads);
        const health = getHealthStatus(score);

        await tenantPrisma.project.update({
          where: { id: job.data.projectId },
          data: { healthScore: score, health }
        });

        return { projectId: job.data.projectId, score, health };
      }
      return { skipped: true };
      }, backgroundPrisma);
    }

    return { skipped: true };
  },
  { concurrency: 2 }
);

// Escalation Worker
const escalationWorker = createWorker(
  QUEUES.ESCALATION,
  async (job) => {
    if (job.name === 'check-all-escalations') {
      console.log('Checking all threads for escalation');
      const organizationIds = await resolveTenantOrganizationIds(prisma);
      // Each tenant runs in isolation; one failing organization no longer
      // aborts the sweep for the others.
      return runForEachOrganization(
        organizationIds,
        (organizationId) => runTenantJob(
          prisma,
          organizationId,
          () => checkAllEscalations({ prisma, slaDefaults: env.slaDefaults, logger }),
          backgroundPrisma,
        ),
        {
          logger,
          onError: (err, organizationId) => {
            if (env.sentryDsn) Sentry.captureException(err, { tags: { queue: QUEUES.ESCALATION }, extra: { organizationId } });
          },
        },
      );
    }

    if (job.name === 'check-escalation' && job.data.threadId) {
      return runTenantJob(
        prisma,
        job.data?.organizationId,
        () => checkThreadEscalation(job.data.threadId, { prisma, slaDefaults: env.slaDefaults }),
        backgroundPrisma,
      );
    }

    return { skipped: true };
  },
  { concurrency: 2 }
);

// Notification Worker
const notificationWorker = createWorker(
  QUEUES.NOTIFICATIONS,
  async (job) => {
    const { userId, type, title, message, data } = job.data;

    // Create in-app notification
    await runTenantJob(prisma, job.data?.organizationId, (tenantPrisma) => (
      tenantPrisma.notification.create({
        data: {
          type,
          title,
          message,
          data: data ? JSON.stringify(data) : null,
          userId
        }
      })
    ), backgroundPrisma);

    return { delivered: true };
  },
  { concurrency: 10 }
);

// Weekly Digest Worker (src/jobs/weekly-digest.js)
const weeklyDigestWorker = createWorker(
  QUEUES.WEEKLY_DIGEST,
  async (job) => {
    console.log('Generating weekly digest');
    return runWeeklyDigest({ prisma, backgroundPrisma, organizationId: job.data?.organizationId });
  },
  { concurrency: 1 }
);

// Embedding Worker
const embeddingWorker = createWorker(
  QUEUES.EMBEDDING,
  async (job) => {
    const { clientId, content, source, sourceId, metadata } = job.data;
    console.log(`Generating embedding for ${source}:${sourceId || 'none'}`);
    // Legacy queued jobs predate tenant IDs. Recover ownership only through
    // the job's client FK; missing or deleted owners continue to fail closed.
    const organizationId = await resolveEmbeddingOrganizationId(job.data);
    try {
      return await runTenantJob(
        prisma,
        organizationId,
        () => storeEmbedding(clientId, content, source, sourceId, metadata),
        backgroundPrisma,
      );
    } catch (err) {
      // AI is off for the deployment or this organization (#413): skip the
      // job instead of failing and retrying it.
      if (err instanceof AiDisabledError) {
        logger.warn({ organizationId, scope: err.scope }, 'Embedding skipped: AI is disabled');
        return { skipped: 'ai_disabled' };
      }
      throw err;
    }
  },
  { concurrency: 3 }
);

const scheduledWorker = createWorker(
  QUEUES.SCHEDULED,
  async (job) => {
    switch (job.name) {
      case 'recurring-invoices':
        return processRecurringInvoicesForAllOrganizations();
      case 'overdue-invoices':
        return checkOverdueInvoicesForAllOrganizations();
      case 'trash-purge':
        return purgeExpiredTrashForAllOrganizations();
      case 'fleet-digest':
        return { skipped: true, reason: 'retired WordPress fleet digest' };
      case 'scheduled-workflows':
        return { skipped: true, reason: 'deprecated unmodeled workflow scheduler' };
      default:
        throw new Error(`Unknown scheduled maintenance job: ${job.name}`);
    }
  },
  { concurrency: 1 },
);

// Domain event outbox dispatcher (#412, docs/event-outbox.md). Concurrency 1
// per replica; several replicas never double-claim thanks to SKIP LOCKED.
const domainEventsWorker = createWorker(
  QUEUES.DOMAIN_EVENTS,
  async (job) => {
    if (job.name !== 'dispatch-domain-events') throw new Error(`Unknown domain events job: ${job.name}`);
    return dispatchDomainEvents(backgroundPrisma);
  },
  { concurrency: 1 },
);

const activeWorkers = [
  emailWorker,
  healthWorker,
  escalationWorker,
  notificationWorker,
  weeklyDigestWorker,
  embeddingWorker,
  scheduledWorker,
  domainEventsWorker,
].filter(Boolean);

if (activeWorkers.length !== 8) {
  throw new Error(`Worker startup incomplete (${activeWorkers.length}/8 active)`);
}

await setupRecurringJobs();

const heartbeatKey = 'ashbi:workers:heartbeat';
const heartbeat = async () => {
  await connection.set(heartbeatKey, JSON.stringify({
    status: 'ok',
    host: os.hostname(),
    pid: process.pid,
    revision: process.env.APP_REVISION || 'unknown',
    timestamp: new Date().toISOString(),
  }), 'EX', 45);
};
await heartbeat();
const heartbeatInterval = setInterval(() => {
  heartbeat().catch((err) => logger.error({ err }, 'Worker heartbeat failed'));
}, 15_000);
heartbeatInterval.unref();

console.log(`Workers started (${activeWorkers.length}/8 active)`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatInterval);
  logger.info({ signal }, 'Worker: draining active jobs');
  await Promise.all(activeWorkers.map((worker) => worker.close()));
  await closeQueueInfrastructure();
  await prisma.$disconnect();
  logger.info('Worker: shutdown complete');
}

process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)).catch((err) => {
  logger.fatal({ err }, 'Worker: graceful shutdown failed');
  process.exit(1);
}));
process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)).catch((err) => {
  logger.fatal({ err }, 'Worker: graceful shutdown failed');
  process.exit(1);
}));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Worker: unhandled promise rejection');
  if (env.sentryDsn) Sentry.captureException(reason);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Worker: uncaught exception');
  if (env.sentryDsn) Sentry.captureException(err);
  shutdown('uncaughtException').finally(() => process.exit(1));
});
