// Automation routes — workflow CRUD + history

import prisma from '../config/db.js';
import { runWorkflow, runScheduledWorkflows, triggerEventWorkflows } from '../services/automation.service.js';

export default async function automationRoutes(fastify) {
  // All routes require admin auth
  fastify.addHook('onRequest', fastify.adminOnly);

  // ==================== WORKFLOW DEFINITIONS ====================

  // GET /api/automations — list all workflow definitions
  fastify.get('/', async (request, reply) => {
    const workflows = await prisma.workflowDefinition.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { runs: true } }
      }
    });

    return workflows.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      trigger: w.trigger,
      triggerConfig: JSON.parse(w.triggerConfig || '{}'),
      conditions: JSON.parse(w.conditions || '[]'),
      actions: JSON.parse(w.actions || '[]'),
      isActive: w.isActive,
      isPaused: w.isPaused,
      runCount: w.runCount,
      lastRunAt: w.lastRunAt,
      lastRunStatus: w.lastRunStatus,
      createdBy: w.createdBy,
      totalRuns: w._count.runs,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt
    }));
  });

  // POST /api/automations — create a new workflow
  fastify.post('/', async (request, reply) => {
    const { name, description, trigger, triggerConfig, conditions, actions } = request.body;

    if (!name || !trigger) {
      return reply.status(400).send({ error: 'Name and trigger are required' });
    }

    const validTriggers = ['schedule', 'webhook', 'event'];
    const isEventTrigger = trigger.startsWith('event:');
    if (!validTriggers.includes(trigger) && !isEventTrigger) {
      return reply.status(400).send({ error: `Invalid trigger type. Must be one of: ${validTriggers.join(', ')}, or event:<name>` });
    }

    const workflow = await prisma.workflowDefinition.create({
      data: {
        name,
        description: description || null,
        trigger,
        triggerConfig: JSON.stringify(triggerConfig || {}),
        conditions: JSON.stringify(conditions || []),
        actions: JSON.stringify(actions || []),
        createdById: request.user?.id || null
      }
    });

    reply.status(201).send({
      ...workflow,
      triggerConfig: JSON.parse(workflow.triggerConfig),
      conditions: JSON.parse(workflow.conditions),
      actions: JSON.parse(workflow.actions)
    });
  });

  // GET /api/automations/:id — get a single workflow
  fastify.get('/:id', async (request, reply) => {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { runs: true } }
      }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    return {
      ...workflow,
      triggerConfig: JSON.parse(workflow.triggerConfig || '{}'),
      conditions: JSON.parse(workflow.conditions || '[]'),
      actions: JSON.parse(workflow.actions || '[]'),
      totalRuns: workflow._count.runs
    };
  });

  // PUT /api/automations/:id — update a workflow
  fastify.put('/:id', async (request, reply) => {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const { name, description, trigger, triggerConfig, conditions, actions, isActive, isPaused } = request.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (trigger !== undefined) updateData.trigger = trigger;
    if (triggerConfig !== undefined) updateData.triggerConfig = JSON.stringify(triggerConfig);
    if (conditions !== undefined) updateData.conditions = JSON.stringify(conditions);
    if (actions !== undefined) updateData.actions = JSON.stringify(actions);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPaused !== undefined) updateData.isPaused = isPaused;

    const updated = await prisma.workflowDefinition.update({
      where: { id: request.params.id },
      data: updateData
    });

    return {
      ...updated,
      triggerConfig: JSON.parse(updated.triggerConfig),
      conditions: JSON.parse(updated.conditions),
      actions: JSON.parse(updated.actions)
    };
  });

  // DELETE /api/automations/:id — delete a workflow
  fastify.delete('/:id', async (request, reply) => {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    await prisma.workflowDefinition.delete({
      where: { id: request.params.id }
    });

    return { deleted: true };
  });

  // POST /api/automations/:id/toggle — toggle active/paused
  fastify.post('/:id/toggle', async (request, reply) => {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const updated = await prisma.workflowDefinition.update({
      where: { id: request.params.id },
      data: {
        isActive: !workflow.isActive,
        isPaused: workflow.isActive ? true : false
      }
    });

    return {
      ...updated,
      triggerConfig: JSON.parse(updated.triggerConfig),
      conditions: JSON.parse(updated.conditions),
      actions: JSON.parse(updated.actions)
    };
  });

  // POST /api/automations/:id/run — test-run a workflow
  fastify.post('/:id/run', async (request, reply) => {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    try {
      const run = await runWorkflow(workflow.id, {
        ...request.body || {},
        triggeredAt: new Date().toISOString(),
        trigger: 'manual_test'
      });

      return {
        runId: run.id,
        status: run.status,
        actions: JSON.parse(run.actions || '[]'),
        error: run.error,
        durationMs: run.durationMs
      };
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // GET /api/automations/:id/runs — execution history for a workflow
  fastify.get('/:id/runs', async (request, reply) => {
    const { limit = 20, offset = 0 } = request.query;

    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: request.params.id }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const [runs, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where: { workflowId: request.params.id },
        orderBy: { startedAt: 'desc' },
        take: Math.min(parseInt(limit) || 20, 100),
        skip: parseInt(offset) || 0
      }),
      prisma.workflowRun.count({
        where: { workflowId: request.params.id }
      })
    ]);

    return {
      runs: runs.map(r => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger,
        triggerData: r.triggerData ? JSON.parse(r.triggerData) : null,
        actions: JSON.parse(r.actions || '[]'),
        error: r.error,
        durationMs: r.durationMs,
        startedAt: r.startedAt,
        completedAt: r.completedAt
      })),
      total,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0
    };
  });

  // ==================== HISTORY ====================

  // GET /api/automations/history — last 50 automation events
  fastify.get('/history', async (request, reply) => {
    const { limit = 50, offset = 0 } = request.query;

    const activities = await prisma.activity.findMany({
      where: {
        OR: [
          { metadata: { contains: 'WORKFLOW_ENGINE' } },
          { metadata: { contains: 'WORKFLOW_ACTION' } }
        ]
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
        OR: [
          { metadata: { contains: 'WORKFLOW_ENGINE' } },
          { metadata: { contains: 'WORKFLOW_ACTION' } }
        ]
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

  // POST /api/automations/trigger-event — trigger event workflows externally
  fastify.post('/trigger-event', async (request, reply) => {
    const { event, context } = request.body;

    if (!event) {
      return reply.status(400).send({ error: 'Event name is required' });
    }

    const results = await triggerEventWorkflows(event, context || {});

    return {
      event,
      triggered: results.length,
      results
    };
  });
}
