import authRoutes from '../../routes/auth.routes.js';
import mfaRoutes from '../../routes/mfa.routes.js';
import settingsRoutes from '../../routes/settings.routes.js';
import apiKeyRoutes from '../../routes/api-key.routes.js';
import credentialRoutes from '../../routes/credential.routes.js';
import teamRoutes from '../../routes/team.routes.js';
import auditEventRoutes from '../../routes/audit-event.routes.js';

// The application factory decorates `authenticateWithApiKey` with this
// verifier; re-exporting it keeps src/index.js free of route-module imports.
export { authenticateApiKey } from '../../routes/api-key.routes.js';

/**
 * Register identity and access routes: authentication, workspace settings,
 * API keys, the credential vault, team membership, and the admin audit log.
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerIdentityRoutes(fastify) {
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(mfaRoutes, { prefix: '/api/auth' });
  await fastify.register(settingsRoutes, { prefix: '/api/settings' });
  await fastify.register(apiKeyRoutes, { prefix: '/api/api-keys' });
  await fastify.register(credentialRoutes, { prefix: '/api/credentials' });
  await fastify.register(teamRoutes, { prefix: '/api/team' });
  await fastify.register(auditEventRoutes, { prefix: '/api/audit-events' });
}
