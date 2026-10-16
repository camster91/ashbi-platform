import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { ToolError } from '../ai/tools/registry.js';
import { createToolExecutor, redactSecrets, IDEMPOTENCY_KEY_FORMAT } from '../ai/tools/executor.js';
import { workspaceRegistry } from '../integrations/workspace-tools.js';
import { requireRecentAuth } from '../auth/reauth.js';
import { communicationTaskFormSchema, communicationTaskSource, communicationTaskScope } from '../services/client-communication-task.service.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { communicationParamsSchema, communicationDetailParamsSchema, communicationsQuerySchema, listClientCommunications, readClientCommunication } from '../services/client-communications.service.js';

function handle(operation) {
  return async (request, reply) => {
    try { return await operation(request); }
    catch (error) {
      if (error instanceof ToolError && [400, 403, 404].includes(error.statusCode)) return reply.code(error.statusCode).send({ error: error.statusCode === 404 ? 'Communication not found' : error.statusCode === 403 ? 'Staff access required' : 'Invalid communication request', code: error.code });
      request.log.warn({ errorName: error?.name }, 'Client communication history unavailable');
      return reply.code(503).send({ error: 'Client communication history unavailable', code: 'COMMUNICATIONS_UNAVAILABLE' });
    }
  };
}
const taskActionName = 'create_task_from_client_message';
const taskPathSchema = communicationParamsSchema.extend({ messageId: z.string().trim().min(1).max(100) });
const actionPathSchema = taskPathSchema.extend({ actionId: z.string().min(1).max(100) });
const intentPathSchema = taskPathSchema.extend({ key: z.string().regex(IDEMPOTENCY_KEY_FORMAT) });
const prepareSchema = z.object({ input: communicationTaskFormSchema, idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_FORMAT) }).strict();
function actionView(row) {
  return redactSecrets({ id: row.id, action: row.action, status: row.status, preview: row.preview, result: row.result ?? null,
    expiresAt: row.expiresAt, confirmedAt: row.confirmedAt ?? null, executedAt: row.executedAt ?? null,
    errorCode: row.errorCode ?? null, outcome: row.outcome ?? null,
    expired: row.status === 'PENDING_CONFIRMATION' && new Date(row.expiresAt) <= new Date() });
}
function actionHandle(operation) {
  return async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await operation(request); }
    catch (error) {
      if (error instanceof ToolError) {
        const messages = {
          INVALID_INPUT: 'Invalid task details',
          ROLE_DENIED: 'Staff access required',
          RECORD_NOT_FOUND: 'Communication not found',
          NOT_FOUND: 'Task action not found',
          IDEMPOTENCY_CONFLICT: 'This request was already used with different task details',
          TARGET_UNAVAILABLE: 'The communication or destination changed; review a new preview',
          ACTION_EXPIRED: 'This preview expired; review a new preview',
        };
        // A transactional refusal may revoke access to the stored preview.
        // Recover its receipt through the separately authorized read endpoint.
        return reply.code(error.statusCode).send({ error: messages[error.code] ?? 'Task action unavailable', code: error.code });
      }
      request.log.warn({ errorName: error?.name }, 'Communication task action unavailable');
      return reply.code(503).send({ error: 'Communication task action unavailable', code: 'COMMUNICATION_TASK_UNAVAILABLE' });
    }
  };
}

export default async function clientCommunicationsRoutes(fastify, options = {}) {
  const onRequest = [fastify.authenticate, requireStaff];
  const executor = options.toolExecutor ?? createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} } });
  const context = r => ({ prisma: r.prisma, user: r.user, requestId: r.id, ip: r.ip });
  async function ownedAction(r, byIntent = false) {
    await communicationTaskSource(r.prisma, r.user, r.params);
    const row = await r.prisma.aiBridgeAction.findFirst({ where: {
      organizationId: r.user.organizationId, userId: r.user.id, action: taskActionName, source: 'ai_bridge',
      ...(byIntent ? { idempotencyKey: r.params.key } : { id: r.params.actionId }),
    } });
    if (!row || row.input?.clientId !== r.params.clientId || row.input?.source !== 'inbox' || row.input?.messageId !== r.params.messageId) throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
    await communicationTaskScope({ prisma: r.prisma, user: r.user, input: row.input });
    return row;
  }
  const taskBase = '/:clientId/inbox/:messageId/task-actions';
  fastify.post(taskBase, { onRequest, preHandler: [validateParams(taskPathSchema), validateBody(prepareSchema)] }, actionHandle(async r => {
    await communicationTaskSource(r.prisma, r.user, r.params);
    const result = await executor.invoke(context(r), { tool: taskActionName, source: 'ai_bridge', idempotencyKey: r.body.idempotencyKey,
      input: { ...r.body.input, clientId: r.params.clientId, source: 'inbox', messageId: r.params.messageId } });
    if (result.action.organizationId !== r.user.organizationId || result.action.source !== 'ai_bridge') throw new ToolError('NOT_FOUND', 'Action not found', { statusCode: 404 });
    // Executor intent replays short-circuit scope resolution. Reauthorize its stored destination too.
    await communicationTaskScope({ prisma: r.prisma, user: r.user, input: result.action.input });
    return { action: actionView(result.action), idempotent: result.idempotent };
  }));
  fastify.get(`${taskBase}/by-intent/:key`, { onRequest, preHandler: [validateParams(intentPathSchema), validateQuery(z.object({}).strict())] }, actionHandle(async r => ({ action: actionView(await ownedAction(r, true)) })));
  fastify.get(`${taskBase}/:actionId`, { onRequest, preHandler: [validateParams(actionPathSchema), validateQuery(z.object({}).strict())] }, actionHandle(async r => ({ action: actionView(await ownedAction(r)) })));
  fastify.post(`${taskBase}/:actionId/confirm`, { onRequest, preHandler: [requireRecentAuth, validateParams(actionPathSchema), validateBody(z.object({ confirm: z.literal(true) }).strict())] }, actionHandle(async r => {
    await ownedAction(r);
    const result = await executor.approve(context(r), r.params.actionId, { method: 'session_step_up', reauthenticated: true, ownerOnly: true });
    return { action: actionView(result.action), idempotent: result.idempotent };
  }));
  fastify.get('/:clientId', { onRequest, preHandler: [validateParams(communicationParamsSchema), validateQuery(communicationsQuerySchema)] }, handle(r => listClientCommunications(r.prisma, r.user, r.params.clientId, r.query)));
  fastify.get('/:clientId/:source/:messageId', { onRequest, preHandler: [validateParams(communicationDetailParamsSchema), validateQuery(z.object({}).strict())] }, handle(r => readClientCommunication(r.prisma, r.user, r.params.clientId, r.params.source, r.params.messageId)));
}
