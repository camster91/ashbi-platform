import aiClient from '../ai/client.js';
import crypto from 'node:crypto';
import { decrypt } from '../utils/crypto.js';
import { postSlackMessage } from '../services/slack-outbound.service.js';
import { validateBody, aiBridgeActionConfirmSchema, aiBridgeActionPrepareSchema, aiBridgeChatSchema } from '../validators/schemas.js';

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

function slackMessageInput(value) {
  if (!value || typeof value !== 'object' || typeof value.projectId !== 'string' || typeof value.text !== 'string') return null;
  const text = value.text.trim();
  if (!text || text.length > 4000) return null;
  if (value.threadMessageId !== undefined && (typeof value.threadMessageId !== 'string' || !value.threadMessageId.trim() || value.threadMessageId.length > 50)) return null;
  return { projectId: value.projectId, text, ...(value.threadMessageId ? { threadMessageId: value.threadMessageId } : {}) };
}

function calendarEventInput(value) {
  if (!value || typeof value !== 'object' || typeof value.projectId !== 'string' || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  const startTime = typeof value.startTime === 'string' ? new Date(value.startTime) : null;
  const endTime = typeof value.endTime === 'string' ? new Date(value.endTime) : null;
  if (!title || title.length > 500 || !startTime || Number.isNaN(startTime.getTime()) || !endTime || Number.isNaN(endTime.getTime()) || endTime <= startTime) return null;
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 10000)) return null;
  if (value.location !== undefined && (typeof value.location !== 'string' || value.location.trim().length > 500)) return null;
  if (value.type !== undefined && !['MEETING', 'DEADLINE', 'REMINDER', 'MILESTONE'].includes(value.type)) return null;
  return { projectId: value.projectId, title, description: value.description, startTime: startTime.toISOString(), endTime: endTime.toISOString(), type: value.type ?? 'MEETING', location: value.location?.trim() || undefined };
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

