// Thread routes

import { prisma } from '../index.js';
import { analyzeMessage } from '../services/pipeline.service.js';
import { assignThread } from '../services/assignment.service.js';
import { queueEmbedding } from '../jobs/queue.js';

export default async function threadRoutes(fastify) {
  // List threads with filters
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const {
      status,
      priority,
      clientId,
      projectId,
      assignedToId,
      page: pageParam = '1',
      limit: limitParam = '20'
    } = request.query;

    const page = parseInt(pageParam);
    const limit = parseInt(limitParam);

    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;

    // Team members only see assigned threads
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
            take: 1
          },
          _count: { select: { messages: true, responses: true } }
        },
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.thread.count({ where })
    ]);

    return {
      threads,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  });

  // Create new outbound thread (for drafting client communications)
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { subject, clientId, projectId, priority, assignedToId } = request.body;

    if (!subject || !clientId) {
      return reply.status(400).send({ error: 'subject and clientId are required' });
    }

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    const thread = await prisma.thread.create({
      data: {
        subject,
        status: 'DRAFT',
        priority: priority || 'NORMAL',
        clientId,
        projectId: projectId || null,
        assignedToId: assignedToId || request.user.id,
        lastActivityAt: new Date()
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } }
      }
    });

    // Auto-embed thread for Client Brain
    queueEmbedding(clientId, `Thread: ${subject}`, 'THREAD', thread.id, { subject }).catch(err =>
      console.error('Failed to queue thread embedding:', err.message)
    );

    return reply.status(201).send(thread);
  });

  // Get single thread with full history
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const thread = await prisma.thread.findUnique({
      where: { id },
      include: {
        client: true,
        project: { select: { id: true, name: true, aiSummary: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { receivedAt: 'asc' }
        },
        responses: {
          include: {
            draftedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'desc' }
        },
        internalNotes: {
          include: {
            author: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    // Parse AI analysis
    return {
      ...thread,
      aiAnalysis: thread.aiAnalysis ? JSON.parse(thread.aiAnalysis) : null
    };
  });

  // Update thread
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, priority, projectId, clientId } = request.body;

    const data = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;
    if (projectId !== undefined) data.projectId = projectId;
    if (clientId !== undefined) data.clientId = clientId;

    const thread = await prisma.thread.update({
      where: { id },
      data
    });

    return thread;
  });

  // Assign thread to user
  fastify.post('/:id/assign', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId, autoAssign } = request.body;

    let assigneeId = userId;

    // Auto-assign using algorithm
    if (autoAssign) {
      const thread = await prisma.thread.findUnique({
        where: { id },
        include: { project: true }
      });

      const assignment = await assignThread(thread);
      assigneeId = assignment.userId;
    }

    const thread = await prisma.thread.update({
      where: { id },
      data: { assignedToId: assigneeId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } }
      }
    });

    // Notify assigned user
    if (assigneeId) {
      await prisma.notification.create({
        data: {
          type: 'THREAD_ASSIGNED',
          title: 'New thread assigned',
          message: `You have been assigned: ${thread.subject}`,
          data: JSON.stringify({ threadId: id }),
          userId: assigneeId
        }
      });

      fastify.notify(assigneeId, 'THREAD_ASSIGNED', { threadId: id });
    }

    return thread;
  });

  // Snooze thread
  fastify.post('/:id/snooze', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { until } = request.body;

    const thread = await prisma.thread.update({
      where: { id },
      data: {
        status: 'SNOOZED',
        snoozedUntil: new Date(until)
      }
    });

    return thread;
  });

  // Resolve thread
  fastify.post('/:id/resolve', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const thread = await prisma.thread.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        snoozedUntil: null
      }
    });

    return thread;
  });

  // Add message to thread (manual)
  fastify.post('/:id/messages', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { direction, senderEmail, senderName, subject, bodyText, bodyHtml } = request.body;

    const message = await prisma.message.create({
      data: {
        direction,
        senderEmail,
        senderName,
        subject,
        bodyText,
        bodyHtml,
        threadId: id,
        receivedAt: new Date(),
        processedAt: new Date()
      }
    });

    // Update thread activity
    await prisma.thread.update({
      where: { id },
      data: {
        lastActivityAt: new Date(),
        status: direction === 'INBOUND' ? 'AWAITING_RESPONSE' : 'OPEN'
      }
    });

    // Auto-embed message content for Client Brain
    if (bodyText) {
      const thread = await prisma.thread.findUnique({ where: { id }, select: { clientId: true } });
      if (thread?.clientId) {
        queueEmbedding(thread.clientId, bodyText.substring(0, 2000), 'THREAD', id, { type: 'message' }).catch(err =>
          console.error('Failed to queue message embedding:', err.message)
        );
      }
    }

    return reply.status(201).send(message);
  });

  // Re-analyze thread with AI
  fastify.post('/:id/analyze', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const thread = await prisma.thread.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { receivedAt: 'desc' }, take: 1 },
        project: true
      }
    });

    if (!thread || !thread.messages[0]) {
      return reply.status(404).send({ error: 'Thread or message not found' });
    }

    const analysis = await analyzeMessage(thread.messages[0], thread, thread.project);

    // Update thread with new analysis
    await prisma.thread.update({
      where: { id },
      data: {
        aiAnalysis: JSON.stringify(analysis),
        intent: analysis.intent,
        sentiment: analysis.sentiment,
        priority: analysis.urgency,
        urgencyReason: analysis.urgencyReason
      }
    });

    return { success: true, analysis };
  });

  // Add internal note
  fastify.post('/:id/notes', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { content } = request.body;

    const note = await prisma.internalNote.create({
      data: {
        content,
        threadId: id,
        authorId: request.user.id
      },
      include: {
        author: { select: { id: true, name: true } }
      }
    });

    return reply.status(201).send(note);
  });
}
