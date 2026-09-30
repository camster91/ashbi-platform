// Daily operator queue (#461) — read-only projection over tasks, approvals,
// media reviews, proposals, contracts and invoices. Every read goes through
// the request-scoped Prisma client; finance and approval rows are admin-only.
// See docs/operator-queue.md.
import { z } from 'zod';
import { validateQuery } from '../validators/schemas.js';
import { buildWorkQueue, WORK_QUEUE_STAFF_ROLES, WORK_QUEUE_VIEWS } from '../services/work-queue.service.js';

const recordId = z.string().trim().min(1).max(50);

export const workQueueQuerySchema = z.object({
  view: z.enum(/** @type {[string, ...string[]]} */ ([...WORK_QUEUE_VIEWS])).optional(),
  owner: z.enum(['me', 'everyone']).default('everyone'),
  clientId: recordId.optional(),
  projectId: recordId.optional(),
}).strict();

/** The queue is a staff workspace: bots and other principals are refused. */
async function requireQueueStaff(request, reply) {
  if (!WORK_QUEUE_STAFF_ROLES.includes(request.user?.role)) {
    return reply.status(403).send({ error: 'Staff access required' });
  }
  return undefined;
}

export default async function workQueueRoutes(fastify) {
  // GET /api/work-queue?view=&owner=&clientId=&projectId=
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireQueueStaff, validateQuery(workQueueQuerySchema)],
  }, async (request) => {
    return buildWorkQueue(request.prisma, {
      user: { id: request.user.id, role: request.user.role },
      filters: request.query,
    });
  });
}
