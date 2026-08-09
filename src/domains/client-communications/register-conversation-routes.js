import ashChatRoutes from '../../routes/ash-chat.routes.js';
import chatRoutes from '../../routes/chat.routes.js';

/**
 * Register Ash AI and project conversation routes in their established order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerConversationRoutes(fastify) {
  await fastify.register(ashChatRoutes, { prefix: '/api/ash-chat' });
  await fastify.register(chatRoutes, { prefix: '/api/chat' });
}
