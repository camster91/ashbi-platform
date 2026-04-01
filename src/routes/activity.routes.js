// Activity Feed routes

import { prisma } from '../index.js';

export default async function activityRoutes(fastify) {
  // Get activity feed for a project
  fastify.get('/projects/:projectId/activity', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const {
      type,
      userId,
      limit: limitParam = '50',
      before
    } = request.query;

    const limit = parseInt(limitParam);
    const where = { projectId };

    if (type) where.type = type;
    if (userId) where.userId = userId;
    if (before) where.createdAt = { lt: new Date(before) };

    const activities = await prisma.activity.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return activities.map(a => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null
    }));
  });

  // Get global activity feed (admin only)
  fastify.get('/activity', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const {
      projectId,
      userId,
      entityType,
      limit: limitParam = '50',
      before
    } = request.query;

    const limit = parseInt(limitParam);
    const where = {};

    if (projectId) where.projectId = projectId;
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (before) where.createdAt = { lt: new Date(before) };

    const activities = await prisma.activity.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return activities.map(a => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null
    }));
  });

  // Get my activity
  fastify.get('/activity/my', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { limit: limitParam = '30' } = request.query;
    const limit = parseInt(limitParam);

    const activities = await prisma.activity.findMany({
      where: { userId: request.user.id },
      include: {
        project: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return activities.map(a => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null
    }));
  });

  // Get activity summary (for dashboard)
  fastify.get('/activity/summary', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { days = '7' } = request.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const where = {
      createdAt: { gte: daysAgo }
    };

    // Non-admin only sees their activity
    if (request.user.role !== 'ADMIN') {
      where.userId = request.user.id;
    }

    const activities = await prisma.activity.findMany({
      where,
      select: {
        type: true,
        action: true,
        entityType: true,
        createdAt: true
      }
    });

    // Group by type
    const byType = activities.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {});

    // Group by day
    const byDay = activities.reduce((acc, a) => {
      const day = a.createdAt.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    // Group by entity type
    const byEntity = activities.reduce((acc, a) => {
      acc[a.entityType] = (acc[a.entityType] || 0) + 1;
      return acc;
    }, {});

    return {
      total: activities.length,
      byType,
      byDay,
      byEntity
    };
  });
}
