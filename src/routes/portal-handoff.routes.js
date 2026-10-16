import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { handoffCreateSchema, handoffPageSchema, handoffStaffPageSchema, handoffRevisionSchema, handoffRequeueSchema,
  createPortalHandoff, listPortalHandoffs, readPortalHandoff, listStaffHandoffs, readStaffHandoff, transitionHandoff } from '../services/portal-handoff.service.js';
const id = z.string().trim().min(1).max(100);
const project = z.object({ id }).strict();
const request = z.object({ requestId: id }).strict();
const handle = operation => async (req, reply) => {
  try { return await operation(req); }
  catch (error) {
    if (error instanceof ToolError) return reply.code(error.statusCode).send({ error: 'Human account manager request unavailable', code: error.code });
    req.log.error({ errorName: error?.name }, 'Human handoff unavailable');
    return reply.code(503).send({ error: 'Human account manager request unavailable', code: 'HANDOFF_UNAVAILABLE' });
  }
};
export async function portalHandoffRoutes(fastify, { clientAuth }) {
  if (typeof clientAuth !== 'function') throw new Error('Portal handoffs require the existing client-session guard');
  const options = (params, body, query) => ({ preHandler: [clientAuth, validateParams(params), ...(body ? [validateBody(body)] : []), ...(query ? [validateQuery(query)] : [])], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } });
  const path = '/projects/:id/account-manager-requests';
  fastify.post(path, options(project, handoffCreateSchema), handle(r => createPortalHandoff(r.prisma, r.clientUser, r.params.id, r.body)));
  fastify.get(path, options(project, null, handoffPageSchema), handle(r => listPortalHandoffs(r.prisma, r.clientUser, r.params.id, r.query)));
  fastify.get(`${path}/by-intent/:key`, options(project.extend({ key: z.string().uuid() })), handle(r => readPortalHandoff(r.prisma, r.clientUser, r.params.id, { idempotencyKey: r.params.key })));
  fastify.get(`${path}/:requestId`, options(project.extend({ requestId: id })), handle(r => readPortalHandoff(r.prisma, r.clientUser, r.params.id, { requestId: r.params.requestId })));
}
export default async function staffHandoffRoutes(fastify) {
  const options = (params, body, query) => ({ onRequest: [fastify.authenticate, requireStaff], preHandler: [...(params ? [validateParams(params)] : []), ...(body ? [validateBody(body)] : []), ...(query ? [validateQuery(query)] : [])] });
  fastify.get('/', options(null, null, handoffStaffPageSchema), handle(r => listStaffHandoffs(r.prisma, r.user, r.query)));
  fastify.get('/:requestId', options(request), handle(r => readStaffHandoff(r.prisma, r.user, r.params.requestId)));
  for (const operation of ['claim', 'resolve', 'requeue']) fastify.post(`/:requestId/${operation}`, options(request, operation === 'requeue' ? handoffRequeueSchema : handoffRevisionSchema), handle(r => transitionHandoff(r.prisma, r.user, r.params.requestId, operation, r.body)));
}
