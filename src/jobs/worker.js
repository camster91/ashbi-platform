// BullMQ Workers — graceful Redis connection handling

import { Worker } from 'bullmq';
import os from 'node:os';

import {
  closeQueueInfrastructure,
  connection,
  QUEUES,
  scheduleEscalationCheck,
  setupRecurringJobs,
} from './queue.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { updateAllProjectHealth } from '../services/project.service.js';
import { storeEmbedding } from '../services/embedding.service.js';
import aiClient from '../ai/client.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import prisma, { prisma as backgroundPrisma } from '../config/db.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';
import { processRecurringInvoicesForAllOrganizations } from './recurring-invoices.js';
import { purgeExpiredTrashForAllOrganizations } from './trash-purge.js';
import {
  checkOverdueInvoicesForAllOrganizations,
} from '../services/automation.service.js';
import { runScheduledFleetDigest } from '../routes/wp-bridge.routes.js';
import { resolveEmbeddingOrganizationId } from './embedding-ownership.js';
import { initSentry, Sentry } from '../observability/sentry.js';
import { sendOperationalAlert } from '../observability/alerts.js';

initSentry('worker');

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
      const results = [];
      for (const organizationId of organizationIds) {
        results.push(await runTenantJob(prisma, organizationId, () => checkAllEscalations(), backgroundPrisma));
      }
      return { organizations: results };
    }

    if (job.name === 'check-escalation' && job.data.threadId) {
      return runTenantJob(
        prisma,
        job.data?.organizationId,
        () => checkThreadEscalation(job.data.threadId),
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

/**
 * Check all threads for escalation needs
 */
async function checkAllEscalations() {
  const now = new Date();

  // Find threads needing response that are past SLA
  const threads = await prisma.thread.findMany({
    where: {
      status: 'AWAITING_RESPONSE',
      slaBreached: false
    },
    include: {
      assignedTo: true
    }
  });

  let escalated = 0;

  for (const thread of threads) {
    const result = await checkThreadEscalation(thread.id, thread);
    if (result.escalated) escalated++;
  }

  return { checked: threads.length, escalated };
}

/**
 * Check single thread for escalation
 */
async function checkThreadEscalation(threadId, existingThread = null) {
  const thread = existingThread || await prisma.thread.findUnique({
    where: { id: threadId },
    include: { assignedTo: true }
  });

  if (!thread || thread.status === 'RESOLVED') {
    return { skipped: true, reason: 'Thread not found or resolved' };
  }

  const now = new Date();
  const hoursSinceActivity = (now - new Date(thread.lastActivityAt)) / (1000 * 60 * 60);
  const slaHours = env.slaDefaults[thread.priority] || 24;

  const notifications = [];

  if (hoursSinceActivity >= 4 && hoursSinceActivity < 8 && thread.assignedToId) {
    notifications.push({
      userId: thread.assignedToId,
      type: 'SLA_WARNING',
      title: 'Response needed soon',
      message: `Thread "${thread.subject}" needs attention (${Math.round(hoursSinceActivity)}h without response)`,
      data: { threadId }
    });
  }

  if (hoursSinceActivity >= 8) {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true }
    });

    for (const admin of admins) {
      notifications.push({
        userId: admin.id,
        type: 'ESCALATION',
        title: 'Thread escalation',
        message: `Thread "${thread.subject}" has had no response for ${Math.round(hoursSinceActivity)} hours`,
        data: { threadId, assigneeId: thread.assignedToId }
      });
    }
  }

  if (hoursSinceActivity >= slaHours && !thread.slaBreached) {
    await prisma.thread.update({
      where: { id: threadId },
      data: { slaBreached: true }
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true }
    });

    for (const admin of admins) {
      notifications.push({
        userId: admin.id,
        type: 'SLA_BREACH',
        title: 'SLA BREACH',
        message: `Thread "${thread.subject}" has breached SLA (${Math.round(hoursSinceActivity)}h without response)`,
        data: { threadId, priority: thread.priority }
      });
    }
  }

  // PERFORMANCE (audit 2026-07-09, swarm finding): the previous loop
  // issued one INSERT per notification — at 2 admins × 2 escalation paths
  // that's 4 round-trips per escalation event. Use createMany for a
  // single round-trip. Not in a transaction because notifications are
  // independently-fanout; partial failure is acceptable.
  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }

  return {
    escalated: notifications.length > 0,
    notifications: notifications.length,
    hoursSinceActivity: Math.round(hoursSinceActivity)
  };
}

