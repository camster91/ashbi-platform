// Milestone routes

import { prisma } from '../index.js';

export default async function milestoneRoutes(fastify) {
  // List milestones for a project
  fastify.get('/projects/:projectId/milestones', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const { status } = request.query;

    const where = { projectId };
    if (status) where.status = status;

    const milestones = await prisma.milestone.findMany({
      where,
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true
          }
        },
        _count: {
          select: { tasks: true }
        }
      },
      orderBy: { dueDate: 'asc' }
    });

    // Calculate progress for each milestone
    return milestones.map(m => {
      const totalTasks = m.tasks.length;
      const completedTasks = m.tasks.filter(t => t.status === 'COMPLETED').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      // Check if overdue
      const isOverdue = new Date(m.dueDate) < new Date() && m.status !== 'COMPLETED';

      return {
        ...m,
        progress,
        totalTasks,
        completedTasks,
        isOverdue
      };
    });
  });

  // Get single milestone
  fastify.get('/milestones/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const milestone = await prisma.milestone.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true } }
          },
          orderBy: { position: 'asc' }
        }
      }
    });

    if (!milestone) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    const totalTasks = milestone.tasks.length;
    const completedTasks = milestone.tasks.filter(t => t.status === 'COMPLETED').length;

    return {
      ...milestone,
      progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalTasks,
      completedTasks
    };
  });

  // Create milestone
  fastify.post('/projects/:projectId/milestones', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { name, description, dueDate, color } = request.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    if (!dueDate) {
      return reply.status(400).send({ error: 'Due date is required' });
    }

    const milestone = await prisma.milestone.create({
      data: {
        name,
        description,
        dueDate: new Date(dueDate),
        color: color || '#3B82F6',
        projectId
      },
      include: {
        _count: { select: { tasks: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'MILESTONE_CREATED',
        action: 'created',
        entityType: 'MILESTONE',
        entityId: milestone.id,
        entityName: name,
        projectId,
        userId: request.user.id
      }
    });

    // Create calendar event for milestone
    await prisma.calendarEvent.create({
      data: {
        title: `Milestone: ${name}`,
        description: description || `Milestone due date for ${name}`,
        startTime: new Date(dueDate),
        endTime: new Date(dueDate),
        type: 'MILESTONE',
        isAllDay: true,
        color: color || '#3B82F6',
        projectId,
        createdById: request.user.id
      }
    });

    return reply.status(201).send({
      ...milestone,
      progress: 0,
      totalTasks: 0,
      completedTasks: 0
    });
  });

  // Update milestone
  fastify.put('/milestones/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, dueDate, status, color } = request.body;

    const existing = await prisma.milestone.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (status !== undefined) {
      data.status = status;
      if (status === 'COMPLETED') {
        data.completedAt = new Date();
      } else {
        data.completedAt = null;
      }
    }
    if (color !== undefined) data.color = color;

    const milestone = await prisma.milestone.update({
      where: { id },
      data,
      include: {
        tasks: { select: { status: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: status === 'COMPLETED' ? 'MILESTONE_COMPLETED' : 'MILESTONE_UPDATED',
        action: status === 'COMPLETED' ? 'completed' : 'updated',
        entityType: 'MILESTONE',
        entityId: milestone.id,
        entityName: milestone.name,
        projectId: existing.projectId,
        userId: request.user.id
      }
    });

    const totalTasks = milestone.tasks.length;
    const completedTasks = milestone.tasks.filter(t => t.status === 'COMPLETED').length;

    return {
      ...milestone,
      progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalTasks,
      completedTasks
    };
  });

  // Delete milestone
  fastify.delete('/milestones/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.milestone.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    // Unlink tasks from milestone before deleting
    await prisma.task.updateMany({
      where: { milestoneId: id },
      data: { milestoneId: null }
    });

    await prisma.milestone.delete({ where: { id } });

    return { success: true };
  });

  // Add task to milestone
  fastify.post('/milestones/:id/tasks/:taskId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id, taskId } = request.params;

    const milestone = await prisma.milestone.findUnique({ where: { id } });
    const task = await prisma.task.findUnique({ where: { id: taskId } });

    if (!milestone) {
      return reply.status(404).send({ error: 'Milestone not found' });
    }

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    if (task.projectId !== milestone.projectId) {
      return reply.status(400).send({ error: 'Task must be in the same project as milestone' });
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { milestoneId: id }
    });

    return { success: true };
  });

  // Remove task from milestone
  fastify.delete('/milestones/:id/tasks/:taskId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id, taskId } = request.params;

    await prisma.task.update({
      where: { id: taskId },
      data: { milestoneId: null }
    });

    return { success: true };
  });
}
