import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { validateParams, validateQuery } from '../validators/schemas.js';
import { communicationParamsSchema, communicationDetailParamsSchema, communicationsQuerySchema, listClientCommunications, readClientCommunication } from '../services/client-communications.service.js';

async function requireStaff(request, reply) {
  if (!request.user?.organizationId || !['ADMIN', 'TEAM'].includes(request.user?.role)) return reply.code(403).send({ error: 'Staff access required', code: 'ROLE_DENIED' });
}
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
export default async function clientCommunicationsRoutes(fastify) {
  const onRequest = [fastify.authenticate, requireStaff];
  fastify.get('/:clientId', { onRequest, preHandler: [validateParams(communicationParamsSchema), validateQuery(communicationsQuerySchema)] }, handle(r => listClientCommunications(r.prisma, r.user, r.params.clientId, r.query)));
  fastify.get('/:clientId/:source/:messageId', { onRequest, preHandler: [validateParams(communicationDetailParamsSchema), validateQuery(z.object({}).strict())] }, handle(r => readClientCommunication(r.prisma, r.user, r.params.clientId, r.params.source, r.params.messageId)));
}
