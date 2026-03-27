// Project routes

import { prisma } from '../index.js';
import { refreshProjectPlan } from '../services/project.service.js';
import { safeParse } from '../utils/safeParse.js';

export default async function projectRoutes(fastify) {
  // List all projects
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status, clientId, health } = request.query;

    const where = {};
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (health) where.health = health;

    const projects = await prisma.project.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        _count: {
          select: {
            threads: true,
            tasks: true
          }
        }
      },
      orderBy: [
        { health: 'asc' }, // AT_RISK first
        { updatedAt: 'desc' }
      ]
    });

    // Add completed task counts
    const projectIds = projects.map(p => p.id);
    const completedCounts = await prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: 'COMPLETED' },
      _count: true
    });
    const completedMap = completedCounts.reduce((acc, item) => {
      acc[item.projectId] = item._count;
      return acc;
    }, {});

    return projects.map(p => ({
      ...p,
      completedTaskCount: completedMap[p.id] || 0
    }));
  });

  // Create project
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, description, clientId, defaultOwnerId } = request.body;

    const project = await prisma.project.create({
      data: {
        name,
        description,
        clientId,
        defaultOwnerId
      }
    });

    return reply.status(201).send(project);
  });

  // Get single project with full details
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        threads: {
          orderBy: { lastActivityAt: 'desc' },
          include: {
            assignedTo: { select: { id: true, name: true } },
            _count: { select: { messages: true, responses: true } }
          }
        },
        tasks: {
          orderBy: [
            { priority: 'asc' },
            { createdAt: 'desc' }
          ],
          include: {
            assignee: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Parse JSON fields
    return {
      ...project,
      aiPlan: safeParse(project.aiPlan),
      risks: safeParse(project.risks, [])
    };
  });

  // Update project
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, status, defaultOwnerId, clientId } = request.body;

    const data = {};
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (status) data.status = status;
    if (defaultOwnerId !== undefined) data.defaultOwnerId = defaultOwnerId;
    if (clientId) data.clientId = clientId;

    const project = await prisma.project.update({
      where: { id },
      data
    });

    return project;
  });

  // Get AI-generated project plan
  fastify.get('/:id/plan', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        aiPlan: true,
        aiSummary: true,
        health: true,
        healthScore: true,
        risks: true,
        updatedAt: true
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return {
      ...project,
      aiPlan: safeParse(project.aiPlan),
      risks: safeParse(project.risks, [])
    };
  });

  // Refresh project plan (regenerate with AI)
  fastify.post('/:id/plan/refresh', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const updatedProject = await refreshProjectPlan(id);
      return {
        success: true,
        project: {
          ...updatedProject,
          aiPlan: safeParse(updatedProject.aiPlan),
          risks: safeParse(updatedProject.risks, [])
        }
      };
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to refresh project plan',
        message: error.message
      });
    }
  });

  // Get project tasks
  fastify.get('/:id/tasks', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    const { status, category, assigneeId } = request.query;

    const where = { projectId: id };
    if (status) where.status = status;
    if (category) where.category = category;
    if (assigneeId) where.assigneeId = assigneeId;

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } }
      },
      orderBy: [
        { priority: 'asc' },
        { dueDate: 'asc' }
      ]
    });

    return tasks;
  });

  // Create task in project
  fastify.post('/:id/tasks', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      title,
      description,
      priority = 'NORMAL',
      category = 'UPCOMING',
      estimatedTime,
      dueDate,
      assigneeId,
      sourceThreadId
    } = request.body;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        priority,
        category,
        estimatedTime,
        dueDate: dueDate ? new Date(dueDate) : null,
        assigneeId,
        sourceThreadId,
        projectId: id,
        aiGenerated: false
      }
    });

    return reply.status(201).send(task);
  });

  // Get project health history (for charts)
  fastify.get('/:id/health-history', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;

    // TODO: Implement health history tracking
    // For now, return current health
    const project = await prisma.project.findUnique({
      where: { id },
      select: { health: true, healthScore: true, updatedAt: true }
    });

    return [{
      health: project.health,
      score: project.healthScore,
      timestamp: project.updatedAt
    }];
  });

  // ==================== COMMUNICATIONS ====================

  // GET /:id/communications — get email history for a project
  fastify.get('/:id/communications', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { limit = '20', offset = '0', direction, full } = request.query;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const where = { projectId: id };
    if (direction && direction !== 'all') {
      where.direction = direction.toUpperCase();
    }

    const includeFullBody = full === 'true';

    const [communications, total] = await Promise.all([
      prisma.projectCommunication.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        select: {
          id: true,
          gmailThreadId: true,
          gmailMessageId: true,
          from: true,
          to: true,
          subject: true,
          bodySnippet: true,
          fullBody: includeFullBody,
          direction: true,
          sentiment: true,
          summary: true,
          actionItems: true,
          account: true,
          receivedAt: true,
          createdAt: true,
        },
      }),
      prisma.projectCommunication.count({ where }),
    ]);

    return { communications, total };
  });

  // ==================== PROJECT CONTEXT ====================

  // GET /:id/context — get project context
  fastify.get('/:id/context', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const context = await prisma.projectContext.findUnique({
      where: { projectId: id },
    });

    return {
      aiSummary: context?.aiSummary || null,
      humanNotes: context?.humanNotes || null,
      lastCompactedAt: context?.lastCompactedAt || null,
      compactionVersion: context?.compactionVersion || 0,
      emailCount: context?.emailCount || 0,
    };
  });

  // POST /:id/context — update project context (human notes)
  fastify.post('/:id/context', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { humanNotes } = request.body || {};

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const context = await prisma.projectContext.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        aiSummary: '',
        humanNotes: humanNotes || null,
      },
      update: {
        humanNotes: humanNotes || null,
      },
    });

    return context;
  });
}
