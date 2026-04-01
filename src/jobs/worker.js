// BullMQ Workers

import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { connection, QUEUES, scheduleEscalationCheck } from './queue.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { updateAllProjectHealth } from '../services/project.service.js';
import aiClient from '../ai/client.js';
import env from '../config/env.js';

const prisma = new PrismaClient();

// Email Processing Worker
const emailWorker = new Worker(
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
  { connection, concurrency: 5 }
);

emailWorker.on('completed', (job) => {
  console.log(`Email job ${job.id} completed successfully`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err.message);
});

// Project Health Worker
const healthWorker = new Worker(
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
  { connection, concurrency: 2 }
);

healthWorker.on('failed', (job, err) => {
  console.error(`Health job ${job?.id} failed:`, err.message);
});

// Escalation Worker
const escalationWorker = new Worker(
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
  { connection, concurrency: 2 }
);

escalationWorker.on('failed', (job, err) => {
  console.error(`Escalation job ${job?.id} failed:`, err.message);
});

// Notification Worker
const notificationWorker = new Worker(
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

    // TODO: Add email notification support
    // TODO: Add webhook/Slack notification support

    return { delivered: true };
  },
  { connection, concurrency: 10 }
);

notificationWorker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed:`, err.message);
});

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

  // Check escalation thresholds
  // 4 hours: Notify assignee
  // 8 hours: Notify admin
  // 24 hours or SLA breach: Critical alert

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
    // Notify all admins
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
    // Mark SLA as breached
    await prisma.thread.update({
      where: { id: threadId },
      data: { slaBreached: true }
    });

    // Critical notification
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

  // Create notifications
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
const weeklyDigestWorker = new Worker(
  QUEUES.WEEKLY_DIGEST,
  async (job) => {
    console.log('Generating weekly digest');

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    // New leads this week (threads with needsTriage from this week)
    const newLeads = await prisma.thread.count({
      where: {
        needsTriage: true,
        createdAt: { gte: weekStart }
      }
    });

    // Proposals sent/viewed/hired this week
    const proposalsSent = await prisma.proposal.count({
      where: { sentAt: { gte: weekStart } }
    });
    const proposalsViewed = await prisma.proposal.count({
      where: { status: 'VIEWED', updatedAt: { gte: weekStart } }
    });
    const proposalsHired = await prisma.proposal.count({
      where: { status: 'APPROVED', approvedAt: { gte: weekStart } }
    });

    // Client health summary
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

    // Tasks overdue
    const tasksOverdue = await prisma.task.count({
      where: { status: { not: 'COMPLETED' }, dueDate: { lt: now } }
    });

    // Revenue summary (retainer totals)
    const retainers = await prisma.retainerPlan.findMany({ include: { client: true } });
    const retainerTotal = retainers.reduce((sum, r) => sum + parseFloat(r.tier || 0), 0);

    // Generate AI digest
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

    // Save to DB
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
  { connection, concurrency: 1 }
);

weeklyDigestWorker.on('completed', (job) => {
  console.log(`Weekly digest job ${job.id} completed`);
});

weeklyDigestWorker.on('failed', (job, err) => {
  console.error(`Weekly digest job ${job?.id} failed:`, err.message);
});

console.log('Workers started');
console.log('- Email processing worker');
console.log('- Project health worker');
console.log('- Escalation worker');
console.log('- Notification worker');
console.log('- Weekly digest worker');
