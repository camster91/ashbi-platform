import dashboardRoutes from '../../routes/dashboard.routes.js';
import notificationRoutes from '../../routes/notification.routes.js';
import realtimeRoutes from '../../routes/realtime.routes.js';
import pushRoutes from '../../routes/push.routes.js';
import trashRoutes from '../../routes/trash.routes.js';
import draftRoutes from '../../routes/draft.routes.js';
import searchRoutes from '../../routes/search.routes.js';

/**
 * Register cross-cutting platform routes: dashboard, notifications, realtime,
 * web push, trash, drafts, and global search.
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerPlatformRoutes(fastify) {
  await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(realtimeRoutes, { prefix: '/api/realtime' });
  await fastify.register(pushRoutes, { prefix: '/api/push' });
  await fastify.register(trashRoutes, { prefix: '/api/trash' });
  await fastify.register(draftRoutes, { prefix: '/api/draft' });
  await fastify.register(searchRoutes, { prefix: '/api/search' });
}
