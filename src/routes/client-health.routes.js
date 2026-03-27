// Client Health Bot Routes
// Scores clients based on engagement, payment history, project activity, and communication

import { prisma } from '../index.js';

// Health scoring weights
const WEIGHTS = {
  paymentHistory: 0.35,    // 35% - most important
  projectActivity: 0.25,   // 25% - active projects/milestones
  communicationFreq: 0.20, // 20% - thread/message activity
  retainerStability: 0.20  // 20% - retainer presence + duration
};

// Calculate health score for a single client
async function calculateClientHealth(client) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  // --- Payment Health (35%) ---
  let paymentScore = 100;

  const invoices = await prisma.invoice.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const overdueInvoices = invoices.filter(inv =>
    inv.status === 'OVERDUE' ||
    (inv.status !== 'PAID' && inv.status !== 'VOID' && inv.dueDate && new Date(inv.dueDate) < now)
  );

  const overdueCount = overdueInvoices.length;
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  if (overdueCount > 0) paymentScore -= Math.min(60, overdueCount * 20);
  if (overdueAmount > 2000) paymentScore -= 20;
  else if (overdueAmount > 500) paymentScore -= 10;

  const recentPaid = invoices.filter(inv => inv.status === 'PAID').length;
  const onTimeBonus = recentPaid > 5 ? 10 : 0;
  paymentScore = Math.max(0, Math.min(100, paymentScore + onTimeBonus));

  // --- Project Activity (25%) ---
  let activityScore = 50;

  const activeProjects = await prisma.project.findMany({
    where: {
      clientId: client.id,
      status: { notIn: ['CANCELLED', 'LAUNCHED'] }
    },
    include: {
      _count: { select: { tasks: true, threads: true } }
    }
  });

  if (activeProjects.length > 0) activityScore += 30;

  const recentThreads = await prisma.thread.count({
    where: { clientId: client.id, createdAt: { gte: thirtyDaysAgo } }
  });
  activityScore += Math.min(20, recentThreads * 5);
  activityScore = Math.max(0, Math.min(100, activityScore));

  // --- Communication Frequency (20%) ---
  let commScore = 50;

  const recentMessages = await prisma.thread.count({
    where: { clientId: client.id, updatedAt: { gte: thirtyDaysAgo } }
  });

  const oldMessages = await prisma.thread.count({
    where: {
      clientId: client.id,
      updatedAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo }
    }
  });

  if (recentMessages >= 3) commScore = 90;
  else if (recentMessages >= 1) commScore = 70;
  else if (oldMessages >= 1) commScore = 40;
  else commScore = 20;

  // --- Retainer Stability (20%) ---
  let retainerScore = 50;

  const retainer = await prisma.retainerPlan.findUnique({
    where: { clientId: client.id }
  });

  if (retainer) {
    retainerScore = 80;
    const retainerAge = retainer.startDate
      ? (now - new Date(retainer.startDate)) / (1000 * 60 * 60 * 24 * 30)
      : 0;
    if (retainerAge >= 12) retainerScore = 100;
    else if (retainerAge >= 6) retainerScore = 90;
    else if (retainerAge >= 3) retainerScore = 85;
  } else {
    const recentPaidInvoices = invoices.filter(inv =>
      inv.status === 'PAID' && new Date(inv.paidAt || inv.updatedAt) >= ninetyDaysAgo
    );
    if (recentPaidInvoices.length > 0) retainerScore = 60;
  }

  // --- Calculate Final Score ---
  const finalScore = Math.round(
    paymentScore * WEIGHTS.paymentHistory +
    activityScore * WEIGHTS.projectActivity +
    commScore * WEIGHTS.communicationFreq +
    retainerScore * WEIGHTS.retainerStability
  );

  // --- Determine Status ---
  let healthStatus, healthColor;
  if (finalScore >= 80) { healthStatus = 'HEALTHY'; healthColor = 'green'; }
  else if (finalScore >= 60) { healthStatus = 'FAIR'; healthColor = 'yellow'; }
  else if (finalScore >= 40) { healthStatus = 'AT_RISK'; healthColor = 'orange'; }
  else { healthStatus = 'CRITICAL'; healthColor = 'red'; }

  // --- Generate Recommendations ---
  const recommendations = [];
  if (overdueCount > 0) {
    recommendations.push(`Chase ${overdueCount} overdue invoice(s) totalling $${overdueAmount.toFixed(0)}`);
  }
  if (recentMessages === 0 && oldMessages === 0) {
    recommendations.push('No contact in 90+ days - send a check-in message');
  } else if (recentMessages === 0) {
    recommendations.push('No contact in 30+ days - follow up soon');
  }
  if (!retainer && activeProjects.length === 0) {
    recommendations.push('No active projects or retainer - high churn risk');
  }
  if (activeProjects.length > 0 && recentMessages === 0) {
    recommendations.push('Active project but no recent comms - check in on progress');
  }
  if (finalScore >= 80 && !retainer) {
    recommendations.push('Healthy engagement - good time to pitch a retainer upgrade');
  }

  return {
    clientId: client.id,
    clientName: client.name,
    clientDomain: client.domain,
    clientStatus: client.status,
    healthScore: finalScore,
    healthStatus,
    healthColor,
    breakdown: {
      paymentScore: Math.round(paymentScore),
      activityScore: Math.round(activityScore),
      communicationScore: Math.round(commScore),
      retainerScore: Math.round(retainerScore)
    },
    details: {
      overdueInvoices: overdueCount,
      overdueAmount: Math.round(overdueAmount),
      activeProjects: activeProjects.length,
      recentThreads,
      hasRetainer: !!retainer
    },
    recommendations,
    lastCalculated: now.toISOString()
  };
}

