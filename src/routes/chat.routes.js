// Project Chat routes - Real-time team messaging
//
// Visibility (C3): INTERNAL messages are staff-only team chat and are only
// broadcast to the internal `project:{id}` room. CLIENT messages are part of
// the client-portal conversation ("Visible to client"); they are broadcast to
// staff and, in the client shape, to `project:{id}:client`. A reply under an
// INTERNAL message is always INTERNAL; a reply under a CLIENT message keeps
// the visibility its author chose (INTERNAL by default), so a staff aside in
// a client thread is never silently shown to the client.

import {
  validateBody,
  validateQuery,
  chatMessageCreateSchema,
  chatMessageListQuerySchema,
  chatMessageUpdateSchema,
  chatReactionCreateSchema,
} from '../validators/schemas.js';
import { safeParse } from '../utils/safeParse.js';
import { emitChatEvent, mayNotifyMention, projectRoom, toClientChatPayload } from '../auth/project-room-access.js';
import {
  CHAT_ATTACHMENT_ENTITY,
  CHAT_PENDING_ENTITY,
  MAX_PENDING_CHAT_UPLOADS_PER_UPLOADER,
  claimPendingChatAttachments,
  loadChatAttachments,
  messageIdsOf,
  normaliseAttachmentIds,
  sendChatAttachmentError,
  storeValidatedUpload,
  toStaffAttachmentPayload,
  unlinkStoredUpload,
  withAttachments,
} from '../services/chat-attachment.service.js';

/**
 * A tombstoned message (deleted while it still had replies) keeps its place
 * in the thread but none of its content.
 *
 * @param {Record<string, any>} message
 */
function presentMessage(message) {
  const presented = { ...message, metadata: safeParse(message.metadata) };
  if (Array.isArray(message.attachments)) presented.attachments = message.attachments.map(toStaffAttachmentPayload);
  if (message.removedAt) {
    presented.content = '';
    presented.metadata = null;
    presented.reactions = [];
    presented.attachments = [];
  }
  if (Array.isArray(message.replies)) presented.replies = message.replies.map(presentMessage);
  return presented;
}

/**
 * A message row with its (and its replies') attachments, loaded in one query.
 * @param {any} prisma
 * @param {any[]} messages
 */
async function attachFiles(prisma, messages) {
  return withAttachments(messages, await loadChatAttachments(prisma, messageIdsOf(messages)));
}


