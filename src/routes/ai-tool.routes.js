// AI tool approval queue and execution receipts (#413 slice 2,
// docs/ai-tool-registry.md).
//
// Staff only. An ADMIN sees and decides every action in the organization; a
// TEAM member sees and decides only the actions they requested (and only
// approves them when the tool lets the requester approve). Approving or
// rejecting requires step-up re-authentication (docs/privileged-actions.md):
// every action in the queue is a prepare or execute tool.

import { requireRecentAuth } from '../auth/reauth.js';
import { isAiControlError, sendAiError } from '../ai/errors.js';
import { ToolError, describeTool, toolRegistry } from '../ai/tools/registry.js';
import { PENDING_STATUS, createToolExecutor, redactSecrets } from '../ai/tools/executor.js';
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
} from '../validators/schemas.js';

const STAFF_ROLES = ['ADMIN', 'TEAM'];

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
 * @param {{ toolExecutor?: ReturnType<typeof createToolExecutor>, now?: () => Date }} [options]
 */
export default async function aiToolRoutes(fastify, options = {}) {
  const executor = options.toolExecutor ?? createToolExecutor({ deps: { decryptSecret: decrypt, postSlackMessage } });
  const now = options.now ?? (() => new Date());
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
}
