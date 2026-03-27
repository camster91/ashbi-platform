// Time Tracking routes

import { prisma } from '../index.js';

export default async function timeRoutes(fastify) {
  // Get time entries for a project
  fastify.get('/projects/:projectId/time-entries', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const {
      userId,
      taskId,
      startDate,
      endDate,
      billable,
      page: pageParam = '1',
      limit: limitParam = '50'
    } = request.query;

    const page = parseInt(pageParam);
    const limit = parseInt(limitParam);

    const where = { projectId };

    if (userId) where.userId = userId;
    if (taskId) where.taskId = taskId;
    if (billable !== undefined) where.billable = billable === 'true';

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } }
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.timeEntry.count({ where })
    ]);

    // Calculate totals
    const aggregates = await prisma.timeEntry.aggregate({
      where,
      _sum: { duration: true }
    });

    const billableAggregates = await prisma.timeEntry.aggregate({
      where: { ...where, billable: true },
      _sum: { duration: true }
    });

    return {
      entries,
      totals: {
        totalMinutes: aggregates._sum.duration || 0,
        totalHours: Math.round((aggregates._sum.duration || 0) / 60 * 100) / 100,
        billableMinutes: billableAggregates._sum.duration || 0,
        billableHours: Math.round((billableAggregates._sum.duration || 0) / 60 * 100) / 100
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  });

  // Get my time entries
  fastify.get('/time-entries/my', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, projectId } = request.query;

    const where = { userId: request.user.id };

    if (projectId) where.projectId = projectId;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      },
      orderBy: { date: 'desc' },
      take: 100
    });

    // Group by date
    const grouped = entries.reduce((acc, entry) => {
      const dateKey = entry.date.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = { entries: [], totalMinutes: 0 };
      }
      acc[dateKey].entries.push(entry);
      acc[dateKey].totalMinutes += entry.duration;
      return acc;
    }, {});

    // Calculate weekly total
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weeklyTotal = entries
      .filter(e => new Date(e.date) >= weekAgo)
      .reduce((sum, e) => sum + e.duration, 0);

    return {
      grouped,
      weeklyTotalMinutes: weeklyTotal,
      weeklyTotalHours: Math.round(weeklyTotal / 60 * 100) / 100
    };
  });

  // Create time entry
  fastify.post('/time-entries', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, taskId, duration, description, date, billable = true } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'Project is required' });
    }

    if (!duration || duration <= 0) {
      return reply.status(400).send({ error: 'Duration must be a positive number' });
    }

    const entry = await prisma.timeEntry.create({
      data: {
        description,
        duration: parseInt(duration),
        date: date ? new Date(date) : new Date(),
        billable,
        taskId,
        projectId,
        userId: request.user.id
      },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'TIME_LOGGED',
        action: 'created',
        entityType: 'TIME_ENTRY',
        entityId: entry.id,
        entityName: `${duration} minutes`,
        metadata: JSON.stringify({ duration, taskId }),
        projectId,
        userId: request.user.id
      }
    });

    return reply.status(201).send(entry);
  });

  // Update time entry
  fastify.put('/time-entries/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { duration, description, date, billable, taskId } = request.body;

    const existing = await prisma.timeEntry.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Time entry not found' });
    }

    // Only owner or admin can update
    if (existing.userId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot edit this time entry' });
    }

    const data = {};
    if (duration !== undefined) data.duration = parseInt(duration);
    if (description !== undefined) data.description = description;
    if (date !== undefined) data.date = new Date(date);
    if (billable !== undefined) data.billable = billable;
    if (taskId !== undefined) data.taskId = taskId;

    const entry = await prisma.timeEntry.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });

    return entry;
  });

  // Delete time entry
  fastify.delete('/time-entries/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.timeEntry.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Time entry not found' });
    }

    // Only owner or admin can delete
    if (existing.userId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this time entry' });
    }

    await prisma.timeEntry.delete({ where: { id } });

    return { success: true };
  });

  // Get time summary by project
  fastify.get('/time-entries/summary', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;

    const where = {};

    // Only admin can see all, team members see their own
    if (request.user.role !== 'ADMIN') {
      where.userId = request.user.id;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } }
      }
    });

    // Group by project
    const byProject = entries.reduce((acc, entry) => {
      const key = entry.projectId;
      if (!acc[key]) {
        acc[key] = {
          project: entry.project,
          totalMinutes: 0,
          billableMinutes: 0,
          entries: 0
        };
      }
      acc[key].totalMinutes += entry.duration;
      if (entry.billable) acc[key].billableMinutes += entry.duration;
      acc[key].entries++;
      return acc;
    }, {});

    // Group by user (admin only)
    let byUser = null;
    if (request.user.role === 'ADMIN') {
      byUser = entries.reduce((acc, entry) => {
        const key = entry.userId;
        if (!acc[key]) {
          acc[key] = {
            user: entry.user,
            totalMinutes: 0,
            entries: 0
          };
        }
        acc[key].totalMinutes += entry.duration;
        acc[key].entries++;
        return acc;
      }, {});
    }

    return {
      byProject: Object.values(byProject),
      byUser: byUser ? Object.values(byUser) : null,
      totalMinutes: entries.reduce((sum, e) => sum + e.duration, 0)
    };
  });
}