export default async function chatRoutes(fastify) {
  // Threads for a project: the top-level messages whose thread (the message
  // or one of its replies) was most recently active, returned oldest-first by
  // that activity, each with all its replies nested (replies are one level).
  // Paging by activity keeps a thread with a new reply visible even when its
  // first message is older than the page.
  fastify.get('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate],
    preHandler: validateQuery(chatMessageListQuerySchema),
  }, async (request) => {
    const { projectId } = request.params;
    const { limit, before, after } = request.query;

    const activityWhere = { projectId };
    if (before) {
      activityWhere.createdAt = { lt: new Date(before) };
    } else if (after) {
      activityWhere.createdAt = { gt: new Date(after) };
    }

    const recent = await request.prisma.chatMessage.findMany({
      where: activityWhere,
      select: { id: true, parentId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const lastActivity = new Map();
    for (const row of recent) {
      const rootId = row.parentId ?? row.id;
      if (!lastActivity.has(rootId)) lastActivity.set(rootId, row.createdAt);
    }
    if (lastActivity.size === 0) return [];

    const threads = await request.prisma.chatMessage.findMany({
      where: { projectId, parentId: null, id: { in: [...lastActivity.keys()] } },
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
    });

    const ordered = threads.sort((a, b) => new Date(lastActivity.get(a.id)) - new Date(lastActivity.get(b.id)));
    // Files of every thread on the page and of all their replies in one query.
    return (await attachFiles(request.prisma, ordered)).map(presentMessage);
  });

  // Upload one file for a message that is still being written (docs/chat-media.md).
  // The file is stored as a pending chat upload of this project owned by the
  // uploader; POST /messages claims it with `attachmentIds`. Unsent uploads
  // are purged after 24 hours.
  fastify.post('/projects/:projectId/uploads', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { projectId } = request.params;
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true, organizationId: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const pending = await request.prisma.attachment.count({
      where: { entityType: CHAT_PENDING_ENTITY, entityId: projectId, uploadedById: request.user.id },
    });
    if (pending >= MAX_PENDING_CHAT_UPLOADS_PER_UPLOADER) {
      return reply.status(409).send({ error: 'Too many unsent attachments. Send or remove some first.', code: 'TOO_MANY_PENDING_UPLOADS' });
    }

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });
    const { stored, error } = await storeValidatedUpload(data);
    if (error) return reply.status(400).send({ error });

    const attachment = await request.prisma.attachment.create({
      data: {
        ...stored,
        entityType: CHAT_PENDING_ENTITY,
        entityId: projectId,
        uploadedById: request.user.id,
        organizationId: project.organizationId,
      },
    });
    return reply.status(201).send(toStaffAttachmentPayload(attachment));
  });

  // Remove one of your own unsent uploads (the composer's "remove" button).
  fastify.delete('/projects/:projectId/uploads/:attachmentId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { projectId, attachmentId } = request.params;
    const existing = await request.prisma.attachment.findFirst({
      where: { id: attachmentId, entityType: CHAT_PENDING_ENTITY, entityId: projectId, uploadedById: request.user.id },
      select: { id: true, path: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Pending upload not found' });
    const deleted = await request.prisma.attachment.deleteMany({ where: { id: existing.id, entityType: CHAT_PENDING_ENTITY } });
    if (deleted.count === 1) await unlinkStoredUpload(existing.path);
    return { success: true };
  });

  // Send a chat message
  fastify.post('/projects/:projectId/messages', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(chatMessageCreateSchema),
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { content = '', type = 'TEXT', metadata, parentId } = request.body;
    let visibility = request.body.visibility ?? 'INTERNAL';
    let threadParentId = null;
    let attachmentIds;
    try {
      attachmentIds = normaliseAttachmentIds(request.body.attachmentIds);
    } catch (err) {
      return sendChatAttachmentError(reply, err);
    }

    if (!content.trim() && attachmentIds.length === 0) {
      return reply.status(400).send({ error: 'Message content is required' });
    }
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true, clientId: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (parentId) {
      const parent = await request.prisma.chatMessage.findFirst({
        where: { id: parentId, projectId },
        select: { id: true, visibility: true, parentId: true },
      });
      if (!parent) return reply.status(409).send({ error: 'Reply parent must belong to the same project' });
      // Replies are one level deep: a reply to a reply joins its thread.
      const root = parent.parentId
        ? await request.prisma.chatMessage.findFirst({ where: { id: parent.parentId, projectId }, select: { id: true, visibility: true } })
        : parent;
      if (!root) return reply.status(409).send({ error: 'Reply parent must belong to the same project' });
      threadParentId = root.id;
      // A reply to internal chat can never leak to the client. A reply in the
      // client conversation keeps the requested visibility (never promoted).
      if ((parent.visibility ?? 'INTERNAL') !== 'CLIENT' || (root.visibility ?? 'INTERNAL') !== 'CLIENT') visibility = 'INTERNAL';
    }

    // Extract mentions from content (@username)
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    // One transaction: the message and the claim of its pending uploads
    // commit together, or neither does (a file that is no longer pending
    // rolls the message back; docs/chat-media.md).
    let created;
    try {
      created = await request.prisma.$transaction(async (tx) => {
        const row = await tx.chatMessage.create({
          data: {
            content,
            type,
            visibility,
            metadata: metadata ? JSON.stringify(metadata) : null,
            parentId: threadParentId,
            projectId,
            authorId: request.user.id
          },
          include: {
            author: { select: { id: true, name: true, email: true } },
            reactions: true,
            replies: true
          }
        });
        await claimPendingChatAttachments(tx, { attachmentIds, projectId, uploadedById: request.user.id, messageId: row.id });
        return row;
      });
    } catch (err) {
      return sendChatAttachmentError(reply, err);
    }
    const [message] = await attachFiles(request.prisma, [created]);

    // Log activity
    await request.prisma.activity.create({
      data: {
        type: 'CHAT_MESSAGE',
        action: 'created',
        entityType: 'CHAT',
        entityId: message.id,
        entityName: (content.trim() || `${attachmentIds.length} attachment${attachmentIds.length === 1 ? '' : 's'}`).substring(0, 50),
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
        if (user.id !== request.user.id && mayNotifyMention(user, visibility, project)) {
          await fastify.notify(user.id, {
            type: 'MENTION',
            title: 'You were mentioned',
            message: `${request.user.name} mentioned you in a chat message`,
            data: { projectId, messageId: message.id },
          });
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

    const updated = await request.prisma.chatMessage.update({
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
    // The edit event replaces the message in open chats: keep its files.
    const [message] = await attachFiles(request.prisma, [updated]);

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

    // One transaction: the reply count, the tombstone and its reaction cleanup
    // (or the hard delete) commit together.
    // The message's files go with it (rows here, bytes after commit).
    const { tombstoned, files } = await request.prisma.$transaction(async (tx) => {
      const attached = await tx.attachment.findMany({
        where: { entityType: CHAT_ATTACHMENT_ENTITY, entityId: messageId },
        select: { id: true, path: true },
      });
      if (attached.length) await tx.attachment.deleteMany({ where: { id: { in: attached.map((file) => file.id) } } });
      const replyCount = await tx.chatMessage.count({ where: { parentId: messageId, projectId } });
      if (replyCount > 0) {
        await tx.chatMessage.update({
          where: { id: messageId },
          data: { content: '', metadata: null, removedAt: new Date() },
        });
        await tx.chatReaction.deleteMany({ where: { messageId } });
        return { tombstoned: true, files: attached };
      }
      await tx.chatMessage.delete({ where: { id: messageId } });
      return { tombstoned: false, files: attached };
    });
    for (const file of files) {
      await unlinkStoredUpload(file.path).catch((err) => request.log.warn({ err, attachmentId: file.id }, 'chat: attachment file not removed'));
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
