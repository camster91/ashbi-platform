// Task Template routes

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';

export default async function templateRoutes(fastify) {
  // List all templates
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const templates = await prisma.taskTemplate.findMany({
      orderBy: { name: 'asc' }
    });

    return templates.map(t => ({
      ...t,
      tasks: safeParse(t.tasks, [])
    }));
  });

  // Create template
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, phase, tasks } = request.body;

    if (!name || !phase) {
      return reply.status(400).send({ error: 'Name and phase are required' });
    }

    const template = await prisma.taskTemplate.create({
      data: {
        name,
        phase,
        tasks: JSON.stringify(tasks || [])
      }
    });

    return reply.status(201).send({
      ...template,
      tasks: safeParse(template.tasks, [])
    });
  });

  // Apply template to project (creates tasks from template)
  fastify.post('/:id/apply/:projectId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id, projectId } = request.params;

    const template = await prisma.taskTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const templateTasks = safeParse(template.tasks, []);
    if (templateTasks.length === 0) {
      return reply.status(400).send({ error: 'Template has no tasks' });
    }

    const createdTasks = await prisma.$transaction(
      templateTasks.map((task, index) =>
        prisma.task.create({
          data: {
            title: task.title,
            description: task.description || null,
            projectId,
            category: 'UPCOMING',
            priority: 'NORMAL',
            position: index,
            aiGenerated: false
          }
        })
      )
    );

    return reply.status(201).send({
      success: true,
      tasksCreated: createdTasks.length,
      tasks: createdTasks
    });
  });

  // Update template
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, phase, tasks } = request.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (phase !== undefined) data.phase = phase;
    if (tasks !== undefined) data.tasks = JSON.stringify(tasks);

    const template = await prisma.taskTemplate.update({
      where: { id },
      data
    });

    return {
      ...template,
      tasks: safeParse(template.tasks, [])
    };
  });

  // Delete template
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    await prisma.taskTemplate.delete({ where: { id } });
    return { success: true };
  });
}
