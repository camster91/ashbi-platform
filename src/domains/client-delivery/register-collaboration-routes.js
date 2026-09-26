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
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerCollaborationRoutes(fastify) {
  await fastify.register(messageRoutes, { prefix: '/api/messages' });
  await fastify.register(revisionRoutes, { prefix: '/api/revisions' });
  await fastify.register(calendarRoutes, { prefix: '/api/calendar' });
  await fastify.register(commentRoutes, { prefix: '/api/comments' });
  await fastify.register(attachmentRoutes, { prefix: '/api/attachments' });
  await fastify.register(timeRoutes, { prefix: '/api/time' });
  await fastify.register(milestoneRoutes, { prefix: '/api/milestones' });
  // Media review (#417): the staff API, and the public share-link API under
  // the tenancy-exempt /api/portal prefix (docs/media-review.md).
  await fastify.register(reviewRoutes, { prefix: '/api/reviews' });
  await fastify.register(reviewPortalRoutes, { prefix: '/api/portal/review' });
}
