// Settings routes (assignment rules, templates, configuration)

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';

export default async function settingsRoutes(fastify) {
  // ==================== ASSIGNMENT RULES ====================

  // List all assignment rules
  fastify.get('/assignment-rules', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const rules = await prisma.assignmentRule.findMany({
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
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { name, type, conditions, assignToId, priority = 0, isActive = true } = request.body;

    const rule = await prisma.assignmentRule.create({
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
    onRequest: [fastify.adminOnly]
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

    const rule = await prisma.assignmentRule.update({
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

    await prisma.assignmentRule.delete({
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

    const templates = await prisma.template.findMany({
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

    const template = await prisma.template.findUnique({
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
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { name, category, subject, body, variables = [], isActive = true } = request.body;

    const template = await prisma.template.create({
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
    onRequest: [fastify.adminOnly]
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

    const template = await prisma.template.update({
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

    await prisma.template.delete({
      where: { id }
    });

    return { success: true };
  });

  // Render template with variables
  fastify.post('/templates/:id/render', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { variables = {} } = request.body;

    const template = await prisma.template.findUnique({
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
  }, async () => {
    const { getProviderName } = await import('../ai/providers/index.js');
    const { OLLAMA_MODELS } = await import('../ai/providers/ollama.js');
    const env = (await import('../config/env.js')).default;
    return {
      provider: getProviderName(),
      available: ['claude', 'gemini', 'ollama'],
      ollamaModel: env.ollamaModel,
      ollamaModels: OLLAMA_MODELS,
    };
  });

  // Switch AI provider at runtime (admin only)
  fastify.post('/ai-provider', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { provider, model } = request.body;
    if (!provider || !['claude', 'gemini', 'ollama'].includes(provider)) {
      return reply.status(400).send({ error: 'Invalid provider. Use "claude", "gemini", or "ollama".' });
    }
    const { setProvider, getProviderName } = await import('../ai/providers/index.js');
    setProvider(provider);
    // Allow overriding the Ollama model at runtime
    if (provider === 'ollama' && model) {
      process.env.OLLAMA_MODEL = model;
    }
    return { provider: getProviderName(), message: `AI provider switched to ${provider}` };
  });

  // List available Ollama cloud models (fetched live from ollama.com)
  fastify.get('/ai-provider/ollama-models', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const { default: OllamaProvider, OLLAMA_MODELS } = await import('../ai/providers/ollama.js');
    const env = (await import('../config/env.js')).default;
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
