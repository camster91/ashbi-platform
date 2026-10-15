import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { clientAgentProfileParamsSchema, clientAgentProfileUpdateSchema,
  readClientAgentProfile, saveClientAgentProfile } from '../services/client-agent-profile.service.js';

const messages = Object.freeze({
  ROLE_DENIED: 'Active staff access required.', RECORD_NOT_FOUND: 'Client not found',
  INVALID_INPUT: 'Provide valid account manager profile fields.',
  PROFILE_CONFLICT: 'The account manager profile changed. Reload before saving.',
  PROFILE_AUDIT_UNAVAILABLE: 'The profile could not be saved with its audit record.',
});
function sendFailure(request, reply, error) {
  if (error instanceof ToolError && Object.hasOwn(messages, error.code)) {
    return reply.code(error.statusCode).send({ error: messages[error.code], code: error.code });
  }
  request.log.warn({ errorName: error?.name }, 'Account manager profile unavailable');
  return reply.code(503).send({ error: 'Account manager profile unavailable.', code: 'PROFILE_UNAVAILABLE' });
}
export default async function clientAgentProfileRoutes(fastify) {
  fastify.get('/:clientId/profile', {
    onRequest: [fastify.authenticate, requireStaff], preHandler: [validateParams(clientAgentProfileParamsSchema), validateQuery(z.object({}).strict())],
  }, async (request, reply) => {
    try { return await readClientAgentProfile(request.prisma, request.user, request.params.clientId); }
    catch (error) { return sendFailure(request, reply, error); }
  });
  fastify.patch('/:clientId/profile', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(clientAgentProfileParamsSchema), validateQuery(z.object({}).strict()), validateBody(clientAgentProfileUpdateSchema)],
  }, async (request, reply) => {
    try { return await saveClientAgentProfile(request.prisma, request.user, request.params.clientId, request.body); }
    catch (error) { return sendFailure(request, reply, error); }
  });
}
