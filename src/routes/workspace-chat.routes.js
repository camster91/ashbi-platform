import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../validators/schemas.js';
import { ToolError } from '../ai/tools/registry.js';
import {
  channelInputSchema, messageInputSchema, messagesQuerySchema, channelsQuerySchema,
  listWorkspaceChatPeople, listWorkspaceChatChannels, createWorkspaceChatChannel,
  getWorkspaceChatMessages, postWorkspaceChatMessage, markWorkspaceChatRead, setWorkspaceChatMember,
} from '../services/workspace-chat.service.js';

const id = z.string().trim().min(1).max(100);
const channelParams = z.object({ channelId: id }).strict();
const memberParams = z.object({ channelId: id, userId: id }).strict();
async function requireStaff(request, reply) {
  if (!request.user?.organizationId || !['ADMIN', 'TEAM'].includes(request.user?.role)) return reply.code(403).send({ error: 'Staff access required', code: 'ROLE_DENIED' });
}
function handler(operation) {
  return async (request, reply) => {
    try { return await operation(request); }
    catch (error) {
      if (error instanceof ToolError) return reply.code(error.statusCode).send({ error: error.statusCode === 404 ? 'Conversation not found' : error.statusCode === 409 ? 'Conversation conflict' : error.statusCode === 403 ? 'Staff access denied' : 'Workspace chat unavailable', code: error.code });
      request.log.error({ errorName: error?.name }, 'Workspace chat request failed');
      return reply.code(503).send({ error: 'Workspace chat unavailable', code: 'CHAT_UNAVAILABLE' });
    }
  };
}

export default async function workspaceChatRoutes(fastify) {
  const onRequest = [fastify.authenticate, requireStaff];
  fastify.get('/channels', { onRequest, preHandler: [validateQuery(channelsQuerySchema)] }, handler(r => listWorkspaceChatChannels(r.prisma, r.user, r.query)));
  fastify.get('/people', { onRequest }, handler(r => listWorkspaceChatPeople(r.prisma, r.user)));
  fastify.post('/channels', { onRequest, preHandler: [validateBody(channelInputSchema)], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, handler(r => createWorkspaceChatChannel(r.prisma, r.user, r.body)));
  fastify.get('/channels/:channelId/messages', { onRequest, preHandler: [validateParams(channelParams), validateQuery(messagesQuerySchema)] }, handler(r => getWorkspaceChatMessages(r.prisma, r.user, r.params.channelId, r.query)));
  fastify.post('/channels/:channelId/messages', { onRequest, preHandler: [validateParams(channelParams), validateBody(messageInputSchema)], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, handler(r => postWorkspaceChatMessage(r.prisma, r.user, r.params.channelId, r.body)));
  fastify.post('/channels/:channelId/read', { onRequest, preHandler: [validateParams(channelParams), validateBody(z.object({}).strict())] }, handler(r => markWorkspaceChatRead(r.prisma, r.user, r.params.channelId)));
  fastify.patch('/channels/:channelId/members/:userId', { onRequest, preHandler: [validateParams(memberParams), validateBody(z.object({ active: z.boolean() }).strict())] }, handler(r => setWorkspaceChatMember(r.prisma, r.user, r.params.channelId, r.params.userId, r.body.active)));
}
