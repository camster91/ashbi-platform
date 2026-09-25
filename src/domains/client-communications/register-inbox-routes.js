import inboxRoutes from '../../routes/inbox.routes.js';
import emailTriageRoutes from '../../routes/email-triage.routes.js';

/**
 * Register the unified inbox and AI email-triage routes.
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerInboxRoutes(fastify) {
  await fastify.register(inboxRoutes, { prefix: '/api/inbox' });
  await fastify.register(emailTriageRoutes, { prefix: '/api/email-triage' });
}
