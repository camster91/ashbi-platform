import brandRoutes from '../../routes/brand.routes.js';
import timeTrackingRoutes from '../../routes/time-tracking.routes.js';
import timeSessionRoutes from '../../routes/time-sessions.routes.js';
import creativeBriefRoutes from '../../routes/creative-brief.routes.js';
import assetLibraryRoutes from '../../routes/asset-library.routes.js';
import templateRoutes from '../../routes/template.routes.js';
import portalRoutes from '../../routes/portal.routes.js';
import onboardingRoutes from '../../routes/onboarding.routes.js';
import noteRoutes from '../../routes/note.routes.js';

/**
 * Register client-delivery workspace routes: brand, time tracking and
 * sessions, creative briefs, the asset library, templates, the public client
 * portal, onboarding, and notes/wiki (mounted at the `/api` root).
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerClientWorkspaceRoutes(fastify) {
  await fastify.register(brandRoutes, { prefix: '/api/brand' });
  await fastify.register(timeTrackingRoutes, { prefix: '/api/time-tracking' });
  await fastify.register(timeSessionRoutes, { prefix: '/api/time-sessions' });
  await fastify.register(creativeBriefRoutes, { prefix: '/api/creative-brief' });
  await fastify.register(assetLibraryRoutes, { prefix: '/api/asset-library' });
  await fastify.register(templateRoutes, { prefix: '/api/templates' });
  await fastify.register(portalRoutes, { prefix: '/api/portal' });
  await fastify.register(onboardingRoutes, { prefix: '/api/onboarding' });
  await fastify.register(noteRoutes, { prefix: '/api' });
}