// Weekly Digest Worker
const weeklyDigestWorker = createWorker(
  QUEUES.WEEKLY_DIGEST,
  async (job) => {
    console.log('Generating weekly digest');

    const organizationIds = await resolveTenantOrganizationIds(prisma, job.data?.organizationId);
    const organizationResults = [];

    for (const organizationId of organizationIds) {
      const tenantPrisma = createScopedPrisma(backgroundPrisma, organizationId);

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const newLeads = await tenantPrisma.thread.count({
      where: {
        needsTriage: true,
        createdAt: { gte: weekStart }
      }
    });

    const proposalsSent = await tenantPrisma.proposal.count({
      where: { sentAt: { gte: weekStart } }
    });
    const proposalsViewed = await tenantPrisma.proposal.count({
      where: { status: 'VIEWED', updatedAt: { gte: weekStart } }
    });
    const proposalsHired = await tenantPrisma.proposal.count({
      where: { status: 'APPROVED', approvedAt: { gte: weekStart } }
    });

    const clients = await tenantPrisma.client.findMany({
      where: { status: 'ACTIVE' },
      include: {
        threads: { where: { status: { not: 'RESOLVED' } }, orderBy: { lastActivityAt: 'desc' }, take: 1 },
        projects: { where: { status: 'ACTIVE' }, include: { tasks: { where: { status: { not: 'COMPLETED' } } } } },
        retainerPlan: true
      }
    });

    const clientHealthSummary = {};
    for (const client of clients) {
      let score = 100;
      const lastThread = client.threads[0];
      if (lastThread) {
        const daysSince = (now - new Date(lastThread.lastActivityAt)) / (1000 * 60 * 60 * 24);
        if (daysSince > 14) score -= 25;
        else if (daysSince > 7) score -= 15;
      } else { score -= 20; }
      const openTasks = client.projects.reduce((s, p) => s + p.tasks.length, 0);
      if (openTasks > 10) score -= 15;
      else if (openTasks > 5) score -= 10;
      if (client.retainerPlan) {
        const pctUsed = client.retainerPlan.hoursPerMonth > 0 ? (client.retainerPlan.hoursUsed / client.retainerPlan.hoursPerMonth) * 100 : 0;
        if (pctUsed > 90) score -= 20;
        else if (pctUsed > 75) score -= 10;
      }
      const overdue = client.projects.reduce((s, p) => s + p.tasks.filter(t => t.dueDate && new Date(t.dueDate) < now).length, 0);
      score -= Math.min(20, overdue * 5);
      clientHealthSummary[client.name] = Math.max(0, Math.min(100, score));
    }

    const tasksOverdue = await tenantPrisma.task.count({
      where: { status: { not: 'COMPLETED' }, dueDate: { lt: now } }
    });

    const retainers = await tenantPrisma.retainerPlan.findMany({ include: { client: true } });
    const retainerTotal = retainers.reduce((sum, r) => sum + parseFloat(r.tier || 0), 0);

    const system = `You are the AI assistant for Ashbi Design agency. Generate a concise weekly digest email for Cameron (CEO).`;
    const prompt = `Generate a weekly digest for the week of ${weekStart.toLocaleDateString('en-CA')} to ${now.toLocaleDateString('en-CA')}:

- New leads: ${newLeads}
- Proposals sent: ${proposalsSent}
- Proposals viewed: ${proposalsViewed}
- Proposals hired/approved: ${proposalsHired}
- Overdue tasks: ${tasksOverdue}
- Monthly retainer revenue: $${retainerTotal}
- Client health scores: ${JSON.stringify(clientHealthSummary)}

Write a brief, actionable digest highlighting what needs attention this week. Include the numbers but also provide context and recommendations.`;

    let fullDigest;
    try {
      fullDigest = await aiClient.chat({ system, prompt, temperature: 0.5 });
    } catch (err) {
      fullDigest = `Weekly Digest (${weekStart.toLocaleDateString('en-CA')} - ${now.toLocaleDateString('en-CA')})\n\nNew Leads: ${newLeads}\nProposals Sent: ${proposalsSent}\nProposals Viewed: ${proposalsViewed}\nProposals Hired: ${proposalsHired}\nOverdue Tasks: ${tasksOverdue}\nRetainer Revenue: $${retainerTotal}`;
    }

    await tenantPrisma.weeklyDigest.create({
      data: {
        weekStart,
        weekEnd: now,
        newLeads,
        proposalsSent,
        proposalsViewed,
        proposalsHired,
        tasksOverdue,
        retainerTotal,
        clientHealthSummary: JSON.stringify(clientHealthSummary),
        fullDigest
      }
    });

      organizationResults.push({ organizationId, newLeads, proposalsSent, proposalsViewed, proposalsHired, tasksOverdue, retainerTotal });
    }

    return { organizations: organizationResults };
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
    const result = await runTenantJob(
      prisma,
      organizationId,
      () => storeEmbedding(clientId, content, source, sourceId, metadata),
      backgroundPrisma,
    );
    return result;
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
        return runScheduledFleetDigest(logger);
      case 'scheduled-workflows':
        return { skipped: true, reason: 'deprecated unmodeled workflow scheduler' };
      default:
        throw new Error(`Unknown scheduled maintenance job: ${job.name}`);
    }
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
].filter(Boolean);

if (activeWorkers.length !== 7) {
  throw new Error(`Worker startup incomplete (${activeWorkers.length}/7 active)`);
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

console.log(`Workers started (${activeWorkers.length}/7 active)`);

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
