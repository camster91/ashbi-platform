import workspaceAccountManagerRoutes from '../../routes/workspace-account-manager.routes.js';
import staffHandoffRoutes from '../../routes/portal-handoff.routes.js';
import clientAgentActionRoutes from '../../routes/client-agent-action.routes.js';
import brandRoutes from '../../routes/brand.routes.js';
import timeTrackingRoutes from '../../routes/time-tracking.routes.js';
import timeSessionRoutes from '../../routes/time-sessions.routes.js';
import creativeBriefRoutes from '../../routes/creative-brief.routes.js';
import assetLibraryRoutes from '../../routes/asset-library.routes.js';
import templateRoutes from '../../routes/template.routes.js';
import portalRoutes from '../../routes/portal.routes.js';
import onboardingRoutes from '../../routes/onboarding.routes.js';
import noteRoutes from '../../routes/note.routes.js';
import documentHistoryRoutes from '../../routes/document-history.routes.js';
import workspaceWikiRoutes from '../../routes/workspace-wiki.routes.js';
import workspaceRecordsRoutes from '../../routes/workspace-records.routes.js';
import workspaceChatRoutes from '../../routes/workspace-chat.routes.js';
import clientCommunicationsRoutes from '../../routes/client-communications.routes.js';

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
  await fastify.register(assetLibraryRoutes, { prefix: '/api/assets' });
  await fastify.register(templateRoutes, { prefix: '/api/templates' });
  await fastify.register(portalRoutes, { prefix: '/api/portal' });
  await fastify.register(onboardingRoutes, { prefix: '/api/onboarding' });
  await fastify.register(noteRoutes, { prefix: '/api' });
  await fastify.register(documentHistoryRoutes, { prefix: '/api/document-history' });
  await fastify.register(workspaceWikiRoutes, { prefix: '/api/wiki' });
  await fastify.register(workspaceRecordsRoutes, { prefix: '/api/collections' });
  await fastify.register(workspaceAccountManagerRoutes, { prefix: '/api/workspace-chat' });
  await fastify.register(staffHandoffRoutes, { prefix: '/api/portal-handoffs' });
  await fastify.register(workspaceChatRoutes, { prefix: '/api/workspace-chat' });
  await fastify.register(clientAgentActionRoutes, { prefix: '/api/clients' });
  await fastify.register(clientCommunicationsRoutes, { prefix: '/api/client-communications' });
}
