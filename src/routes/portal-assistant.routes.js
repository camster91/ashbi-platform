import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { getRequestImpersonation } from '../utils/request-context.js';
import { portalAssistantConfigSchema, portalAssistantIntentSchema, portalAssistantPageSchema, readPortalAssistantConfig, updatePortalAssistantConfig,
  listPortalAssistant, createPortalAssistantIntent, readPortalAssistantRun, dispatchPortalAssistantRun, terminatePortalAssistantRun } from '../services/portal-assistant.service.js';

const id = z.string().trim().min(1).max(100);
const project = z.object({ id }).strict();
const run = project.extend({ runId: id });
const empty = z.object({}).strict();
const handle = (operation, mutation = false) => async (request, reply) => {
  if (mutation && (request.impersonation || getRequestImpersonation())) return reply.code(403).send({ error: 'Support views are read-only', code: 'IMPERSONATION_READ_ONLY' });
  try { return await operation(request); }
  catch (error) {
    if (error instanceof ToolError) return reply.code(error.statusCode).send({ error: 'Portal account manager unavailable', code: error.code });
    request.log.warn({ errorName: error?.name }, 'Portal account manager unavailable');
    return reply.code(503).send({ error: 'Portal account manager unavailable', code: 'PORTAL_ASSISTANT_UNAVAILABLE' });
  }
};
export async function portalAssistantRoutes(fastify, { clientAuth, chat }) {
  if (typeof clientAuth !== 'function') throw new Error('Portal assistant requires the client-session guard');
  const options = (params, body, query) => ({ preHandler: [clientAuth, validateParams(params), ...(body ? [validateBody(body)] : []), ...(query ? [validateQuery(query)] : [])], config: { rateLimit: { max: 15, timeWindow: '1 minute' } } });
  const path = '/projects/:id/assistant';
  fastify.get(path, options(project, null, portalAssistantPageSchema), handle(r => listPortalAssistant(r.prisma, r.clientUser, r.params.id, r.query)));
  fastify.post(`${path}/runs`, options(project, portalAssistantIntentSchema), handle(r => createPortalAssistantIntent(r.prisma, r.clientUser, r.params.id, r.body), true));
  fastify.get(`${path}/runs/by-intent/:key`, options(project.extend({ key: z.string().uuid() })), handle(r => readPortalAssistantRun(r.prisma, r.clientUser, r.params.id, { idempotencyKey: r.params.key })));
  fastify.get(`${path}/runs/:runId`, options(run), handle(r => readPortalAssistantRun(r.prisma, r.clientUser, r.params.id, { runId: r.params.runId })));
  fastify.post(`${path}/runs/:runId/dispatch`, options(run, empty), handle(r => dispatchPortalAssistantRun(r.prisma, r.clientUser, r.params.id, r.params.runId, { chat }), true));
  for (const operation of ['cancel', 'recover']) fastify.post(`${path}/runs/:runId/${operation}`, options(run, empty), handle(r => terminatePortalAssistantRun(r.prisma, r.clientUser, r.params.id, r.params.runId, operation), true));
}
export default async function portalAssistantStaffRoutes(fastify) {
  const options = body => ({ onRequest: [fastify.authenticate], preHandler: [validateParams(z.object({ clientId: id }).strict()), ...(body ? [validateBody(body)] : [])] });
  fastify.get('/:clientId/portal-config', options(), handle(r => readPortalAssistantConfig(r.prisma, r.user, r.params.clientId)));
  fastify.patch('/:clientId/portal-config', options(portalAssistantConfigSchema), handle(r => updatePortalAssistantConfig(r.prisma, r.user, r.params.clientId, r.body), true));
}
