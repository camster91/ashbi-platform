// AI tool approval queue and execution receipts (#413 slice 2,
// docs/ai-tool-registry.md).
//
// Staff only. An ADMIN sees and decides every action in the organization; a
// TEAM member sees and decides only the actions they requested (and only
// approves them when the tool lets the requester approve). Approving or
// rejecting requires step-up re-authentication (docs/privileged-actions.md):
// every action in the queue is a prepare or execute tool.
//
// `POST /sessions` runs one assistant tool session (src/ai/tools/session.js)
// for the signed-in staff member. Every model turn is a governed AI call
// (kill switches, the organization's BYOK connection and budget, usage
// records, feature `ai_tools`); every tool call goes through the executor, so
// changes only ever become pending actions in the queue above.

import crypto from 'node:crypto';
import { requireRecentAuth } from '../auth/reauth.js';
import { AiProviderError, isAiControlError, sendAiError } from '../ai/errors.js';
import { aiGovernance } from '../ai/governance.js';
import { ToolError, describeTool, toolRegistry } from '../ai/tools/registry.js';
import { PENDING_STATUS, createToolExecutor, redactSecrets } from '../ai/tools/executor.js';
import { runToolSession } from '../ai/tools/session.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { requestStorage } from '../utils/request-context.js';
import { decrypt } from '../utils/crypto.js';
import { postSlackMessage } from '../services/slack-outbound.service.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  aiToolActionParamsSchema,
  aiToolApprovalListQuerySchema,
  aiToolApproveSchema,
  aiToolReceiptQuerySchema,
  aiToolRejectSchema,
  aiToolSessionSchema,
} from '../validators/schemas.js';

const STAFF_ROLES = ['ADMIN', 'TEAM'];

/**
 * Assistant sessions each staff member may start. Proposal
 * (docs/ai-tool-registry.md): a session is up to six metered model calls, so
 * this bounds one person to 60 model calls a minute on top of the per-IP API
 * limit and the organization's BYOK budget.
 */
export const AI_SESSION_RATE_LIMIT = Object.freeze({ max: 10, timeWindow: '1 minute' });

/**
 * preHandler enforcing AI_SESSION_RATE_LIMIT per user with
 * @fastify/rate-limit's `createRateLimit` (registered app-wide in
 * src/index.js). Fails closed at start-up if the limiter is missing.
 * @param {import('fastify').FastifyInstance} fastify
 */
function sessionRateLimiter(fastify) {
  if (typeof fastify.createRateLimit !== 'function') {
    throw new Error('the assistant session route requires @fastify/rate-limit to be registered first');
  }
  const check = fastify.createRateLimit({
    ...AI_SESSION_RATE_LIMIT,
    keyGenerator: (request) => `ai-session:${request.user?.id ?? 'anonymous'}`,
  });
  return async function aiSessionRateLimit(request, reply) {
    const limit = await check(request);
    if (!limit.isAllowed && limit.isExceeded) {
      reply.header('Retry-After', String(limit.ttlInSeconds));
      return reply.status(429).send({ error: 'Too many assistant requests. Try again in a minute.', code: 'AI_SESSION_RATE_LIMITED' });
    }
    return undefined;
  };
}

/**
 * One session step as the API shows it: the tool, what happened, the pending
 * action to approve, and read output (tenant-scoped and secret-redacted by
 * the executor). Never the model's raw arguments.
 */
export function sessionStepView(step) {
  return {
    turn: step.turn,
    tool: step.tool ?? null,
    status: step.status,
    reason: step.reason ?? null,
    actionId: step.actionId ?? null,
    output: step.status === 'ok' ? (step.output ?? null) : null,
  };
}

async function requireStaffRole(request, reply) {
  if (!STAFF_ROLES.includes(request.user?.role)) {
    return reply.status(403).send({ error: 'Staff access required', code: 'FORBIDDEN' });
  }
  return undefined;
}

/** The receipt as the API shows it: no raw input, no secrets. */
export function receiptView(row, at = new Date()) {
  const tool = toolRegistry.get(row.action);
  return {
    id: row.id,
    tool: row.action,
    // The web app asks for an extra confirmation before approving these.
    external: Boolean(tool?.external),
    irreversible: Boolean(tool?.irreversible),
    toolClass: row.toolClass ?? 'execute',
    source: row.source ?? 'ai_bridge',
    status: row.status,
    outcome: row.outcome ?? null,
    requesterId: row.userId,
    requesterName: row.user?.name ?? null,
    approverId: row.approverId ?? null,
    approvalEvidence: row.approvalEvidence ?? null,
    preview: row.preview,
    inputScope: row.inputScope ?? null,
    inputHash: row.inputHash,
    result: redactSecrets(row.result ?? null),
    errorCode: row.errorCode ?? null,
    correlationId: row.correlationId ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    expired: row.status === PENDING_STATUS && new Date(row.expiresAt) <= at,
    confirmedAt: row.confirmedAt ?? null,
    executedAt: row.executedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
  };
}

function sendToolError(reply, error) {
  if (isAiControlError(error)) return sendAiError(reply, error);
  if (!(error instanceof ToolError)) throw error;
  return reply.status(error.statusCode).send({
    error: error.message,
    code: error.code,
    ...(error.action ? { action: receiptView(error.action) } : {}),
  });
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{
 *   toolExecutor?: ReturnType<typeof createToolExecutor>,
 *   governance?: { resolve: (organizationId: string) => Promise<any>, chat: (options: any) => Promise<string> },
 *   now?: () => Date,
 * }} [options]
 */