export default async function clientHealthRoutes(fastify) {

  // GET /api/clients/health/dashboard - All client health scores
  fastify.get('/health/dashboard', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { status = 'ACTIVE' } = request.query;
      const where = status !== 'ALL' ? { status } : {};

      const clients = await prisma.client.findMany({
        where,
        orderBy: { name: 'asc' }
      });

      const healthScores = await Promise.all(
        clients.map(client => calculateClientHealth(client))
      );

      healthScores.sort((a, b) => a.healthScore - b.healthScore);

      const summary = {
        total: healthScores.length,
        healthy: healthScores.filter(h => h.healthStatus === 'HEALTHY').length,
        fair: healthScores.filter(h => h.healthStatus === 'FAIR').length,
        atRisk: healthScores.filter(h => h.healthStatus === 'AT_RISK').length,
        critical: healthScores.filter(h => h.healthStatus === 'CRITICAL').length,
        avgScore: healthScores.length > 0
          ? Math.round(healthScores.reduce((s, h) => s + h.healthScore, 0) / healthScores.length)
          : 0
      };

      return { summary, clients: healthScores };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to calculate health scores', details: err.message });
    }
  });

  // GET /api/clients/health/at-risk - Only at-risk and critical clients
  fastify.get('/health/at-risk', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const clients = await prisma.client.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' }
      });

      const healthScores = await Promise.all(
        clients.map(client => calculateClientHealth(client))
      );

      const atRisk = healthScores
        .filter(h => h.healthStatus === 'AT_RISK' || h.healthStatus === 'CRITICAL')
        .sort((a, b) => a.healthScore - b.healthScore);

      return { count: atRisk.length, clients: atRisk };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to get at-risk clients', details: err.message });
    }
  });

  // GET /api/clients/health/recommendations - Outreach suggestions
  fastify.get('/health/recommendations', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const clients = await prisma.client.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' }
      });

      const healthScores = await Promise.all(
        clients.map(client => calculateClientHealth(client))
      );

      const actions = [];
      for (const h of healthScores) {
        for (const rec of h.recommendations) {
          actions.push({
            clientId: h.clientId,
            clientName: h.clientName,
            healthScore: h.healthScore,
            healthStatus: h.healthStatus,
            action: rec,
            priority: h.healthStatus === 'CRITICAL' ? 'HIGH' :
                      h.healthStatus === 'AT_RISK' ? 'MEDIUM' : 'LOW'
          });
        }
      }

      actions.sort((a, b) => {
        const pOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
        return a.healthScore - b.healthScore;
      });

      return {
        totalActions: actions.length,
        highPriority: actions.filter(a => a.priority === 'HIGH').length,
        actions
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to get recommendations', details: err.message });
    }
  });

  // POST /api/clients/health/recalculate - Manual trigger
  fastify.post('/health/recalculate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { clientId } = request.body || {};

      let clients;
      if (clientId) {
        const client = await prisma.client.findUnique({ where: { id: clientId } });
        if (!client) return reply.status(404).send({ error: 'Client not found' });
        clients = [client];
      } else {
        clients = await prisma.client.findMany({ where: { status: 'ACTIVE' } });
      }

      const healthScores = await Promise.all(
        clients.map(client => calculateClientHealth(client))
      );

      return {
        recalculated: healthScores.length,
        timestamp: new Date().toISOString(),
        results: healthScores
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Recalculation failed', details: err.message });
    }
  });

  // GET /api/clients/health/:clientId - Single client health score
  fastify.get('/health/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { clientId } = request.params;
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      const health = await calculateClientHealth(client);
      return health;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to calculate health', details: err.message });
    }
  });
}
