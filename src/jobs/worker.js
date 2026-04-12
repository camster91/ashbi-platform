// BullMQ Workers — graceful Redis connection handling

import { Worker } from 'bullmq';

import { connection, QUEUES, scheduleEscalationCheck } from './queue.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { updateAllProjectHealth } from '../services/project.service.js';
import { storeEmbedding } from '../services/embedding.service.js';
import aiClient from '../ai/client.js';
import env from '../config/env.js';

import prisma from '../config/db.js';

// Helper to create workers with error handling for Redis unavailability
function createWorker(queueName, processor, options = {}) {
  try {
    const worker = new Worker(queueName, processor, { connection, ...options });

    worker.on('completed', (job) => {
      console.log(`[${queueName}] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[${queueName}] Job ${job?.id} failed:`, err.message);
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
    const result = await processEmailPipeline(job.data);

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
      const count = await updateAllProjectHealth();
      return { updated: count };
    }

    if (job.name === 'update-health' && job.data.projectId) {
      const { calculateHealthScore, getHealthStatus } = await import('../services/project.service.js');

      const project = await prisma.project.findUnique({
        where: { id: job.data.projectId },
        include: { threads: { where: { status: { not: 'RESOLVED' } } } }
      });

      if (project) {
        const score = calculateHealthScore(project, project.threads);
        const health = getHealthStatus(score);

        await prisma.project.update({
          where: { id: job.data.projectId },
          data: { healthScore: score, health }
        });

        return { projectId: job.data.projectId, score, health };
      }
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
      return await checkAllEscalations();
    }

    if (job.name === 'check-escalation' && job.data.threadId) {
      return await checkThreadEscalation(job.data.threadId);
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
    await prisma.notification.create({
      data: {
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null,
        userId
      }
    });

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

  for (const notif of notifications) {
    await prisma.notification.create({ data: notif });
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

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const newLeads = await prisma.thread.count({
      where: {
        needsTriage: true,
        createdAt: { gte: weekStart }
      }
    });

    const proposalsSent = await prisma.proposal.count({
      where: { sentAt: { gte: weekStart } }
    });
    const proposalsViewed = await prisma.proposal.count({
      where: { status: 'VIEWED', updatedAt: { gte: weekStart } }
    });
    const proposalsHired = await prisma.proposal.count({
      where: { status: 'APPROVED', approvedAt: { gte: weekStart } }
    });

    const clients = await prisma.client.findMany({
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

    const tasksOverdue = await prisma.task.count({
      where: { status: { not: 'COMPLETED' }, dueDate: { lt: now } }
    });

    const retainers = await prisma.retainerPlan.findMany({ include: { client: true } });
    const retainerTotal = retainers.reduce((sum, r) => sum + parseFloat(r.tier || 0), 0);

    const system = `You are the AI assistant for Ashbi Design agency. Generate a concise weekly digest email for Cameron (CEO).`;
    const prompt = `Generate a weekly digest for the week of ${weekStart.toLocaleDateString()} to ${now.toLocaleDateString()}:

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
      fullDigest = `Weekly Digest (${weekStart.toLocaleDateString()} - ${now.toLocaleDateString()})\n\nNew Leads: ${newLeads}\nProposals Sent: ${proposalsSent}\nProposals Viewed: ${proposalsViewed}\nProposals Hired: ${proposalsHired}\nOverdue Tasks: ${tasksOverdue}\nRetainer Revenue: $${retainerTotal}`;
    }

    await prisma.weeklyDigest.create({
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

    return { newLeads, proposalsSent, proposalsViewed, proposalsHired, tasksOverdue, retainerTotal };
  },
  { concurrency: 1 }
);

// Embedding Worker
const embeddingWorker = createWorker(
  QUEUES.EMBEDDING,
  async (job) => {
    const { clientId, content, source, sourceId, metadata } = job.data;
    console.log(`Generating embedding for ${source}:${sourceId || 'none'}`);
    const result = await storeEmbedding(clientId, content, source, sourceId, metadata);
    return result;
  },
  { concurrency: 3 }
);

const activeWorkers = [emailWorker, healthWorker, escalationWorker, notificationWorker, weeklyDigestWorker, embeddingWorker].filter(Boolean);
console.log(`Workers started (${activeWorkers.length}/6 active)`);