import responseRoutes from '../../routes/response.routes.js';
import threadRoutes from '../../routes/thread.routes.js';
import webhookRoutes from '../../routes/webhook.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import gmailRoutes from '../../routes/gmail.routes.js';

/**
 * Register the contiguous response-to-delivery communication vertical.
 *
 * Keep this sequence aligned with the pre-extraction application composition
 * so route precedence and Fastify plugin initialization remain unchanged.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerClientCommunicationRoutes(fastify) {
  await fastify.register(responseRoutes, { prefix: '/api/responses' });
  await fastify.register(threadRoutes, { prefix: '/api/threads' });
  await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
  await fastify.register(clientPortalRoutes, { prefix: '/api/client-portal' });
  await fastify.register(gmailRoutes, { prefix: '/api/gmail' });
}
