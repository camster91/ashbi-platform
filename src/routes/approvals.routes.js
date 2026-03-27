// Frontend-accessible approval routes (uses JWT auth, not bot secret)
export default async function approvalRoutes(fastify) {
  const requireAuth = async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  };

  // GET /api/approvals
  fastify.get('/approvals', { preHandler: requireAuth }, async (request) => {
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
  fastify.get('/approvals/pending-count', { preHandler: requireAuth }, async () => {
    const count = await fastify.prisma.approval.count({ where: { status: 'PENDING' } });
    return { count };
  });

  // GET /api/approvals/:id
  fastify.get('/approvals/:id', { preHandler: requireAuth }, async (request, reply) => {
    const approval = await fastify.prisma.approval.findUnique({
      where: { id: request.params.id },
    });
    if (!approval) return reply.status(404).send({ error: 'Not found' });
    return approval;
  });

  // PATCH /api/approvals/:id — Cameron approves/rejects
  fastify.patch('/approvals/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { status, reviewNote } = request.body || {};
    if (!status || !['APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      return reply.status(400).send({ error: 'status must be APPROVED or REJECTED' });
    }
    // Only admin can approve
    if (request.user?.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin only' });
    }
    const approval = await fastify.prisma.approval.update({
      where: { id: request.params.id },
      data: {
        status: status.toUpperCase(),
        reviewNote: reviewNote || null,
        reviewedBy: request.user.email,
        reviewedAt: new Date(),
      },
    });
    return approval;
  });
}
