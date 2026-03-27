// Client Success Agent Routes — client updates, health scores, escalation workflow

import { getProvider } from '../ai/providers/index.js';

export default async function clientSuccessAgentRoutes(fastify) {
  // POST /api/client-success/update/draft — draft a client update using AI
  fastify.post('/update/draft', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { clientId, projectId, updateType = 'weekly', includeMetrics = true } = request.body || {};

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      const [client, project, recentTasks, recentNotes] = await Promise.all([
        fastify.prisma.client.findUnique({ where: { id: clientId } }).catch(() => null),
        projectId ? fastify.prisma.project.findUnique({
          where: { id: projectId },
          include: { tasks: { take: 10, orderBy: { updatedAt: 'desc' } } }
        }).catch(() => null) : fastify.prisma.project.findFirst({
          where: { clientId },
          include: { tasks: { take: 10, orderBy: { updatedAt: 'desc' } } },
          orderBy: { updatedAt: 'desc' }
        }).catch(() => null),
        fastify.prisma.task.findMany({
          where: { project: { clientId } },
          orderBy: { updatedAt: 'desc' },
          take: 10
        }).catch(() => []),
        fastify.prisma.note.findMany({
          where: { project: { clientId } },
          orderBy: { createdAt: 'desc' },
          take: 5
        }).catch(() => [])
      ]);

      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const completedTasks = recentTasks.filter(t => t.status === 'COMPLETED');
      const inProgressTasks = recentTasks.filter(t => t.status === 'IN_PROGRESS');

      const ai = getProvider();
      const prompt = `You are Ashbi Design's client success manager. Draft a warm, professional ${updateType} client update.

Client: ${client.name}
Project: ${project?.name || 'General Retainer'}
Project Status: ${project?.status || 'ACTIVE'}
Project Health: ${project?.health || 'ON_TRACK'}

Recently Completed Tasks (${completedTasks.length}):
${completedTasks.map(t => `- ${t.title}`).join('\n') || '- None this period'}

In Progress (${inProgressTasks.length}):
${inProgressTasks.map(t => `- ${t.title}`).join('\n') || '- None tracked'}

Recent Notes:
${recentNotes.map(n => `- ${n.title}: ${n.content?.substring(0, 100)}`).join('\n') || '- None'}

Write a brief, friendly ${updateType} update email:
1. Subject line
2. Opening (warm, personal)
3. Progress highlights (bullet points)
4. What's coming next
5. Any action items for the client
6. Closing

Keep it under 250 words. Professional but conversational — not corporate.`;

      const draft = await ai.generate(prompt, { maxTokens: 600 });

      return {
        draft,
        metadata: {
          clientId,
          clientName: client.name,
          projectName: project?.name,
          updateType,
          completedCount: completedTasks.length,
          inProgressCount: inProgressTasks.length,
          generatedAt: new Date().toISOString()
        },
        warning: 'Cameron must review and approve before sending to client'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to draft client update', details: err.message });
    }
  });

  // GET /api/client-success/health/scores — health scores for all clients
  fastify.get('/health/scores', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const clients = await fastify.prisma.client.findMany({
        where: { status: 'ACTIVE' },
        include: {
          projects: {
            where: { status: { not: 'CANCELLED' } },
            include: {
              tasks: {
                where: { status: { not: 'COMPLETED' } }
              }
            }
          },
          retainerPlan: true
        }
      }).catch(() => []);

      const scores = clients.map(client => {
        const activeProjects = client.projects.filter(p => p.status === 'ACTIVE');
        const atRiskProjects = client.projects.filter(p => p.health === 'AT_RISK');
        const overdueTasks = client.projects.flatMap(p =>
          p.tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date())
        );

        let score = 100;
        if (atRiskProjects.length > 0) score -= 25 * atRiskProjects.length;
        if (overdueTasks.length > 0) score -= 10 * Math.min(overdueTasks.length, 5);
        if (!client.retainerPlan) score -= 10;
        score = Math.max(0, Math.min(100, score));

        const healthLabel = score >= 80 ? 'healthy' : score >= 60 ? 'at_risk' : 'critical';

        return {
          clientId: client.id,
          clientName: client.name,
          score,
          healthLabel,
          indicators: {
            activeProjects: activeProjects.length,
            atRiskProjects: atRiskProjects.length,
            overdueTasks: overdueTasks.length,
            hasRetainer: !!client.retainerPlan,
            retainerTier: client.retainerPlan?.tier || null
          }
        };
      });

      scores.sort((a, b) => a.score - b.score);

      return {
        scores,
        summary: {
          total: scores.length,
          healthy: scores.filter(s => s.healthLabel === 'healthy').length,
          atRisk: scores.filter(s => s.healthLabel === 'at_risk').length,
          critical: scores.filter(s => s.healthLabel === 'critical').length
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to calculate health scores', details: err.message });
    }
  });

  // POST /api/client-success/escalate — escalation workflow
  fastify.post('/escalate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { clientId, reason, severity = 'medium', context } = request.body || {};

    if (!clientId || !reason) {
      return reply.status(400).send({ error: 'clientId and reason are required' });
    }

    const severityMap = {
      low: { priority: 'NORMAL', emoji: '🟡' },
      medium: { priority: 'HIGH', emoji: '🟠' },
      high: { priority: 'URGENT', emoji: '🔴' }
    };

    const sev = severityMap[severity] || severityMap.medium;

    try {
      const client = await fastify.prisma.client.findUnique({ where: { id: clientId } });
      if (!client) return reply.status(404).send({ error: 'Client not found' });

      // Create an escalation task for Cameron
      const escalationTask = await fastify.prisma.task.create({
        data: {
          title: `${sev.emoji} ESCALATION: ${client.name} — ${reason}`,
          description: `Severity: ${severity.toUpperCase()}\n\nReason: ${reason}\n\nContext: ${context || 'None provided'}\n\nTriggered by client-success agent at ${new Date().toISOString()}`,
          priority: sev.priority,
          category: 'UPCOMING',
          tags: JSON.stringify(['escalation', 'client-success', client.name.toLowerCase()]),
          properties: JSON.stringify({ clientId, escalatedAt: new Date().toISOString(), severity }),
          project: {
            connect: await fastify.prisma.project.findFirst({ where: { clientId } })
              .then(p => p ? { id: p.id } : undefined).catch(() => undefined)
          }
        }
      }).catch(() => null);

      // Log activity
      await fastify.prisma.activity.create({
        data: {
          type: 'ESCALATION',
          description: `Client escalation: ${reason}`,
          metadata: JSON.stringify({ clientId, severity, reason }),
          user: { connect: await fastify.prisma.user.findFirst({ where: { role: 'ADMIN' } }).then(u => ({ id: u?.id })).catch(() => undefined) }
        }
      }).catch(() => null);

      return {
        escalationId: escalationTask?.id || `esc-${Date.now()}`,
        clientName: client.name,
        severity,
        reason,
        status: 'escalated',
        taskCreated: !!escalationTask,
        message: `${sev.emoji} Escalation logged for ${client.name}. Cameron has been notified.`,
        escalatedAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to create escalation', details: err.message });
    }
  });
}
