import aiClient from '../ai/client.js';
import { isAiControlError } from '../ai/errors.js';
import { decrypt } from '../utils/crypto.js';
import { aiGovernance } from '../ai/governance.js';
import { AI_BRIDGE_ACTION_TOOLS, ToolError } from '../ai/tools/registry.js';
import { IDEMPOTENCY_KEY_FORMAT, createToolExecutor } from '../ai/tools/executor.js';
import { postSlackMessage } from '../services/slack-outbound.service.js';
import { validateBody, aiBridgeActionConfirmSchema, aiBridgeActionPrepareSchema, aiBridgeChatSchema } from '../validators/schemas.js';
import { requireApiKeyScope } from '../auth/api-key-scopes.js';

// Scope checks run before body validation so a key without the scope learns
// nothing about the request shape.
const requireReadScope = requireApiKeyScope('ai_bridge:read');
const requireActionsScope = requireApiKeyScope('ai_bridge:actions');

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12000;

function actionResponse(action) {
  return {
    id: action.id, action: action.action, status: action.status, preview: action.preview,
    result: action.result ?? null, expiresAt: action.expiresAt, confirmedAt: action.confirmedAt ?? null,
    executedAt: action.executedAt ?? null, errorCode: action.errorCode ?? null,
  };
}

function toolContext(request) {
  return { prisma: request.prisma, user: request.user, requestId: request.id, ip: request.ip };
}

// Map executor refusals onto the bridge's established OpenAI-style errors.
function sendActionError(request, reply, error, action) {
  if (isAiControlError(error)) {
    return reply.status(error.statusCode).send({ error: { message: error.message, type: 'ai_control_error', code: error.code } });
  }
  if (!(error instanceof ToolError)) throw error;
  const withAction = error.action ? { action: actionResponse(error.action) } : {};
  switch (error.code) {
    case 'INVALID_INPUT':
    case 'INPUT_TOO_LARGE':
      return reply.status(400).send({ error: { message: `Invalid ${action} input`, type: 'invalid_request_error' } });
    case 'TOOL_UNKNOWN':
    case 'IDEMPOTENCY_KEY_REQUIRED':
      return reply.status(400).send({ error: { message: 'Invalid action request', type: 'invalid_request_error' } });
    case 'ROLE_DENIED':
    case 'APPROVER_NOT_ALLOWED':
      return reply.status(403).send({ error: { message: 'This API key is not authorized for workflow actions', type: 'insufficient_permissions' } });
    case 'IDEMPOTENCY_CONFLICT':
      return reply.status(409).send({ error: { message: error.message, type: 'idempotency_conflict' } });
    case 'RECORD_NOT_FOUND':
      return reply.status(404).send({ error: { message: error.message, type: 'not_found_error' } });
    case 'NOT_FOUND':
      return reply.status(404).send({ error: { message: 'Action not found', type: 'not_found_error' } });
    case 'TARGET_UNAVAILABLE':
    case 'ACTION_UNAVAILABLE':
      return reply.status(409).send({ error: { message: error.message, type: 'action_unavailable' }, ...withAction });
    case 'ACTION_EXPIRED':
      return reply.status(409).send({ error: { message: error.message, type: 'action_expired' }, ...withAction });
    case 'EXECUTION_FAILED':
      return reply.status(error.statusCode).send({ error: { message: error.message, type: 'action_failed' }, ...withAction });
    case 'AI_DISABLED':
      return reply.status(503).send({ error: { message: error.message, type: 'ai_control_error', code: 'AI_DISABLED' } });
    default:
      request.log.warn({ code: error.code }, 'AI bridge action refused');
      return reply.status(error.statusCode || 400).send({ error: { message: error.message, type: 'invalid_request_error' } });
  }
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
  const executor = options.toolExecutor ?? createToolExecutor({
    governance: options.governance ?? aiGovernance,
    deps: { decryptSecret, postSlackMessage: sendSlackMessage },
  });
  fastify.get('/capabilities', { onRequest: [fastify.authenticateWithApiKey] }, async (request) => ({
    name: 'Ashbi Agency Hub',
    version: '1',
    organizationId: request.user.organizationId || null,
    transport: 'OpenAI-compatible HTTP API',
    chatCompletions: '/api/ai-bridge/v1/chat/completions',
    authentication: 'x-api-key or Authorization: Bearer ashbi_…',
    grantedScopes: request.apiKeyScopes ?? [],
    capabilities: [
      { name: 'agency_context_chat', mode: 'read', scope: 'ai_bridge:read', description: 'Ask about the authenticated organization\'s projects, tasks, clients, threads, and retainers.' },
      { name: 'workflow_actions', mode: 'write', scope: 'ai_bridge:actions', description: 'Prepare and separately confirm allowlisted actions with idempotency and audit records.', actions: ['create_task', 'create_calendar_event', 'send_slack_message'] },
    ],
    safety: { tenantScoped: true, writesRequireConfirmation: true, credentialsNeverReturned: true },
  }));

  fastify.post('/v1/chat/completions', { onRequest: [fastify.authenticateWithApiKey], preHandler: [requireReadScope, validateBody(aiBridgeChatSchema)] }, async (request, reply) => {
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
      if (isAiControlError(error)) {
        // Kill switch, budget or BYOK provider failure (docs/ai-byok.md), in
        // the OpenAI error shape the bridge's clients expect.
        return reply.status(error.statusCode).send({ error: { message: error.message, type: 'ai_control_error', code: error.code } });
      }
      request.log.error({ err: error }, 'AI bridge completion failed');
      return reply.status(502).send({ error: { message: 'AI provider unavailable', type: 'upstream_error' } });
    }
  });

  // Workflow actions are governed AI tools (src/ai/tools, docs/ai-tool-registry.md):
  // prepare creates a pending action, confirm is the requester's approval.
  fastify.post('/v1/actions/prepare', { onRequest: [fastify.authenticateWithApiKey], preHandler: [requireActionsScope, validateBody(aiBridgeActionPrepareSchema)] }, async (request, reply) => {
    if (!requireActionRole(request, reply)) return;
    const { action, input, idempotencyKey } = request.body ?? {};
    if (!AI_BRIDGE_ACTION_TOOLS.includes(action) || typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_FORMAT.test(idempotencyKey)) {
      return reply.status(400).send({ error: { message: 'Invalid action request', type: 'invalid_request_error' } });
    }
    try {
      const prepared = await executor.invoke(toolContext(request), { tool: action, input, idempotencyKey, source: 'ai_bridge' });
      if (prepared.idempotent) return { action: actionResponse(prepared.action), idempotent: true };
      return reply.status(201).send({ action: actionResponse(prepared.action), confirmationRequired: true });
    } catch (error) {
      return sendActionError(request, reply, error, action);
    }
  });

  fastify.post('/v1/actions/:actionId/confirm', { onRequest: [fastify.authenticateWithApiKey], preHandler: [requireActionsScope, validateBody(aiBridgeActionConfirmSchema)] }, async (request, reply) => {
    if (!requireActionRole(request, reply)) return;
    if (request.body?.confirm !== true) return reply.status(400).send({ error: { message: 'Set confirm to true to execute this action', type: 'confirmation_required' } });
    try {
      // The API key's owner confirms their own action: the bridge contract.
      const { action, idempotent } = await executor.approve(toolContext(request), request.params.actionId, { method: 'api_key_confirm', ownerOnly: true });
      return { action: actionResponse(action), idempotent };
    } catch (error) {
      return sendActionError(request, reply, error);
    }
  });
}
