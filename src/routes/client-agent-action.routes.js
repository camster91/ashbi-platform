import { assertMcpActionAuthority } from '../auth/mcp-action-authority.js';
import { authorizeClientAgentStaff } from '../services/client-agent-profile.service.js';
import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { ToolError } from '../ai/tools/registry.js';
import { createToolExecutor, redactSecrets, IDEMPOTENCY_KEY_FORMAT } from '../ai/tools/executor.js';
import { workspaceRegistry } from '../integrations/workspace-tools.js';
import { clientTaskFormSchema, clientTaskScope, authorizeClientTaskReceipt } from '../services/client-agent-action.service.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';

const id = z.string().trim().min(1).max(100);
const path = z.object({ clientId: id }).strict();
const actionPath = path.extend({ actionId: id });
const intentPath = path.extend({ key: z.string().regex(IDEMPOTENCY_KEY_FORMAT) });
const prepare = z.object({ input: clientTaskFormSchema, idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_FORMAT) }).strict();
function actionView(row) {
  return redactSecrets({ id: row.id, action: row.action, status: row.status, preview: row.preview, result: row.result ?? null,
    expiresAt: row.expiresAt, confirmedAt: row.confirmedAt ?? null, executedAt: row.executedAt ?? null,
    errorCode: row.errorCode ?? null, outcome: row.outcome ?? null,
    expired: row.status === 'PENDING_CONFIRMATION' && new Date(row.expiresAt) <= new Date() });
}

function handle(operation) {
  return async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await operation(request); }
    catch (error) {
      // Never project error.action: a refusal may itself mean authority was revoked.
      if (error instanceof ToolError) return reply.code(error.statusCode).send({ error: error.statusCode === 404 ? 'Task proposal not found' : error.statusCode === 403 ? 'Staff access required' : error.code === 'ACTION_UNAVAILABLE' ? 'Task outcome is unconfirmed; keep this request and check again' : 'Task proposal unavailable; reload and review a new preview', code: error.code });
      request.log.warn({ errorName: error?.name }, 'Client task proposal unavailable');
      return reply.code(503).send({ error: 'Client task proposal unavailable', code: 'CLIENT_TASK_UNAVAILABLE' });
    }
  };
}
export default async function clientAgentActionRoutes(fastify, options = {}) {
  const onRequest = [fastify.authenticate, requireStaff];
  const executor = options.toolExecutor ?? createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} } });
  const context = r => ({ prisma: r.prisma, user: r.user, requestId: r.id, ip: r.ip });
  async function owned(r, byIntent = false) {
    const row = await r.prisma.aiBridgeAction.findFirst({ where: { organizationId: r.user.organizationId, userId: r.user.id,
      action: 'create_client_task', source: 'ai_bridge', ...(byIntent ? { idempotencyKey: r.params.key } : { id: r.params.actionId }) } });
    if (!row || row.input?.clientId !== r.params.clientId) throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
    await assertMcpActionAuthority(r.prisma, context(r), row.action, row);
    await authorizeClientTaskReceipt(r.prisma, r.user, row);
    return row;
  }
  const base = '/:clientId/assistant/task-actions';
  fastify.post(base, { onRequest, preHandler: [validateParams(path), validateBody(prepare)] }, handle(async r => {
    const input = { ...r.body.input, clientId: r.params.clientId };
    await clientTaskScope({ prisma: r.prisma, user: r.user, input });
    const result = await executor.invoke(context(r), { tool: 'create_client_task', input, idempotencyKey: r.body.idempotencyKey, source: 'ai_bridge' });
    if (result.action?.input?.clientId !== r.params.clientId || result.action.organizationId !== r.user.organizationId || result.action.userId !== r.user.id || result.action.source !== 'ai_bridge' || result.action.action !== 'create_client_task') throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
    await authorizeClientTaskReceipt(r.prisma, r.user, result.action);
    return { action: actionView(result.action), idempotent: result.idempotent };
  }));
  fastify.get(`${base}/by-intent/:key`, { onRequest, preHandler: [validateParams(intentPath), validateQuery(z.object({}).strict())] }, handle(async r => ({ action: actionView(await owned(r, true)) })));
  fastify.get(`${base}/:actionId`, { onRequest, preHandler: [validateParams(actionPath), validateQuery(z.object({}).strict())] }, handle(async r => ({ action: actionView(await owned(r)) })));
  fastify.post(`${base}/:actionId/confirm`, { onRequest, preHandler: [requireRecentAuth, validateParams(actionPath), validateBody(z.object({ confirm: z.literal(true) }).strict())] }, handle(async r => {
    await owned(r);
    const result = await executor.approve(context(r), r.params.actionId, { method: 'session_step_up', reauthenticated: true, ownerOnly: true });
    await authorizeClientTaskReceipt(r.prisma, r.user, result.action);
    return { action: actionView(result.action), idempotent: result.idempotent };
  }));
  // Withdrawing one's own pending intent grants no access to its old project,
  // profile, preview or result. Preserve strict authority on all full reads.
  async function discard(r, byIntent) {
    return r.prisma.$transaction(async tx => {
      await authorizeClientAgentStaff(tx, r.user, r.params.clientId);
      const row = await tx.aiBridgeAction.findFirst({ where: { organizationId: r.user.organizationId, userId: r.user.id,
        action: 'create_client_task', source: 'ai_bridge', ...(byIntent ? { idempotencyKey: r.params.key } : { id: r.params.actionId }) } });
      if (!row || row.input?.clientId !== r.params.clientId) throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
      await assertMcpActionAuthority(tx, context(r), row.action, row);
      if (['EXECUTED', 'REJECTED', 'EXPIRED'].includes(row.status)) return { action: { id: row.id, status: row.status } };
      if (row.status === 'FAILED' && row.outcome === 'failed') return { action: { id: row.id, status: 'FAILED', outcome: 'failed' } };
      if (row.status !== 'PENDING_CONFIRMATION') throw new ToolError('ACTION_UNAVAILABLE', 'Action outcome is not confirmed', { statusCode: 409 });
      const result = await executor.reject({ ...context(r), prisma: tx }, row.id, { method: 'session_step_up', reauthenticated: true, ownerOnly: true, reason: 'not_needed' });
      if (result.action?.id !== row.id || result.action.status !== 'REJECTED') throw new ToolError('ACTION_UNAVAILABLE', 'Action outcome is not confirmed', { statusCode: 409 });
      return { action: { id: row.id, status: 'REJECTED' } };
    }, { isolationLevel: 'Serializable' });
  }
  fastify.post(`${base}/:actionId/reject`, { onRequest, preHandler: [requireRecentAuth, validateParams(actionPath), validateBody(z.object({}).strict())] }, handle(r => discard(r, false)));
  fastify.post(`${base}/by-intent/:key/reject`, { onRequest, preHandler: [requireRecentAuth, validateParams(intentPath), validateBody(z.object({}).strict())] }, handle(r => discard(r, true)));
}
