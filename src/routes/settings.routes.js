// Settings routes (assignment rules, templates, configuration)

import { safeParse } from '../utils/safeParse.js';
import {
  validateBody,
  assignmentRuleCreateSchema,
  assignmentRuleUpdateSchema,
  templateCreateSchema,
  templateUpdateSchema,
  templateRenderSchema,
  aiProviderSwitchSchema,
  aiKillSwitchSchema,
} from '../validators/schemas.js';
import env from '../config/env.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { getPlatformAiStatus, setPlatformAiDisabled } from '../ai/governance.js';

// Re-read the account so a demoted or deactivated operator loses the right
// immediately, not when their session token expires.
async function isPlatformOperator(prisma, user) {
  if (!user?.id || !env.platformOperatorUserIds.includes(user.id)) return false;
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, isActive: true },
  });
  return account?.role === 'ADMIN' && account.isActive === true;
}

export default async function settingsRoutes(fastify) {
  // ==================== ASSIGNMENT RULES ====================

  // List all assignment rules
  fastify.get('/assignment-rules', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const rules = await request.prisma.assignmentRule.findMany({
      orderBy: [
        { priority: 'desc' },
        { name: 'asc' }
      ]
    });

    return rules.map(r => ({
      ...r,
      conditions: safeParse(r.conditions, [])
    }));
  });

  // Create assignment rule
  fastify.post('/assignment-rules', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(assignmentRuleCreateSchema),
  }, async (request, reply) => {
    const { name, type, conditions, assignToId, priority = 0, isActive = true } = request.body;

    const rule = await request.prisma.assignmentRule.create({
      data: {
        name,
        type,
        conditions: JSON.stringify(conditions),
        assignToId,
        priority,
        isActive
      }
    });

    return reply.status(201).send({
      ...rule,
      conditions: safeParse(rule.conditions, [])
    });
  });

  // Update assignment rule
  fastify.put('/assignment-rules/:id', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(assignmentRuleUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, type, conditions, assignToId, priority, isActive } = request.body;

    const data = {};
    if (name) data.name = name;
    if (type) data.type = type;
    if (conditions) data.conditions = JSON.stringify(conditions);
    if (assignToId !== undefined) data.assignToId = assignToId;
    if (priority !== undefined) data.priority = priority;
    if (isActive !== undefined) data.isActive = isActive;

    const rule = await request.prisma.assignmentRule.update({
      where: { id },
      data
    });

    return {
      ...rule,
      conditions: safeParse(rule.conditions, [])
    };
  });

  // Delete assignment rule
  fastify.delete('/assignment-rules/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    await request.prisma.assignmentRule.delete({
      where: { id }
    });

    return { success: true };
  });

  // ==================== TEMPLATES ====================

  // List all templates
  fastify.get('/templates', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { category, activeOnly } = request.query;

    const where = {};
    if (category) where.category = category;
    if (activeOnly === 'true') where.isActive = true;

    const templates = await request.prisma.template.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ]
    });

    return templates.map(t => ({
      ...t,
      variables: safeParse(t.variables, [])
    }));
  });

  // Get template by ID
  fastify.get('/templates/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const template = await request.prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    return {
      ...template,
      variables: safeParse(template.variables, [])
    };
  });

  // Create template
  fastify.post('/templates', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(templateCreateSchema),
  }, async (request, reply) => {
    const { name, category, subject, body, variables = [], isActive = true } = request.body;

    const template = await request.prisma.template.create({
      data: {
        name,
        category,
        subject,
        body,
        variables: JSON.stringify(variables),
        isActive
      }
    });

    return reply.status(201).send({
      ...template,
      variables: safeParse(template.variables, [])
    });
  });

  // Update template
  fastify.put('/templates/:id', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(templateUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, category, subject, body, variables, isActive } = request.body;

    const data = {};
    if (name) data.name = name;
    if (category) data.category = category;
    if (subject !== undefined) data.subject = subject;
    if (body) data.body = body;
    if (variables) data.variables = JSON.stringify(variables);
    if (isActive !== undefined) data.isActive = isActive;

    const template = await request.prisma.template.update({
      where: { id },
      data
    });

    return {
      ...template,
      variables: safeParse(template.variables, [])
    };
  });

  // Delete template
  fastify.delete('/templates/:id', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    await request.prisma.template.delete({
      where: { id }
    });

    return { success: true };
  });

  // Render template with variables
  fastify.post('/templates/:id/render', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(templateRenderSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { variables = {} } = request.body;

    const template = await request.prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    // Replace variables in subject and body
    let subject = template.subject || '';
    let body = template.body;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
    }

    return { subject, body };
  });

  // ==================== SLA CONFIGURATION ====================

  // Get SLA settings
  fastify.get('/sla', {
    onRequest: [fastify.authenticate]
  }, async () => {
    // Return default SLA settings from env
    return {
      defaults: {
        CRITICAL: 2,
        HIGH: 4,
        NORMAL: 24,
        LOW: 72
      },
      unit: 'hours'
    };
  });

  // ==================== AI PROVIDER ====================

  // Get current AI provider + available Ollama cloud models
  fastify.get('/ai-provider', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { getProviderName, getOllamaModel } = await import('../ai/providers/index.js');
    const { OLLAMA_MODELS } = await import('../ai/providers/ollama.js');
    return {
      provider: getProviderName(),
      available: ['claude', 'gemini', 'ollama'],
      ollamaModel: getOllamaModel(),
      ollamaModels: OLLAMA_MODELS,
      canManage: await isPlatformOperator(request.prisma, request.user),
      platformAi: await getPlatformAiStatus(),
    };
  });

  // Deployment-wide AI kill switch (#413, docs/ai-byok.md). Turning it on
  // makes every AI call, for every organization, fail with AI_DISABLED before
  // any provider is contacted. It is persisted (platform_settings), so every
  // API and worker process applies it within the governance cache TTL.
  // AI_DISABLED=true in the environment keeps AI off regardless.
  fastify.post('/ai-kill-switch', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(aiKillSwitchSchema)],
  }, async (request, reply) => {
    if (!(await isPlatformOperator(request.prisma, request.user))) {
      return reply.status(403).send({
        error: 'The deployment AI kill switch can only be changed by a platform operator.',
      });
    }
    const { disabled } = request.body;
    await setPlatformAiDisabled(request.prisma, disabled, { actorUserId: request.user.id });
    await recordRequestAuditEvent(request.prisma, request, {
      action: disabled ? 'ai.disabled' : 'ai.enabled',
      entityType: 'settings',
      entityId: 'ai_platform',
      metadata: { scope: 'platform' },
    });
    return { platformAi: await getPlatformAiStatus() };
  });

  // Switch AI provider at runtime. The provider is shared by every
  // organization on this deployment, so an organization admin must not be
  // able to change it for other tenants: only platform operators may.
  fastify.post('/ai-provider', {
    onRequest: [fastify.adminOnly],
    preHandler: [requireRecentAuth, validateBody(aiProviderSwitchSchema)],
  }, async (request, reply) => {
    if (!(await isPlatformOperator(request.prisma, request.user))) {
      return reply.status(403).send({
        error: 'The AI provider is shared by every workspace on this deployment and can only be changed by a platform operator.',
      });
    }
    const { provider, model } = request.body;
    const { setProvider, getProviderName, getOllamaModel } = await import('../ai/providers/index.js');
    if (provider === 'ollama' && model && model !== getOllamaModel()) {
      const { default: OllamaProvider, OLLAMA_MODELS } = await import('../ai/providers/ollama.js');
      const known = new Set([...Object.values(OLLAMA_MODELS), ...await OllamaProvider.listCloudModels(env.ollamaApiKey)]);
      if (!known.has(model)) {
        return reply.status(400).send({ error: `Unknown Ollama model: ${model}` });
      }
    }
    const previousProvider = getProviderName();
    const previousModel = getOllamaModel();
    setProvider(provider, { model });
    // The provider is deployment-wide; the event is filed under the acting
    // operator's organization, which is the only tenant context available.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'settings.ai_provider_changed',
      entityId: 'ai_provider',
      metadata: {
        fromProvider: previousProvider,
        toProvider: getProviderName(),
        fromModel: previousModel,
        toModel: getOllamaModel(),
      },
    });
    return {
      provider: getProviderName(),
      ollamaModel: getOllamaModel(),
      message: `AI provider switched to ${provider}`,
    };
  });

  // List available Ollama cloud models (fetched live from ollama.com)
  fastify.get('/ai-provider/ollama-models', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const { default: OllamaProvider, OLLAMA_MODELS } = await import('../ai/providers/ollama.js');
    const models = await OllamaProvider.listCloudModels(env.ollamaApiKey);
    return { models, known: OLLAMA_MODELS };
  });

  // ==================== ESCALATION RULES ====================

  // Get escalation settings
  fastify.get('/escalation', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return {
      rules: [
        { name: 'First reminder', hoursWithoutResponse: 4, action: 'notify_assignee' },
        { name: 'Admin notification', hoursWithoutResponse: 8, action: 'notify_admin' },
        { name: 'Critical alert', hoursWithoutResponse: 24, action: 'critical_alert' }
      ],
      criticalAutoEscalate: true
    };
  });
}
