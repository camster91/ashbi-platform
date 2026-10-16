import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { accountManagerInstallSchema, accountManagerUpdateSchema, accountManagerRequestSchema, accountManagerPageSchema,
  readWorkspaceAccountManager, installWorkspaceAccountManager, updateWorkspaceAccountManager,
  requestWorkspaceAccountManager, listWorkspaceAccountManagerInvocations, readWorkspaceAccountManagerInvocation,
  getWorkspaceAccountManagerByIntent, cancelWorkspaceAccountManagerInvocation } from '../services/workspace-account-manager.service.js';
const id = z.string().trim().min(1).max(100);
const channel = z.object({ channelId: id }).strict();
const binding = channel.extend({ bindingId: id });
const invocation = channel.extend({ invocationId: id });
const intent = channel.extend({ key: z.string().uuid() });
const handle = operation => async (request, reply) => {
  try { return await operation(request); }
  catch (error) {
    if (error instanceof ToolError) return reply.code(error.statusCode).send({ error: 'Workspace account manager unavailable', code: error.code });
    request.log.error({ errorName: error?.name }, 'Workspace account manager request failed');
    return reply.code(error?.code === 'P2002' || error?.code === 'P2034' ? 409 : 503).send({ error: 'Workspace account manager unavailable', code: 'WORKSPACE_AGENT_UNAVAILABLE' });
  }
};
export default async function workspaceAccountManagerRoutes(fastify) {
  const onRequest = [fastify.authenticate, requireStaff];
  const options = (params, body, query) => ({ onRequest, preHandler: [validateParams(params), ...(body ? [validateBody(body)] : []), ...(query ? [validateQuery(query)] : [])], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } });
  fastify.get('/channels/:channelId/account-manager', options(channel), handle(r => readWorkspaceAccountManager(r.prisma, r.user, r.params.channelId)));
  fastify.post('/channels/:channelId/account-manager', options(channel, accountManagerInstallSchema), handle(r => installWorkspaceAccountManager(r.prisma, r.user, r.params.channelId, r.body)));
  fastify.patch('/channels/:channelId/account-manager/:bindingId', options(binding, accountManagerUpdateSchema), handle(r => updateWorkspaceAccountManager(r.prisma, r.user, r.params.channelId, r.params.bindingId, r.body)));
  fastify.get('/channels/:channelId/account-manager/requests', options(channel, null, accountManagerPageSchema), handle(r => listWorkspaceAccountManagerInvocations(r.prisma, r.user, r.params.channelId, r.query)));
  fastify.post('/channels/:channelId/account-manager/requests', options(channel, accountManagerRequestSchema), handle(r => requestWorkspaceAccountManager(r.prisma, r.user, r.params.channelId, r.body)));
  fastify.get('/channels/:channelId/account-manager/requests/by-intent/:key', options(intent), handle(r => getWorkspaceAccountManagerByIntent(r.prisma, r.user, r.params.channelId, r.params.key)));
  fastify.get('/channels/:channelId/account-manager/requests/:invocationId', options(invocation), handle(r => readWorkspaceAccountManagerInvocation(r.prisma, r.user, r.params.channelId, r.params.invocationId)));
  fastify.post('/channels/:channelId/account-manager/requests/:invocationId/cancel', options(invocation, z.object({}).strict()), handle(r => cancelWorkspaceAccountManagerInvocation(r.prisma, r.user, r.params.channelId, r.params.invocationId)));
}
