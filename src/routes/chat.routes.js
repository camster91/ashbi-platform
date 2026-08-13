// Project Chat routes - Real-time team messaging

import { validateBody, chatMessageCreateSchema, chatMessageUpdateSchema, chatReactionCreateSchema } from '../validators/schemas.js';

export default async function chatRoutes(fastify) {
  // Get chat messages for a project (paginated)
  fastify.get('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const { limit: limitParam = '50', before, after } = request.query;
    const limit = parseInt(limitParam);

    const where = { projectId };

    // Cursor-based pagination
    if (before) {
      where.createdAt = { lt: new Date(before) };
    } else if (after) {
      where.createdAt = { gt: new Date(after) };
    }

    const messages = await request.prisma.chatMessage.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, email: true } },
        reactions: {
          include: { user: { select: { id: true, name: true } } }
        },
        replies: {
          where: { projectId },
          include: {
            author: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    // Parse metadata JSON
    return messages.reverse().map(m => ({
      ...m,
      metadata: m.metadata ? JSON.parse(m.metadata) : null
    }));
  });

  // Send a chat message
  fastify.post('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatMessageCreateSchema),
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { content, type = 'TEXT', metadata, parentId } = request.body;

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Message content is required' });
    }
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (parentId) {
      const parent = await request.prisma.chatMessage.findFirst({
        where: { id: parentId, projectId },
        select: { id: true },
      });
      if (!parent) return reply.status(409).send({ error: 'Reply parent must belong to the same project' });
    }

    // Extract mentions from content (@username)
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    const message = await request.prisma.chatMessage.create({
      data: {
        content,
        type,
        metadata: metadata ? JSON.stringify(metadata) : null,
        parentId,
        projectId,
        authorId: request.user.id
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        reactions: true,
        replies: true
      }
    });

    // Log activity
    await request.prisma.activity.create({
      data: {
        type: 'CHAT_MESSAGE',
        action: 'created',
        entityType: 'CHAT',
        entityId: message.id,
        entityName: content.substring(0, 50),
        projectId,
        userId: request.user.id
      }
    });

    // Notify mentioned users
    if (mentions.length > 0) {
      const mentionedUsers = await request.prisma.user.findMany({
        where: { name: { in: mentions }, isActive: true }
      });

      for (const user of mentionedUsers) {
        if (user.id !== request.user.id) {
          await request.prisma.notification.create({
            data: {
              type: 'MENTION',
              title: 'You were mentioned',
              message: `${request.user.name} mentioned you in a chat message`,
              data: JSON.stringify({ projectId, messageId: message.id }),
              userId: user.id
            }
          });
          fastify.notify(user.id, 'MENTION', { projectId, messageId: message.id });
        }
      }
    }

    // Broadcast to project room
    fastify.io.to(`project:${projectId}`).emit('chat:message', {
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    });

    return reply.status(201).send({
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    });
  });

  // Edit a message
  fastify.put('/projects/:projectId/messages/:messageId', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatMessageUpdateSchema),
  }, async (request, reply) => {
    const { projectId, messageId } = request.params;
    const { content } = request.body;

    const existing = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId } });

    if (!existing) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    if (existing.authorId !== request.user.id) {
      return reply.status(403).send({ error: 'Can only edit your own messages' });
    }

    const message = await request.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content,
        isEdited: true,
        editedAt: new Date()
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        reactions: true
      }
    });

    // Broadcast edit
    fastify.io.to(`project:${projectId}`).emit('chat:edited', message);

    return message;
  });

  // Delete a message
  fastify.delete('/projects/:projectId/messages/:messageId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, messageId } = request.params;

    const existing = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId } });

    if (!existing) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    // Only author or admin can delete
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this message' });
    }

    await request.prisma.chatMessage.delete({ where: { id: messageId } });

    // Broadcast deletion
    fastify.io.to(`project:${projectId}`).emit('chat:deleted', { messageId });

    return { success: true };
  });

  // Add reaction to message
  fastify.post('/projects/:projectId/messages/:messageId/reactions', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatReactionCreateSchema),
  }, async (request, reply) => {
    const { projectId, messageId } = request.params;
    const { emoji } = request.body;

    if (!emoji) {
      return reply.status(400).send({ error: 'Emoji is required' });
    }

    const message = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId }, select: { id: true } });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    // Check if reaction already exists
    const existing = await request.prisma.chatReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: request.user.id,
          emoji
        }
      }
    });

    if (existing) {
      return reply.status(400).send({ error: 'Reaction already exists' });
    }

    const reaction = await request.prisma.chatReaction.create({
      data: {
        emoji,
        messageId,
        userId: request.user.id
      },
      include: {
        user: { select: { id: true, name: true } }
      }
    });

    // Broadcast reaction
    fastify.io.to(`project:${projectId}`).emit('chat:reaction', {
      action: 'added',
      messageId,
      reaction
    });

    return reply.status(201).send(reaction);
  });

  // Remove reaction
  fastify.delete('/projects/:projectId/messages/:messageId/reactions/:emoji', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, messageId, emoji } = request.params;
    const message = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId }, select: { id: true } });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    await request.prisma.chatReaction.deleteMany({
      where: {
        messageId,
        userId: request.user.id,
        emoji: decodeURIComponent(emoji)
      }
    });

    // Broadcast removal
    fastify.io.to(`project:${projectId}`).emit('chat:reaction', {
      action: 'removed',
      messageId,
      emoji: decodeURIComponent(emoji),
      userId: request.user.id
    });

    return { success: true };
  });

  // Typing indicator (handled via Socket.io in index.js)
}
