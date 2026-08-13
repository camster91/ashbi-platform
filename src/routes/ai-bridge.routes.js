import aiClient from '../ai/client.js';
import crypto from 'node:crypto';
import { validateBody, aiBridgeChatSchema } from '../validators/schemas.js';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12000;
const ACTION_TTL_MS = 10 * 60 * 1000;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function inputHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function actionResponse(action) {
  return {
    id: action.id, action: action.action, status: action.status, preview: action.preview,
    result: action.result ?? null, expiresAt: action.expiresAt, confirmedAt: action.confirmedAt ?? null,
    executedAt: action.executedAt ?? null, errorCode: action.errorCode ?? null,
  };
}

function taskInput(value) {
  if (!value || typeof value !== 'object' || typeof value.projectId !== 'string' || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  if (!title || title.length > 500 || (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 10000))) return null;
  if (value.priority !== undefined && !['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].includes(value.priority)) return null;
  if (value.dueDate !== undefined && (typeof value.dueDate !== 'string' || Number.isNaN(Date.parse(value.dueDate)))) return null;
  return { projectId: value.projectId, title, description: value.description, priority: value.priority ?? 'NORMAL', dueDate: value.dueDate };
}

function requireActionRole(request, reply) {
  if (!['ADMIN', 'TEAM'].includes(request.user?.role)) {
    reply.status(403).send({ error: { message: 'This API key is not authorized for workflow actions', type: 'insufficient_permissions' } });
    return false;
  }
  return true;
}

function normalizeMessage(message) {
  if (!message || !['system', 'user', 'assistant'].includes(message.role)) return null;
  const content = typeof message.content === 'string' ? message.content : '';
  return content.trim() ? { role: message.role, content: content.slice(0, MAX_MESSAGE_CHARS) } : null;
}

function openAiResponse(content, model) {
  return {
    id: `chatcmpl-ashbi-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'ashbi',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

export default async function aiBridgeRoutes(fastify) {
  fastify.get('/capabilities', { onRequest: [fastify.authenticateWithApiKey] }, async (request) => ({
    name: 'Ashbi Agency Hub',
    version: '1',
    organizationId: request.user.organizationId || null,
    transport: 'OpenAI-compatible HTTP API',
    chatCompletions: '/api/ai-bridge/v1/chat/completions',
    authentication: 'x-api-key or Authorization: Bearer ashbi_…',
    capabilities: [
      { name: 'agency_context_chat', mode: 'read', description: 'Ask about the authenticated organization\'s projects, tasks, clients, threads, and retainers.' },
      { name: 'workflow_actions', mode: 'write', description: 'Prepare and separately confirm allowlisted actions with idempotency and audit records.', actions: ['create_task'] },
    ],
    safety: { tenantScoped: true, writesRequireConfirmation: true, credentialsNeverReturned: true },
  }));

  fastify.post('/v1/chat/completions', { onRequest: [fastify.authenticateWithApiKey], preHandler: validateBody(aiBridgeChatSchema) }, async (request, reply) => {
    const body = request.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES) : [];
    if (!messages.length || !messages.some(message => message.role === 'user')) {
      return reply.status(400).send({ error: { message: 'messages must include at least one user message', type: 'invalid_request_error' } });
    }

    const [projects, tasks, clients] = await Promise.all([
      request.prisma.project.findMany({ select: { id: true, name: true, status: true, health: true }, take: 25, orderBy: { updatedAt: 'desc' } }),
      request.prisma.task.findMany({ where: { status: { not: 'COMPLETED' } }, select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { name: true } } }, take: 50, orderBy: { updatedAt: 'desc' } }),
      request.prisma.client.findMany({ select: { id: true, name: true, status: true, domain: true }, take: 50, orderBy: { updatedAt: 'desc' } }),
    ]);
    const system = `You are Ashbi's agency operations assistant. You may discuss only the authenticated organization's data. Never invent records, expose credentials, or claim a write occurred. Writes are not available through this endpoint yet; direct the user to confirm in Ashbi.\n\nOrganization context:\n${JSON.stringify({ projects, tasks, clients })}`;
    const prompt = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');

    try {
      const result = await aiClient.chat({ system, prompt, temperature: 0.2, maxTokens: 1200 });
      const content = typeof result === 'string' ? result : result?.content || result?.text || JSON.stringify(result);
      return openAiResponse(content, body.model);
    } catch (error) {
      request.log.error({ err: error }, 'AI bridge completion failed');
      return reply.status(502).send({ error: { message: 'AI provider unavailable', type: 'upstream_error' } });
    }
  });

  fastify.post('/v1/actions/prepare', { onRequest: [fastify.authenticateWithApiKey] }, async (request, reply) => {
    if (!requireActionRole(request, reply)) return;
    const { action, input, idempotencyKey } = request.body ?? {};
    if (action !== 'create_task' || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return reply.status(400).send({ error: { message: 'Invalid action request', type: 'invalid_request_error' } });
    }
    const normalizedInput = taskInput(input);
    if (!normalizedInput) return reply.status(400).send({ error: { message: 'Invalid create_task input', type: 'invalid_request_error' } });
    const hash = inputHash({ action, input: normalizedInput });
    const existing = await request.prisma.aiBridgeAction.findFirst({ where: { userId: request.user.id, idempotencyKey } });
    if (existing) {
      if (existing.action !== action || existing.inputHash !== hash) return reply.status(409).send({ error: { message: 'Idempotency key was already used for another action', type: 'idempotency_conflict' } });
      return { action: actionResponse(existing), idempotent: true };
    }
    const project = await request.prisma.project.findFirst({ where: { id: normalizedInput.projectId }, select: { id: true, name: true } });
    if (!project) return reply.status(404).send({ error: { message: 'Project not found', type: 'not_found_error' } });
    const actionRecord = await request.prisma.aiBridgeAction.create({
      data: {
        organizationId: request.user.organizationId, userId: request.user.id, action, idempotencyKey, input: normalizedInput, inputHash: hash,
        preview: { kind: 'create_task', project: { id: project.id, name: project.name }, title: normalizedInput.title, priority: normalizedInput.priority, dueDate: normalizedInput.dueDate ?? null },
        status: 'PENDING_CONFIRMATION', expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      },
    });
    return reply.status(201).send({ action: actionResponse(actionRecord), confirmationRequired: true });
  });

  fastify.post('/v1/actions/:actionId/confirm', { onRequest: [fastify.authenticateWithApiKey] }, async (request, reply) => {
    if (!requireActionRole(request, reply)) return;
    if (request.body?.confirm !== true) return reply.status(400).send({ error: { message: 'Set confirm to true to execute this action', type: 'confirmation_required' } });
    const actionId = request.params.actionId;
    const initial = await request.prisma.aiBridgeAction.findFirst({ where: { id: actionId, userId: request.user.id } });
    if (!initial) return reply.status(404).send({ error: { message: 'Action not found', type: 'not_found_error' } });
    if (initial.status === 'EXECUTED') return { action: actionResponse(initial), idempotent: true };
    if (initial.status !== 'PENDING_CONFIRMATION') return reply.status(409).send({ error: { message: `Action is ${initial.status.toLowerCase()}`, type: 'action_unavailable' } });
    if (new Date(initial.expiresAt) <= new Date()) {
      const expired = await request.prisma.aiBridgeAction.update({ where: { id: initial.id }, data: { status: 'EXPIRED' } });
      return reply.status(409).send({ error: { message: 'Action confirmation expired', type: 'action_expired' }, action: actionResponse(expired) });
    }
    let completed;
    try {
      completed = await request.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.aiBridgeAction.updateMany({
          where: { id: initial.id, userId: request.user.id, status: 'PENDING_CONFIRMATION' },
          data: { status: 'EXECUTING', confirmedAt: new Date() },
        });
        if (claimed.count !== 1) return transaction.aiBridgeAction.findFirst({ where: { id: initial.id, userId: request.user.id } });
        const input = taskInput(initial.input);
        const project = input && await transaction.project.findFirst({ where: { id: input.projectId }, select: { id: true } });
        if (!input || !project) throw new Error('ACTION_TARGET_UNAVAILABLE');
        const task = await transaction.task.create({
          data: { title: input.title, description: input.description, priority: input.priority, dueDate: input.dueDate ? new Date(input.dueDate) : null, projectId: project.id },
        });
        return transaction.aiBridgeAction.update({
          where: { id: initial.id }, data: { status: 'EXECUTED', executedAt: new Date(), result: { taskId: task.id, projectId: project.id } },
        });
      });
    } catch (error) {
      const errorCode = error?.message === 'ACTION_TARGET_UNAVAILABLE' ? 'ACTION_TARGET_UNAVAILABLE' : 'ACTION_EXECUTION_FAILED';
      const failed = await request.prisma.aiBridgeAction.update({ where: { id: initial.id }, data: { status: 'FAILED', errorCode } });
      return reply.status(errorCode === 'ACTION_TARGET_UNAVAILABLE' ? 409 : 502).send({
        error: { message: errorCode === 'ACTION_TARGET_UNAVAILABLE' ? 'Action target is unavailable' : 'Action execution failed', type: 'action_failed' },
        action: actionResponse(failed),
      });
    }
    return { action: actionResponse(completed), idempotent: completed.status === 'EXECUTED' && initial.status === 'EXECUTED' };
  });
}
