// Frontend-accessible approval routes (uses fastify.authenticate + adminOnly)
import { validateBody, patchApprovalSchema, validateParams } from '../validators/schemas.js';
import cuid2 from '../utils/safeParse.js'; // for cuid validation

const cuidId = { type: 'string', minLength: 1, maxLength: 50 };

export default async function approvalRoutes(fastify) {
  // GET /api/approvals
  fastify.get('/approvals', { onRequest: [fastify.authenticate] }, async (request) => {
    const { status, type, limit = 50, offset = 0 } = request.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (type) where.type = type.toUpperCase();
    const [approvals, total] = await Promise.all([
      fastify.prisma.approval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      fastify.prisma.approval.count({ where }),
    ]);
    return { approvals, total };
  });

  // GET /api/approvals/pending-count
  fastify.get('/approvals/pending-count', { onRequest: [fastify.authenticate] }, async () => {
    const count = await fastify.prisma.approval.count({ where: { status: 'PENDING' } });
    return { count };
  });

  // GET /api/approvals/:id
  fastify.get('/approvals/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    const approval = await fastify.prisma.approval.findUnique({
      where: { id },
    });
    if (!approval) return reply.status(404).send({ error: 'Not found' });
    return approval;
  });

  // PATCH /api/approvals/:id — admin approves/rejects
  fastify.patch('/approvals/:id', {
    onRequest: [fastify.authenticate, fastify.adminOnly],
    preHandler: [validateBody(patchApprovalSchema)],
  }, async (request, reply) => {
    const { status, reviewNote } = request.body;
    const { id } = request.params;

    const approval = await fastify.prisma.approval.update({
      where: { id },
      data: {
        status,
        reviewNote: reviewNote || null,
        reviewedBy: request.user.email,
        reviewedAt: new Date(),
      },
    });
    return approval;
  });
}