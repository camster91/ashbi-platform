import messageRoutes from '../../routes/message.routes.js';
import revisionRoutes from '../../routes/revision.routes.js';
import calendarRoutes from '../../routes/calendar.routes.js';
import commentRoutes from '../../routes/comment.routes.js';
import attachmentRoutes from '../../routes/attachment.routes.js';
import timeRoutes from '../../routes/time.routes.js';
import milestoneRoutes from '../../routes/milestone.routes.js';
import reviewRoutes from '../../routes/review.routes.js';
import reviewPortalRoutes from '../../routes/review-portal.routes.js';

/**
 * Register the contiguous project-collaboration route vertical.
 *
 * The sequence intentionally matches the pre-extraction application factory
 * so route precedence and Fastify plugin initialization remain unchanged.
 * Modules whose routes span several roots (revisions, comments, time entries,
 * milestones: e.g. /projects/:projectId/milestones and /milestones/:id) mount
 * at /api; a module prefix plus its own root segment produced unreachable
 * double-prefixed URLs such as /api/milestones/milestones/:id.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerCollaborationRoutes(fastify) {
  await fastify.register(messageRoutes, { prefix: '/api/messages' });
  await fastify.register(revisionRoutes, { prefix: '/api' });
  await fastify.register(calendarRoutes, { prefix: '/api/calendar' });
  await fastify.register(commentRoutes, { prefix: '/api' });
  await fastify.register(attachmentRoutes, { prefix: '/api/attachments' });
  await fastify.register(timeRoutes, { prefix: '/api' });
  await fastify.register(milestoneRoutes, { prefix: '/api' });
  // Media review (#417): the staff API, and the public share-link API under
  // the tenancy-exempt /api/portal prefix (docs/media-review.md).
  await fastify.register(reviewRoutes, { prefix: '/api/reviews' });
  await fastify.register(reviewPortalRoutes, { prefix: '/api/portal/review' });
}