export default async function aiToolRoutes(fastify, options = {}) {
  const executor = options.toolExecutor ?? createToolExecutor({ deps: { decryptSecret: decrypt, postSlackMessage } });
  const governance = options.governance ?? aiGovernance;
  const now = options.now ?? (() => new Date());
  const sessionRateLimit = sessionRateLimiter(fastify);
  const visibleTo = (request) => (request.user.role === 'ADMIN' ? {} : { userId: request.user.id });
  const context = (request) => ({ prisma: request.prisma, user: request.user, requestId: request.id, ip: request.ip });
  const withRequester = { user: { select: { name: true } } };

  // The closed tool catalogue (docs/ai-tool-registry.md).
  fastify.get('/catalog', { onRequest: [fastify.authenticate], preHandler: [requireStaffRole] }, async () => ({
    tools: toolRegistry.list().map(describeTool),
  }));

  fastify.get('/approvals', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, validateQuery(aiToolApprovalListQuerySchema)],
  }, async (request) => {
    const rows = await request.prisma.aiBridgeAction.findMany({
      where: { status: PENDING_STATUS, ...visibleTo(request) },
      include: withRequester,
      orderBy: { createdAt: 'desc' },
      take: request.query.limit,
    });
    const at = now();
    return { approvals: rows.map((row) => receiptView(row, at)) };
  });

  fastify.get('/approvals/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, validateParams(aiToolActionParamsSchema)],
  }, async (request, reply) => {
    const row = await request.prisma.aiBridgeAction.findFirst({
      where: { id: request.params.id, ...visibleTo(request) },
      include: withRequester,
    });
    if (!row) return reply.status(404).send({ error: 'Action not found', code: 'NOT_FOUND' });
    return { action: receiptView(row, now()) };
  });

  fastify.post('/approvals/:id/approve', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, requireRecentAuth, validateParams(aiToolActionParamsSchema), validateBody(aiToolApproveSchema)],
  }, async (request, reply) => {
    try {
      const { action, idempotent } = await executor.approve(context(request), request.params.id, {
        method: 'session_step_up', reauthenticated: true,
      });
      return { action: receiptView(action, now()), idempotent };
    } catch (error) {
      return sendToolError(reply, error);
    }
  });

  fastify.post('/approvals/:id/reject', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, requireRecentAuth, validateParams(aiToolActionParamsSchema), validateBody(aiToolRejectSchema)],
  }, async (request, reply) => {
    try {
      const { action } = await executor.reject(context(request), request.params.id, {
        reason: request.body?.reason ?? 'other', reauthenticated: true,
      });
      return { action: receiptView(action, now()) };
    } catch (error) {
      return sendToolError(reply, error);
    }
  });

  // Receipts: every action that left the queue, newest first.
  fastify.get('/receipts', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, validateQuery(aiToolReceiptQuerySchema)],
  }, async (request) => {
    const { status, outcome, tool, source, requesterId, before, limit } = request.query;
    const own = visibleTo(request);
    const rows = await request.prisma.aiBridgeAction.findMany({
      where: {
        status: status ?? { not: PENDING_STATUS },
        ...(outcome ? { outcome } : {}),
        ...(tool ? { action: tool } : {}),
        ...(source ? { source } : {}),
        ...(requesterId ? { userId: requesterId } : {}),
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        ...own,
      },
      include: withRequester,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const at = now();
    const receipts = rows.map((row) => receiptView(row, at));
    return { receipts, nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt : null };
  });

  /**
   * The session's model call: the same governed path as every other AI
   * feature. The request context is pinned to the caller's organization so
   * the kill switches, BYOK connection and budget that apply are always the
   * caller's, even if the ambient context were lost.
   */
  const governedChat = (request) => async (callOptions) => {
    const store = {
      ...(requestStorage.getStore() ?? {}),
      prisma: request.prisma,
      organizationId: request.user.organizationId,
      requestId: request.id,
      feature: 'ai_tools',
    };
    try {
      return await requestStorage.run(store, () => governance.chat({ ...callOptions, feature: 'ai_tools' }));
    } catch (error) {
      if (isAiControlError(error)) throw error;
      // A platform provider failure: never log the error object or message,
      // which can echo a key or the prompt back.
      request.log.warn({ errorName: error?.name }, 'Assistant session model call failed');
      throw new AiProviderError('upstream');
    }
  };

  // Run one assistant tool session (docs/ai-tool-registry.md#assistant-sessions).
  fastify.post('/sessions', {
    onRequest: [fastify.authenticate],
    preHandler: [requireStaffRole, sessionRateLimit, validateBody(aiToolSessionSchema)],
  }, async (request, reply) => {
    // Kill switches and a disabled connection answer with the usual AI error
    // codes before anything runs.
    try {
      await governance.resolve(request.user.organizationId);
    } catch (error) {
      if (isAiControlError(error)) return sendAiError(reply, error);
      throw error;
    }

    const sessionId = crypto.randomUUID();
    const result = await runToolSession({
      executor, ctx: context(request), chat: governedChat(request), prompt: request.body.prompt, sessionId,
    });
    const steps = result.steps.map(sessionStepView);
    const count = (status) => steps.filter((step) => step.status === status).length;
    // Ids and counts only: never the prompt, the answer or tool output.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'ai.tool_session_run',
      entityId: sessionId,
      metadata: {
        turns: result.turns,
        toolCalls: steps.length,
        readCount: count('ok'),
        pendingCount: count('pending_approval'),
        deniedCount: count('denied'),
        stoppedReason: result.stoppedReason ?? null,
        answered: typeof result.final === 'string',
        correlationId: request.id ?? null,
      },
    });
    return {
      sessionId,
      turns: result.turns,
      final: typeof result.final === 'string' ? redactSecrets(result.final) : null,
      stoppedReason: result.stoppedReason ?? null,
      steps,
    };
  });
}
