// Project Chat routes - Real-time team messaging
//
// Visibility (C3): INTERNAL messages are staff-only team chat and are only
// broadcast to the internal `project:{id}` room. CLIENT messages are part of
// the client-portal conversation ("Visible to client"); they are broadcast to
// staff and, in the client shape, to `project:{id}:client`. A reply always
// takes its parent's visibility.

import {
  validateBody,
  validateQuery,
  chatMessageCreateSchema,
  chatMessageListQuerySchema,
  chatMessageUpdateSchema,
  chatReactionCreateSchema,
} from '../validators/schemas.js';
import { safeParse } from '../utils/safeParse.js';
import { emitChatEvent, projectRoom, toClientChatPayload } from '../auth/project-room-access.js';

/**
 * A tombstoned message (deleted while it still had replies) keeps its place
 * in the thread but none of its content.
 *
 * @param {Record<string, any>} message
 */
function presentMessage(message) {
  const presented = { ...message, metadata: safeParse(message.metadata) };
  if (message.removedAt) {
    presented.content = '';
    presented.metadata = null;
    presented.reactions = [];
  }
  if (Array.isArray(message.replies)) presented.replies = message.replies.map(presentMessage);
  return presented;
}

export default async function chatRoutes(fastify) {
  // Top-level messages for a project (newest page, returned oldest-first),
  // each with its replies nested.
  fastify.get('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate],
    preHandler: validateQuery(chatMessageListQuerySchema),
  }, async (request) => {
    const { projectId } = request.params;
    const { limit, before, after } = request.query;

    const where = { projectId, parentId: null };

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

    return messages.reverse().map(presentMessage);
  });

  // Send a chat message
  fastify.post('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatMessageCreateSchema),
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { content, type = 'TEXT', metadata, parentId } = request.body;
    let visibility = request.body.visibility ?? 'INTERNAL';

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Message content is required' });
    }
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (parentId) {
      const parent = await request.prisma.chatMessage.findFirst({
        where: { id: parentId, projectId },
        select: { id: true, visibility: true },
      });
      if (!parent) return reply.status(409).send({ error: 'Reply parent must belong to the same project' });
      // A reply to internal chat can never leak to the client (and a reply to
      // the client conversation stays in it).
      visibility = parent.visibility ?? 'INTERNAL';
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
        visibility,
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

    const presented = presentMessage(message);
    emitChatEvent(fastify.io, message, 'chat:message', presented, toClientChatPayload(message));

    return reply.status(201).send(presented);
  });

  // Edit a message
  fastify.put('/projects/:projectId/messages/:messageId', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatMessageUpdateSchema),
  }, async (request, reply) => {
    const { projectId, messageId } = request.params;
    const { content } = request.body;

    const existing = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId } });

    if (!existing || existing.removedAt) {
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

    const presented = presentMessage(message);
    emitChatEvent(fastify.io, message, 'chat:edited', presented, toClientChatPayload(message));

    return presented;
  });

  // Delete a message. A message that has replies becomes a tombstone (its
  // content is cleared, the thread stays); others are removed outright. The
  // reply foreign key is ON DELETE NO ACTION, so deleting a parent with
  // replies used to fail with a 500.
  fastify.delete('/projects/:projectId/messages/:messageId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, messageId } = request.params;

    const existing = await request.prisma.chatMessage.findFirst({ where: { id: messageId, projectId } });

    if (!existing || existing.removedAt) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    // Only author or admin can delete
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this message' });
    }

    const replyCount = await request.prisma.chatMessage.count({ where: { parentId: messageId, projectId } });
    const tombstoned = replyCount > 0;
    if (tombstoned) {
      await request.prisma.chatMessage.update({
        where: { id: messageId },
        data: { content: '', metadata: null, removedAt: new Date() },
      });
      await request.prisma.chatReaction.deleteMany({ where: { messageId } });
    } else {
      await request.prisma.chatMessage.delete({ where: { id: messageId } });
    }

    const payload = { messageId, tombstoned };
    emitChatEvent(fastify.io, existing, 'chat:deleted', payload, payload);

    return { success: true, tombstoned };
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

    // Reactions are a staff-side affordance: internal room only.
    fastify.io.to(projectRoom(projectId)).emit('chat:reaction', {
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

    fastify.io.to(projectRoom(projectId)).emit('chat:reaction', {
      action: 'removed',
      messageId,
      emoji: decodeURIComponent(emoji),
      userId: request.user.id
    });

    return { success: true };
  });

  // Typing indicator (handled via Socket.io in index.js)
}
