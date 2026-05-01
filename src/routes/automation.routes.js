// Automation history routes

import prisma from '../config/db.js';

export default async function automationRoutes(fastify) {
  // All routes require admin auth
  fastify.addHook('onRequest', fastify.adminOnly);

  // GET /api/automations/history — last 50 automation events
  fastify.get('/history', async (request, reply) => {
    const { limit = 50, offset = 0 } = request.query;

    const activities = await prisma.activity.findMany({
      where: {
        metadata: { contains: 'WORKFLOW_ENGINE' }
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 50, 100),
      skip: parseInt(offset) || 0,
      include: {
        user: { select: { name: true } }
      }
    });

    const total = await prisma.activity.count({
      where: {
        metadata: { contains: 'WORKFLOW_ENGINE' }
      }
    });

    return {
      automations: activities.map(a => ({
        id: a.id,
        type: a.type,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        entityName: a.entityName,
        metadata: a.metadata ? JSON.parse(a.metadata) : null,
        createdAt: a.createdAt
      })),
      total,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0
    };
  });
}
