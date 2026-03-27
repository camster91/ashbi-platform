// Inbox routes

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';

export default async function inboxRoutes(fastify) {
  // Get inbox (all threads with filters)
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const {
      status,
      priority,
      clientId,
      assignedToId,
      needsTriage,
      page: pageParam = '1',
      limit: limitParam = '20'
    } = request.query;

    const page = Math.max(1, parseInt(pageParam) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam) || 20));

    const where = {};

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (clientId) where.clientId = clientId;
    if (needsTriage === 'true') where.needsTriage = true;

    // Team members only see their assigned threads
    if (request.user.role !== 'ADMIN') {
      where.assignedToId = request.user.id;
    } else if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          messages: {
            orderBy: { receivedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              senderEmail: true,
              senderName: true,
              bodyText: true,
              receivedAt: true
            }
          },
          _count: {
            select: {
              messages: true,
              responses: true
            }
          }
        },
        orderBy: [
          { priority: 'asc' }, // CRITICAL first
          { lastActivityAt: 'desc' }
        ],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.thread.count({ where })
    ]);

    return {
      threads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  });

  // Get unmatched emails
  fastify.get('/unmatched', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const unmatched = await prisma.unmatchedEmail.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });

    return unmatched.map(email => ({
      ...email,
      suggestedClients: safeParse(email.suggestedClients, []),
      suggestedProjects: safeParse(email.suggestedProjects, [])
    }));
  });

  // Assign unmatched email to client/project
  fastify.post('/unmatched/:id/assign', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { clientId, projectId, createNewClient } = request.body;

    const unmatched = await prisma.unmatchedEmail.findUnique({
      where: { id }
    });

    if (!unmatched) {
      return reply.status(404).send({ error: 'Unmatched email not found' });
    }

    let targetClientId = clientId;

    // Create new client if requested
    if (createNewClient) {
      const domain = unmatched.senderEmail.split('@')[1];
      const client = await prisma.client.create({
        data: {
          name: createNewClient.name || domain,
          domain
        }
      });
      targetClientId = client.id;

      // Create contact
      await prisma.contact.create({
        data: {
          email: unmatched.senderEmail,
          name: unmatched.senderName || unmatched.senderEmail.split('@')[0],
          clientId: client.id,
          isPrimary: true
        }
      });
    }

    // Create thread from unmatched email
    const thread = await prisma.thread.create({
      data: {
        subject: unmatched.subject,
        clientId: targetClientId,
        projectId,
        status: 'OPEN',
        priority: 'NORMAL',
        messages: {
          create: {
            direction: 'INBOUND',
            senderEmail: unmatched.senderEmail,
            senderName: unmatched.senderName,
            subject: unmatched.subject,
            bodyText: unmatched.bodyText,
            bodyHtml: unmatched.bodyHtml,
            rawEmail: unmatched.rawEmail,
            receivedAt: unmatched.createdAt
          }
        }
      }
    });

    // Mark unmatched as resolved
    await prisma.unmatchedEmail.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date()
      }
    });

    return { success: true, threadId: thread.id };
  });

  // Ignore unmatched email
  fastify.post('/unmatched/:id/ignore', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    await prisma.unmatchedEmail.update({
      where: { id },
      data: {
        status: 'IGNORED',
        resolvedAt: new Date()
      }
    });

    return { success: true };
  });

  // Get inbox stats
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const where = request.user.role !== 'ADMIN'
      ? { assignedToId: request.user.id }
      : {};

    const [
      total,
      needsResponse,
      needsTriage,
      critical,
      pendingApproval
    ] = await Promise.all([
      prisma.thread.count({ where: { ...where, status: { not: 'RESOLVED' } } }),
      prisma.thread.count({ where: { ...where, status: 'AWAITING_RESPONSE' } }),
      prisma.thread.count({ where: { ...where, needsTriage: true } }),
      prisma.thread.count({ where: { ...where, priority: 'CRITICAL', status: { not: 'RESOLVED' } } }),
      prisma.response.count({ where: { status: 'PENDING_APPROVAL' } })
    ]);

    return {
      total,
      needsResponse,
      needsTriage,
      critical,
      pendingApproval
    };
  });
}