export default async function aiBridgeRoutes(fastify, options = {}) {
  const decryptSecret = options.decryptSecret ?? decrypt;
  const sendSlackMessage = options.postSlackMessage ?? postSlackMessage;
  const chatClient = options.chatClient ?? aiClient;
  fastify.get('/capabilities', { onRequest: [fastify.authenticateWithApiKey] }, async (request) => ({
    name: 'Ashbi Agency Hub',
    version: '1',
    organizationId: request.user.organizationId || null,
    transport: 'OpenAI-compatible HTTP API',
    chatCompletions: '/api/ai-bridge/v1/chat/completions',
    authentication: 'x-api-key or Authorization: Bearer ashbi_…',
    capabilities: [
      { name: 'agency_context_chat', mode: 'read', description: 'Ask about the authenticated organization\'s projects, tasks, clients, threads, and retainers.' },
      { name: 'workflow_actions', mode: 'write', description: 'Prepare and separately confirm allowlisted actions with idempotency and audit records.', actions: ['create_task', 'create_calendar_event', 'send_slack_message'] },
    ],
    safety: { tenantScoped: true, writesRequireConfirmation: true, credentialsNeverReturned: true },
  }));

  fastify.post('/v1/chat/completions', { onRequest: [fastify.authenticateWithApiKey], preHandler: validateBody(aiBridgeChatSchema) }, async (request, reply) => {
    const body = request.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES) : [];
    if (!messages.length || !messages.some(message => message.role === 'user')) {
      return reply.status(400).send({ error: { message: 'messages must include at least one user message', type: 'invalid_request_error' } });
    }

    const [projects, tasks, clients, conversationMessages, retainers] = await Promise.all([
      request.prisma.project.findMany({ select: { id: true, name: true, status: true, health: true }, take: 25, orderBy: { updatedAt: 'desc' } }),
      request.prisma.task.findMany({ where: { status: { not: 'COMPLETED' } }, select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { name: true } } }, take: 50, orderBy: { updatedAt: 'desc' } }),
      request.prisma.client.findMany({ select: { id: true, name: true, status: true, domain: true }, take: 50, orderBy: { updatedAt: 'desc' } }),
      request.prisma.chatMessage.findMany({
        select: { id: true, content: true, type: true, externalSource: true, externalAuthorName: true, createdAt: true, project: { select: { name: true } }, author: { select: { name: true } } },
        take: 30, orderBy: { createdAt: 'desc' },
      }),
      request.prisma.retainerPlan.findMany({
        select: { id: true, tier: true, hoursPerMonth: true, hoursUsed: true, currency: true, retainerStatus: true, nextBillingDate: true, client: { select: { name: true } } },
        take: 50, orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const recentConversations = conversationMessages.map((message) => ({
      id: message.id, content: message.content.slice(0, 2_000), type: message.type,
      source: message.externalSource ?? 'ASHBI', author: message.author?.name ?? message.externalAuthorName ?? 'Unknown',
      createdAt: message.createdAt, project: message.project.name,
    }));
    const retainerContext = retainers.map((retainer) => ({
      id: retainer.id, client: retainer.client.name, tier: retainer.tier, hoursPerMonth: retainer.hoursPerMonth,
      hoursUsed: retainer.hoursUsed, currency: retainer.currency, status: retainer.retainerStatus, nextBillingDate: retainer.nextBillingDate,
    }));
    const system = `You are Ashbi's agency operations assistant. You may discuss only the authenticated organization's data. Never invent records, expose credentials, or claim a write occurred. Writes are not available through this endpoint yet; direct the user to confirm in Ashbi.\n\nOrganization context:\n${JSON.stringify({ projects, tasks, clients, recentConversations, retainers: retainerContext })}`;
    const prompt = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');

    try {
      const result = await chatClient.chat({ system, prompt, temperature: 0.2, maxTokens: 1200 });
      const content = typeof result === 'string' ? result : result?.content || result?.text || JSON.stringify(result);
      return openAiResponse(content, body.model);
    } catch (error) {
      request.log.error({ err: error }, 'AI bridge completion failed');
      return reply.status(502).send({ error: { message: 'AI provider unavailable', type: 'upstream_error' } });
    }
  });

  fastify.post('/v1/actions/prepare', { onRequest: [fastify.authenticateWithApiKey], preHandler: validateBody(aiBridgeActionPrepareSchema) }, async (request, reply) => {
    if (!requireActionRole(request, reply)) return;
    const { action, input, idempotencyKey } = request.body ?? {};
    if (!['create_task', 'create_calendar_event', 'send_slack_message'].includes(action) || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return reply.status(400).send({ error: { message: 'Invalid action request', type: 'invalid_request_error' } });
    }
    const normalizedInput = action === 'create_task' ? taskInput(input) : action === 'create_calendar_event' ? calendarEventInput(input) : slackMessageInput(input);
    if (!normalizedInput) return reply.status(400).send({ error: { message: `Invalid ${action} input`, type: 'invalid_request_error' } });
    const hash = inputHash({ action, input: normalizedInput });
    const existing = await request.prisma.aiBridgeAction.findFirst({ where: { userId: request.user.id, idempotencyKey } });
    if (existing) {
      if (existing.action !== action || existing.inputHash !== hash) return reply.status(409).send({ error: { message: 'Idempotency key was already used for another action', type: 'idempotency_conflict' } });
      return { action: actionResponse(existing), idempotent: true };
    }
    const project = await request.prisma.project.findFirst({ where: { id: normalizedInput.projectId }, select: { id: true, name: true } });
    if (!project) return reply.status(404).send({ error: { message: 'Project not found', type: 'not_found_error' } });
    let preview = action === 'create_task'
      ? { kind: 'create_task', project: { id: project.id, name: project.name }, title: normalizedInput.title, priority: normalizedInput.priority, dueDate: normalizedInput.dueDate ?? null }
      : { kind: 'create_calendar_event', project: { id: project.id, name: project.name }, title: normalizedInput.title, startTime: normalizedInput.startTime, endTime: normalizedInput.endTime, type: normalizedInput.type };
    if (action === 'send_slack_message') {
      const mapping = await request.prisma.slackChannelMapping.findFirst({
        where: { projectId: project.id, outboundEnabled: true, installation: { status: 'ACTIVE' } },
        select: { id: true, channelId: true, channelName: true },
      });
      if (!mapping) return reply.status(409).send({ error: { message: 'No active outbound Slack channel is mapped to this project', type: 'action_unavailable' } });
      let replyTo = null;
      if (normalizedInput.threadMessageId) {
        const root = await request.prisma.chatMessage.findFirst({
          where: { id: normalizedInput.threadMessageId, projectId: project.id, externalSource: 'SLACK', parentId: null },
          select: { id: true, externalThreadId: true },
        });
        if (!root?.externalThreadId) return reply.status(409).send({ error: { message: 'Slack thread is unavailable for this project', type: 'action_unavailable' } });
        replyTo = { messageId: root.id };
      }
      preview = { kind: 'send_slack_message', project: { id: project.id, name: project.name }, mapping: { id: mapping.id, channelId: mapping.channelId, name: mapping.channelName ?? mapping.channelId }, text: normalizedInput.text, ...(replyTo ? { replyTo } : {}) };
    }
    const actionRecord = await request.prisma.aiBridgeAction.create({
      data: {
        organizationId: request.user.organizationId, userId: request.user.id, action, idempotencyKey, input: normalizedInput, inputHash: hash,
        preview,
        status: 'PENDING_CONFIRMATION', expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      },
    });
    return reply.status(201).send({ action: actionResponse(actionRecord), confirmationRequired: true });
  });

  fastify.post('/v1/actions/:actionId/confirm', { onRequest: [fastify.authenticateWithApiKey], preHandler: validateBody(aiBridgeActionConfirmSchema) }, async (request, reply) => {
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
    let attemptedSlackDelivery;
    try {
      if (initial.action === 'send_slack_message') {
        const mapping = await request.prisma.$transaction(async (transaction) => {
          const claimed = await transaction.aiBridgeAction.updateMany({
            where: { id: initial.id, userId: request.user.id, status: 'PENDING_CONFIRMATION' },
            data: { status: 'EXECUTING', confirmedAt: new Date() },
          });
          if (claimed.count !== 1) return null;
          const input = slackMessageInput(initial.input);
          if (!input) throw new Error('ACTION_TARGET_UNAVAILABLE');
          const found = await transaction.slackChannelMapping.findFirst({
            where: { projectId: input.projectId, outboundEnabled: true, installation: { status: 'ACTIVE' } },
            select: { id: true, channelId: true, installation: { select: { botTokenEncrypted: true } } },
          });
          if (!found?.installation?.botTokenEncrypted) throw new Error('ACTION_TARGET_UNAVAILABLE');
          let threadTs = null;
          if (input.threadMessageId) {
            const root = await transaction.chatMessage.findFirst({
              where: { id: input.threadMessageId, projectId: input.projectId, externalSource: 'SLACK', parentId: null },
              select: { id: true, externalThreadId: true },
            });
            if (!root?.externalThreadId) throw new Error('ACTION_TARGET_UNAVAILABLE');
            threadTs = root.externalThreadId;
          }
          return { ...found, text: input.text, threadTs, threadMessageId: input.threadMessageId ?? null };
        });
        if (!mapping) {
          const current = await request.prisma.aiBridgeAction.findFirst({ where: { id: initial.id, userId: request.user.id } });
          return reply.status(409).send({ error: { message: 'Action is already being processed', type: 'action_unavailable' }, action: actionResponse(current) });
        }
        attemptedSlackDelivery = { deliveryState: 'UNKNOWN', mappingId: mapping.id, channelId: mapping.channelId, ...(mapping.threadMessageId ? { threadMessageId: mapping.threadMessageId } : {}) };
        const slackInput = { botToken: decryptSecret(mapping.installation.botTokenEncrypted), channelId: mapping.channelId, text: mapping.text };
        if (mapping.threadTs) slackInput.threadTs = mapping.threadTs;
        const posted = await sendSlackMessage(slackInput);
        completed = await request.prisma.aiBridgeAction.update({
          where: { id: initial.id }, data: { status: 'EXECUTED', executedAt: new Date(), result: { mappingId: mapping.id, ...posted, ...(mapping.threadMessageId ? { threadMessageId: mapping.threadMessageId } : {}) } },
        });
      } else if (initial.action === 'create_calendar_event') {
        completed = await request.prisma.$transaction(async (transaction) => {
          const claimed = await transaction.aiBridgeAction.updateMany({
            where: { id: initial.id, userId: request.user.id, status: 'PENDING_CONFIRMATION' },
            data: { status: 'EXECUTING', confirmedAt: new Date() },
          });
          if (claimed.count !== 1) return transaction.aiBridgeAction.findFirst({ where: { id: initial.id, userId: request.user.id } });
          const input = calendarEventInput(initial.input);
          const project = input && await transaction.project.findFirst({ where: { id: input.projectId }, select: { id: true } });
          if (!input || !project) throw new Error('ACTION_TARGET_UNAVAILABLE');
          const event = await transaction.calendarEvent.create({
            data: { title: input.title, description: input.description, startTime: new Date(input.startTime), endTime: new Date(input.endTime), type: input.type, location: input.location, projectId: project.id, createdById: request.user.id, googleSyncStatus: 'NOT_CONNECTED' },
          });
          return transaction.aiBridgeAction.update({
            where: { id: initial.id }, data: { status: 'EXECUTED', executedAt: new Date(), result: { eventId: event.id, projectId: project.id } },
          });
        });
      } else {
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
      }
    } catch (error) {
      const errorCode = error?.message === 'ACTION_TARGET_UNAVAILABLE' ? 'ACTION_TARGET_UNAVAILABLE' : 'ACTION_EXECUTION_FAILED';
      const failed = await request.prisma.aiBridgeAction.update({
        where: { id: initial.id },
        data: { status: 'FAILED', errorCode, ...(attemptedSlackDelivery ? { result: attemptedSlackDelivery } : {}) },
      });
      return reply.status(errorCode === 'ACTION_TARGET_UNAVAILABLE' ? 409 : 502).send({
        error: { message: errorCode === 'ACTION_TARGET_UNAVAILABLE' ? 'Action target is unavailable' : 'Action execution failed', type: 'action_failed' },
        action: actionResponse(failed),
      });
    }
    return { action: actionResponse(completed), idempotent: completed.status === 'EXECUTED' && initial.status === 'EXECUTED' };
  });
}
