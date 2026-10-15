import { z } from 'zod';
import { requireStaff } from '../middleware/require-staff.js';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import { clientAgentConversationCreateSchema, clientAgentConversationArchiveSchema,
  clientAgentConversationQuerySchema, createClientAgentConversation, listClientAgentConversations,
  readClientAgentConversation, archiveClientAgentConversation } from '../services/client-agent-conversation.service.js';
import { clientAgentRunStartSchema, startClientAgentRun, readClientAgentRun,
  getClientAgentRunByIntent, cancelClientAgentRun } from '../services/client-agent-run.service.js';

const cuid = z.string().cuid();
const clientParams = z.object({ clientId: cuid }).strict();
const conversationParams = clientParams.extend({ conversationId: cuid });
const runParams = conversationParams.extend({ runId: cuid });
const intentParams = conversationParams.extend({ idempotencyKey: z.string().uuid().transform(value => value.toLowerCase()) });
const pageQuery = clientAgentConversationQuerySchema.extend({ after: cuid.optional() });
const emptyQuery = z.object({}).strict();
const emptyBody = z.object({}).strict().optional();
const failures = {
  ROLE_DENIED: [403, 'Active staff access required.'],
  RECORD_NOT_FOUND: [404, 'Client conversation or run not found.'],
  INVALID_INPUT: [400, 'Provide valid conversation or run fields.'],
  CONVERSATION_CONFLICT: [409, 'The conversation changed. Reload before trying again.'],
  CONVERSATION_ARCHIVED: [409, 'Archived conversations cannot start new runs.'],
  RUN_CONFLICT: [409, 'The account manager run changed. Reload before trying again.'],
  RUN_IDEMPOTENCY_CONFLICT: [409, 'This request key was already used for a different question.'],
  RUN_IN_PROGRESS: [409, 'Wait for the current run to finish or cancel it.'],
  AGENT_DISABLED: [409, 'Enable the client work account manager before starting a run.'],
};
async function respond(reply, work) {
  try { return await work(); } catch (error) {
    const safe = error instanceof ToolError && Object.hasOwn(failures, error.code) ? failures[error.code] : null;
    if (safe) return reply.code(safe[0]).send({ error: safe[1], code: error.code });
    return reply.code(503).send({ error: 'Client account manager unavailable.', code: 'CLIENT_AGENT_UNAVAILABLE' });
  }
}

/** Staff-shared conversations; services recheck stored permissions and scope. */
export default async function clientAgentConversationRoutes(fastify, options = {}) {
  const services = { createClientAgentConversation, listClientAgentConversations, readClientAgentConversation,
    archiveClientAgentConversation, startClientAgentRun, readClientAgentRun, getClientAgentRunByIntent,
    cancelClientAgentRun, ...options.services };
  fastify.get('/clients/:clientId/assistant/conversations', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(clientParams), validateQuery(pageQuery)],
  }, (request, reply) => respond(reply, () => services.listClientAgentConversations(
    request.prisma, request.user, request.params.clientId, request.query)));

  fastify.post('/clients/:clientId/assistant/conversations', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(clientParams), validateQuery(emptyQuery), validateBody(clientAgentConversationCreateSchema)],
  }, (request, reply) => respond(reply, () => services.createClientAgentConversation(
    request.prisma, request.user, request.params.clientId, request.body)));

  fastify.get('/clients/:clientId/assistant/conversations/:conversationId', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(conversationParams), validateQuery(pageQuery)],
  }, (request, reply) => respond(reply, () => services.readClientAgentConversation(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.query)));

  fastify.post('/clients/:clientId/assistant/conversations/:conversationId/archive', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(conversationParams), validateQuery(emptyQuery), validateBody(clientAgentConversationArchiveSchema)],
  }, (request, reply) => respond(reply, () => services.archiveClientAgentConversation(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.body)));

  fastify.post('/clients/:clientId/assistant/conversations/:conversationId/runs', {
    onRequest: [fastify.authenticate, requireStaff],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    preHandler: [validateParams(conversationParams), validateQuery(emptyQuery), validateBody(clientAgentRunStartSchema)],
  }, (request, reply) => respond(reply, () => services.startClientAgentRun(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.body)));

  fastify.get('/clients/:clientId/assistant/conversations/:conversationId/runs/:runId', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(runParams), validateQuery(emptyQuery)],
  }, (request, reply) => respond(reply, () => services.readClientAgentRun(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.params.runId)));

  fastify.post('/clients/:clientId/assistant/conversations/:conversationId/runs/:runId/cancel', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(runParams), validateQuery(emptyQuery), validateBody(emptyBody)],
  }, (request, reply) => respond(reply, () => services.cancelClientAgentRun(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.params.runId)));

  fastify.get('/clients/:clientId/assistant/conversations/:conversationId/runs/by-intent/:idempotencyKey', {
    onRequest: [fastify.authenticate, requireStaff],
    preHandler: [validateParams(intentParams), validateQuery(emptyQuery)],
  }, (request, reply) => respond(reply, () => services.getClientAgentRunByIntent(
    request.prisma, request.user, request.params.clientId, request.params.conversationId, request.params.idempotencyKey)));
}
