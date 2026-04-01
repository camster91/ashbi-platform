// Response routes (drafts and approvals)

import { prisma } from '../index.js';

export default async function responseRoutes(fastify) {
  // Get all pending approval responses (admin only)
  fastify.get('/pending', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const responses = await prisma.response.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: {
        thread: {
          include: {
            client: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } }
          }
        },
        draftedBy: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    return responses.map(r => ({
      ...r,
      aiOptions: r.aiOptions ? JSON.parse(r.aiOptions) : null
    }));
  });

  // Create draft response for thread
  fastify.post('/:threadId/drafts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { threadId } = request.params;
    const { subject, body, tone, aiGenerated = false, aiOptions } = request.body;

    const response = await prisma.response.create({
      data: {
        subject,
        body,
        tone,
        aiGenerated,
        aiOptions: aiOptions ? JSON.stringify(aiOptions) : null,
        status: 'DRAFT',
        threadId,
        draftedById: request.user.id
      }
    });

    return reply.status(201).send(response);
  });

  // Get single response
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const response = await prisma.response.findUnique({
      where: { id },
      include: {
        thread: {
          include: {
            client: true,
            messages: { orderBy: { receivedAt: 'desc' }, take: 1 }
          }
        },
        draftedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } }
      }
    });

    if (!response) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    return {
      ...response,
      aiOptions: response.aiOptions ? JSON.parse(response.aiOptions) : null
    };
  });

  // Update response draft
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { subject, body, tone } = request.body;

    const existing = await prisma.response.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    // Only allow editing drafts or rejected responses
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      return reply.status(400).send({ error: 'Cannot edit response in current status' });
    }

    const response = await prisma.response.update({
      where: { id },
      data: {
        subject,
        body,
        tone,
        status: 'DRAFT',
        rejectionReason: null
      }
    });

    return response;
  });

  // Submit response for approval
  fastify.post('/:id/submit', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.response.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      return reply.status(400).send({ error: 'Response already submitted' });
    }

    const response = await prisma.response.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
      include: { thread: true }
    });

    // Notify admins
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true }
    });

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          type: 'RESPONSE_PENDING',
          title: 'Response needs approval',
          message: `A response to "${response.thread.subject}" is pending approval`,
          data: JSON.stringify({ responseId: id, threadId: response.threadId }),
          userId: admin.id
        }
      });

      fastify.notify(admin.id, 'RESPONSE_PENDING', { responseId: id });
    }

    return response;
  });

  // Approve response (admin only)
  fastify.post('/:id/approve', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.response.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    if (existing.status !== 'PENDING_APPROVAL') {
      return reply.status(400).send({ error: 'Response not pending approval' });
    }

    const response = await prisma.response.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: request.user.id,
        approvedAt: new Date()
      },
      include: {
        thread: true,
        draftedBy: { select: { id: true, name: true, email: true } }
      }
    });

    // Notify the drafter
    await prisma.notification.create({
      data: {
        type: 'RESPONSE_APPROVED',
        title: 'Response approved',
        message: `Your response to "${response.thread.subject}" has been approved`,
        data: JSON.stringify({ responseId: id, threadId: response.threadId }),
        userId: response.draftedBy.id
      }
    });

    fastify.notify(response.draftedBy.id, 'RESPONSE_APPROVED', { responseId: id });

    return response;
  });

  // Reject response (admin only)
  fastify.post('/:id/reject', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    const existing = await prisma.response.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    if (existing.status !== 'PENDING_APPROVAL') {
      return reply.status(400).send({ error: 'Response not pending approval' });
    }

    const response = await prisma.response.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason
      },
      include: {
        thread: true,
        draftedBy: { select: { id: true, name: true } }
      }
    });

    // Notify the drafter
    await prisma.notification.create({
      data: {
        type: 'RESPONSE_REJECTED',
        title: 'Response needs revision',
        message: `Your response to "${response.thread.subject}" was returned: ${reason}`,
        data: JSON.stringify({ responseId: id, threadId: response.threadId }),
        userId: response.draftedBy.id
      }
    });

    fastify.notify(response.draftedBy.id, 'RESPONSE_REJECTED', { responseId: id });

    return response;
  });

  // Mark response as sent
  fastify.post('/:id/sent', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.response.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Response not found' });
    }

    if (existing.status !== 'APPROVED') {
      return reply.status(400).send({ error: 'Response not approved' });
    }

    const response = await prisma.response.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date()
      }
    });

    // Update thread status
    await prisma.thread.update({
      where: { id: response.threadId },
      data: {
        status: 'OPEN',
        lastActivityAt: new Date()
      }
    });

    return response;
  });
}
