// Weekly digest (#413 security review): each organization's digest runs inside
// runTenantJob, so the AI call sees that organization in its request context
// and honours its kill switch and BYOK connection. Before, the loop only built
// a scoped Prisma client and every digest went to the platform provider.

import aiClient from '../ai/client.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';

/**
 * Build and store one organization's weekly digest.
 * @param {any} tenantPrisma organization-scoped Prisma client
 * @param {{ chat?: (options: any) => Promise<string>, now?: Date }} [options]
 */
export async function buildWeeklyDigest(tenantPrisma, { chat = (options) => aiClient.chat(options), now: at = new Date() } = {}) {
  const now = at;
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
    fullDigest = await chat({ system, prompt, temperature: 0.5 });
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

  return { newLeads, proposalsSent, proposalsViewed, proposalsHired, tasksOverdue, retainerTotal };
}

/**
 * Run the weekly digest for one organization (when requested) or all of them.
 * @param {{ prisma: any, backgroundPrisma: any, organizationId?: string | null, chat?: (options: any) => Promise<string> }} options
 */
export async function runWeeklyDigest({ prisma, backgroundPrisma, organizationId: requested = null, chat }) {
  const organizationIds = await resolveTenantOrganizationIds(prisma, requested);
  const organizations = [];
  for (const organizationId of organizationIds) {
    const summary = await runTenantJob(
      prisma,
      organizationId,
      (tenantPrisma) => buildWeeklyDigest(tenantPrisma, { chat }),
      backgroundPrisma,
    );
    organizations.push({ organizationId, ...summary });
  }
  return { organizations };
}
