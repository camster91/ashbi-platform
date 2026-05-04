// Project routes

import { refreshProjectPlan, getProjectBudgetMetrics } from '../services/project.service.js';
import { safeParse } from '../utils/safeParse.js';
import { queueEmbedding } from '../jobs/queue.js';
import aiClient from '../ai/client.js';
import { validateBody, createProjectSchema, updateProjectSchema } from '../validators/schemas.js';
import bus, { EVENTS } from '../utils/events.js';

export default async function projectRoutes(fastify) {
  // List all projects
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status, clientId, health, limit = '50', offset = '0' } = request.query;

    const where = {};
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (health) where.health = health;

    const take = Math.min(parseInt(limit) || 50, 200);
    const skip = parseInt(offset) || 0;

    const [projects, total] = await Promise.all([
      request.prisma.project.findMany({
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
        ],
        take,
        skip
      }),
      request.prisma.project.count({ where })
    ]);

    // Add completed task counts
    const projectIds = projects.map(p => p.id);
    const completedCounts = await request.prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: 'COMPLETED' },
      _count: true
    });
    const completedMap = completedCounts.reduce((acc, item) => {
      acc[item.projectId] = item._count;
      return acc;
    }, {});

    return {
      projects: projects.map(p => ({
        ...p,
        completedTaskCount: completedMap[p.id] || 0
      })),
      total,
      limit: take,
      offset: skip
    };
  });

  // Create project
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(createProjectSchema)],
  }, async (request, reply) => {
    const { name, description, clientId, defaultOwnerId } = request.body;

    const project = await fastify.prisma.project.create({
      data: {
        name,
        description,
        clientId,
        defaultOwnerId
      }
    });

    // Decoupled side-effects via Event Bus
    bus.emit(EVENTS.PROJECT_CREATED, { project, user: request.user });

    return reply.status(201).send(project);
  });

  // Get single project with full details
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await fastify.prisma.project.findUnique({
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
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(updateProjectSchema)],
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      name, description, status, defaultOwnerId, clientId,
      budget, hourlyBudget, health, startDate, endDate,
      isRetainer, serviceType, notes
    } = request.body;

    const data = {};
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (status) data.status = status;
    if (defaultOwnerId !== undefined) data.defaultOwnerId = defaultOwnerId;
    if (clientId) data.clientId = clientId;
    if (budget !== undefined) data.budget = budget;
    if (hourlyBudget !== undefined) data.hourlyBudget = hourlyBudget;
    if (health !== undefined) data.health = health;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (isRetainer !== undefined) data.isRetainer = isRetainer;
    if (serviceType !== undefined) data.serviceType = serviceType;
    if (notes !== undefined) data.description = notes;

    const project = await fastify.prisma.project.update({
      where: { id },
      data
    });

    // Emit update event
    bus.emit(EVENTS.PROJECT_UPDATED, { project, user: request.user });

    return project;
  });

  // Get AI-generated project plan
  fastify.get('/:id/plan', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await fastify.prisma.project.findUnique({
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
      const updatedProject = await refreshProjectPlan(request.prisma, id);
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

    const tasks = await fastify.prisma.task.findMany({
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

    const task = await fastify.prisma.task.create({
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

    bus.emit(EVENTS.TASK_CREATED, { task, user: request.user });

    return reply.status(201).send(task);
  });

  // Get project health history (for charts)
  fastify.get('/:id/health-history', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;

    // TODO: Implement health history tracking
    // For now, return current health
    const project = await fastify.prisma.project.findUnique({
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

    const project = await fastify.prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const where = { projectId: id };
    if (direction && direction !== 'all') {
      where.direction = direction.toUpperCase();
    }

    const includeFullBody = full === 'true';

    const [communications, total] = await Promise.all([
      fastify.prisma.projectCommunication.findMany({
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
      fastify.prisma.projectCommunication.count({ where }),
    ]);

    return { communications, total };
  });

  // ==================== PROJECT CONTEXT ====================

  // GET /:id/context — get project context
  fastify.get('/:id/context', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const project = await fastify.prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const context = await fastify.prisma.projectContext.findUnique({
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

    const project = await fastify.prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const context = await fastify.prisma.projectContext.upsert({
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

  // ==================== AI PROJECT PLANNER ====================

  // POST /:id/ai-plan — Generate full project plan with AI
  fastify.post('/:id/ai-plan', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { brief, projectType } = request.body || {};

    if (!brief) {
      return reply.status(400).send({ error: 'Project brief is required' });
    }

    const project = await fastify.prisma.project.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } } }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const systemPrompt = `You are a project manager for a design agency called Ashbi Design. Given a project brief, generate a structured project plan.

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "milestones": [
    {
      "name": "Milestone name",
      "description": "What this milestone covers",
      "dueOffset": 7
    }
  ],
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to be done",
      "category": "IMMEDIATE|THIS_WEEK|UPCOMING",
      "priority": "CRITICAL|HIGH|NORMAL|LOW",
      "estimatedHours": 4,
      "milestoneIndex": 0,
      "dependsOn": []
    }
  ],
  "timeline": {
    "estimatedWeeks": 8
  }
}

Rules:
- dueOffset is days from project start
- milestoneIndex references the index in the milestones array
- dependsOn is an array of task indices that must complete first
- Create realistic milestones and tasks for a design agency
- Include discovery, design, development, content, testing, and launch phases as appropriate
- Tasks should have clear, actionable titles`;

      const userPrompt = `Project: ${project.name}
Client: ${project.client?.name || 'Unknown'}
Type: ${projectType || project.serviceType || 'Custom'}
Brief: ${brief}`;

      const plan = await aiClient.chatJSON({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      if (!plan || !plan.milestones || !plan.tasks) {
        return reply.status(500).send({ error: 'AI returned invalid plan structure' });
      }

      // Create milestones in DB
      const now = new Date();
      const createdMilestones = [];

      for (const ms of plan.milestones) {
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + (ms.dueOffset || 7));

        const milestone = await fastify.prisma.milestone.create({
          data: {
            name: ms.name,
            description: ms.description || null,
            dueDate,
            projectId: id,
          }
        });
        createdMilestones.push(milestone);
      }

      // Create tasks in DB
      const createdTasks = [];
      for (const task of plan.tasks) {
        const milestoneId = task.milestoneIndex != null && createdMilestones[task.milestoneIndex]
          ? createdMilestones[task.milestoneIndex].id
          : null;

        const created = await fastify.prisma.task.create({
          data: {
            title: task.title,
            description: task.description || null,
            category: task.category || 'UPCOMING',
            priority: task.priority || 'NORMAL',
            estimatedTime: task.estimatedHours ? `${task.estimatedHours}h` : null,
            projectId: id,
            milestoneId,
            aiGenerated: true,
          }
        });
        createdTasks.push(created);
      }

      // Save the full AI plan as JSON on the project
      await fastify.prisma.project.update({
        where: { id },
        data: {
          aiPlan: JSON.stringify(plan),
        }
      });

      return {
        success: true,
        plan,
        milestones: createdMilestones,
        tasks: createdTasks,
      };
    } catch (error) {
      fastify.log.error(error, 'AI plan generation failed');
      return reply.status(500).send({
        error: 'Failed to generate AI plan',
        message: error.message
      });
    }
  });

  // ==================== PROJECT TEMPLATES ====================

  // GET /templates — List all project templates
  fastify.get('/templates', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const templates = await fastify.prisma.projectTemplate.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    return templates.map(t => ({
      ...t,
      tasks: safeParse(t.tasks, []),
      milestones: safeParse(t.milestones, []),
    }));
  });

  // POST /templates — Save current project as template
  fastify.post('/templates', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, name, description, projectType } = request.body || {};

    if (!name) {
      return reply.status(400).send({ error: 'Template name is required' });
    }

    let tasksData = [];
    let milestonesData = [];

    // If projectId provided, copy from existing project
    if (projectId) {
      const project = await fastify.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            select: {
              title: true,
              description: true,
              category: true,
              priority: true,
              estimatedTime: true,
              milestoneId: true,
            }
          },
          milestones: {
            select: {
              name: true,
              description: true,
              dueDate: true,
              color: true,
            },
            orderBy: { dueDate: 'asc' }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      // Build milestone map for dueOffset calculation
      const projectStart = project.startDate || project.createdAt;
      milestonesData = project.milestones.map((ms, index) => {
        const dueOffset = Math.round(
          (new Date(ms.dueDate) - new Date(projectStart)) / (1000 * 60 * 60 * 24)
        );
        return {
          name: ms.name,
          description: ms.description,
          dueOffset: Math.max(dueOffset, 1),
          color: ms.color,
          _originalId: ms.id || index,
        };
      });

      // Map milestone IDs to indices
      const milestoneIdToIndex = {};
      project.milestones.forEach((ms, index) => {
        milestoneIdToIndex[ms.id] = index;
      });

      tasksData = project.tasks.map(task => ({
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority,
        estimatedTime: task.estimatedTime,
        milestoneIndex: task.milestoneId ? (milestoneIdToIndex[task.milestoneId] ?? null) : null,
      }));

      // Clean up internal IDs from milestones
      milestonesData = milestonesData.map(({ _originalId, ...rest }) => rest);
    }

    const template = await fastify.prisma.projectTemplate.create({
      data: {
        name,
        description: description || null,
        projectType: projectType || null,
        tasks: JSON.stringify(tasksData),
        milestones: JSON.stringify(milestonesData),
      }
    });

    return reply.status(201).send({
      ...template,
      tasks: tasksData,
      milestones: milestonesData,
    });
  });

  // POST /from-template — Create project from template
  fastify.post('/from-template', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { templateId, clientId, name } = request.body || {};

    if (!templateId || !clientId || !name) {
      return reply.status(400).send({ error: 'templateId, clientId, and name are required' });
    }

    const template = await fastify.prisma.projectTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const client = await fastify.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    const templateMilestones = safeParse(template.milestones, []);
    const templateTasks = safeParse(template.tasks, []);

    // Create the project
    const project = await fastify.prisma.project.create({
      data: {
        name,
        description: template.description || null,
        clientId,
        serviceType: template.projectType || null,
      }
    });

    // Create milestones
    const now = new Date();
    const createdMilestones = [];

    for (const ms of templateMilestones) {
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + (ms.dueOffset || 7));

      const milestone = await fastify.prisma.milestone.create({
        data: {
          name: ms.name,
          description: ms.description || null,
          dueDate,
          color: ms.color || '#3B82F6',
          projectId: project.id,
        }
      });
      createdMilestones.push(milestone);
    }

    // Create tasks
    const createdTasks = [];
    for (const task of templateTasks) {
      const milestoneId = task.milestoneIndex != null && createdMilestones[task.milestoneIndex]
        ? createdMilestones[task.milestoneIndex].id
        : null;

      const created = await fastify.prisma.task.create({
        data: {
          title: task.title,
          description: task.description || null,
          category: task.category || 'UPCOMING',
          priority: task.priority || 'NORMAL',
          estimatedTime: task.estimatedTime || null,
          projectId: project.id,
          milestoneId,
          aiGenerated: false,
        }
      });
      createdTasks.push(created);
    }

    return reply.status(201).send({
      project,
      milestones: createdMilestones,
      tasks: createdTasks,
    });
  });

  // DELETE /templates/:templateId — Delete a project template
  fastify.delete('/templates/:templateId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { templateId } = request.params;

    try {
      await fastify.prisma.projectTemplate.delete({ where: { id: templateId } });
      return { success: true };
    } catch (error) {
      return reply.status(404).send({ error: 'Template not found' });
    }
  });

  // GET /:id/budget — Budget tracking for a project
  fastify.get('/:id/budget', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    
    const metrics = await getProjectBudgetMetrics(request.prisma, id);
    
    if (!metrics) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return metrics;
  });
}
