// Workflow Automations Routes

import prisma from '../config/db.js';
import { executeWorkflow } from '../services/automation.service.js';

export default async function automationRoutes(fastify) {
  // All routes require admin auth
  fastify.addHook('onRequest', fastify.adminOnly);

  // ==================== WORKFLOWS CRUD ====================

  // GET /api/automations/workflows — list all workflows
  fastify.get('/workflows', async (request, reply) => {
    const { enabled, triggerType } = request.query;

    const where = {};
    if (enabled !== undefined) where.enabled = enabled === 'true';
    if (triggerType) where.triggerType = triggerType;

    const workflows = await prisma.workflow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { runs: true } }
      }
    });

    return { workflows };
  });

  // GET /api/automations/workflows/:id — get single workflow
  fastify.get('/workflows/:id', async (request, reply) => {
    const { id } = request.params;

    const workflow = await prisma.workflow.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    return { workflow };
  });

  // POST /api/automations/workflows — create workflow
  fastify.post('/workflows', async (request, reply) => {
    const { name, description, triggerType, triggerConfig, actions, enabled = true } = request.body;

    if (!name || !triggerType || !triggerConfig || !actions) {
      return reply.status(400).send({ error: 'name, triggerType, triggerConfig, and actions are required' });
    }

    const validTriggers = ['SCHEDULE', 'WEBHOOK', 'EVENT'];
    if (!validTriggers.includes(triggerType)) {
      return reply.status(400).send({ error: `triggerType must be one of: ${validTriggers.join(', ')}` });
    }

    // Validate actions array
    const actionsArr = Array.isArray(actions) ? actions : JSON.parse(actions || '[]');
    const validActionTypes = ['SEND_EMAIL', 'CREATE_TASK', 'SEND_TELEGRAM', 'UPDATE_DEAL_STAGE', 'WEBHOOK_CALL', 'CONDITION'];
    for (const action of actionsArr) {
      if (!action.type || !validActionTypes.includes(action.type)) {
        return reply.status(400).send({ error: `Invalid action type: ${action.type}. Must be one of: ${validActionTypes.join(', ')}` });
      }
    }

    const workflow = await prisma.workflow.create({
      data: {
        name,
        description,
        triggerType,
        triggerConfig: typeof triggerConfig === 'string' ? JSON.parse(triggerConfig) : triggerConfig,
        actions: actionsArr,
        enabled,
        createdById: request.user.id
      },
      include: {
        createdBy: { select: { id: true, name: true } }
      }
    });

    return { workflow };
  });

  // PUT /api/automations/workflows/:id — update workflow
  fastify.put('/workflows/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, description, triggerType, triggerConfig, actions, enabled } = request.body;

    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (triggerType !== undefined) {
      const validTriggers = ['SCHEDULE', 'WEBHOOK', 'EVENT'];
      if (!validTriggers.includes(triggerType)) {
        return reply.status(400).send({ error: `triggerType must be one of: ${validTriggers.join(', ')}` });
      }
      updateData.triggerType = triggerType;
    }
    if (triggerConfig !== undefined) {
      updateData.triggerConfig = typeof triggerConfig === 'string' ? JSON.parse(triggerConfig) : triggerConfig;
    }
    if (actions !== undefined) {
      const actionsArr = Array.isArray(actions) ? actions : JSON.parse(actions || '[]');
      updateData.actions = actionsArr;
    }
    if (enabled !== undefined) updateData.enabled = enabled;

    const workflow = await prisma.workflow.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: { select: { id: true, name: true } }
      }
    });

    return { workflow };
  });

  // DELETE /api/automations/workflows/:id — delete workflow
  fastify.delete('/workflows/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    await prisma.workflow.delete({ where: { id } });

    return { success: true };
  });

  // POST /api/automations/workflows/:id/toggle — enable/disable workflow
  fastify.post('/workflows/:id/toggle', async (request, reply) => {
    const { id } = request.params;

    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const updated = await prisma.workflow.update({
      where: { id },
      data: { enabled: !workflow.enabled }
    });

    return { workflow: updated };
  });

  // POST /api/automations/workflows/:id/run — manually trigger workflow
  fastify.post('/workflows/:id/run', async (request, reply) => {
    const { id } = request.params;
    const triggerData = request.body || {};

    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    // Execute workflow and get result
    const result = await executeWorkflow(workflow, { ...triggerData, manual: true });

    return result;
  });

  // ==================== WORKFLOW RUNS ====================

  // GET /api/automations/runs — list workflow runs
  fastify.get('/runs', async (request, reply) => {
    const { workflowId, status, limit = 50, offset = 0 } = request.query;

    const where = {};
    if (workflowId) where.workflowId = workflowId;
    if (status) where.status = status;

    const runs = await prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 50, 100),
      skip: parseInt(offset) || 0,
      include: {
        workflow: { select: { id: true, name: true } }
      }
    });

    const total = await prisma.workflowRun.count({ where });

    return { runs, total, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 };
  });

  // GET /api/automations/runs/:id — get run details
  fastify.get('/runs/:id', async (request, reply) => {
    const { id } = request.params;

    const run = await prisma.workflowRun.findUnique({
      where: { id },
      include: {
        workflow: {
          select: { id: true, name: true, triggerType: true, triggerConfig: true, actions: true }
        }
      }
    });

    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    return { run };
  });

  // ==================== LEGACY HISTORY (kept for backwards compat) ====================

  // GET /api/automations/history — last 50 automation events (legacy)
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

  // ==================== WEBHOOK ENDPOINT (public, no auth) ====================

  // POST /api/automations/webhook/:webhookPath — trigger workflows by webhook
  fastify.post('/webhook/:webhookPath', { preHandler: [] }, async (request, reply) => {
    const { webhookPath } = request.params;
    const payload = request.body || {};

    // Find workflows with matching webhook path
    const workflows = await prisma.workflow.findMany({
      where: {
        triggerType: 'WEBHOOK',
        enabled: true,
        triggerConfig: {
          path: webhookPath
        }
      }
    });

    if (workflows.length === 0) {
      return reply.status(404).send({ error: 'Webhook not found or disabled' });
    }

    const results = [];
    for (const workflow of workflows) {
      try {
        const result = await executeWorkflow(workflow, { webhookPath, payload });
        results.push({ workflowId: workflow.id, success: true, result });
      } catch (err) {
        results.push({ workflowId: workflow.id, success: false, error: err.message });
      }
    }

    return { triggered: workflows.length, results };
  });
}