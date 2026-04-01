// Task Comment routes with @mentions

import { prisma } from '../index.js';

export default async function commentRoutes(fastify) {
  // Get comments for a task
  fastify.get('/tasks/:taskId/comments', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { taskId } = request.params;

    const comments = await prisma.taskComment.findMany({
      where: { taskId },
      include: {
        author: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    return comments.map(c => ({
      ...c,
      mentions: JSON.parse(c.mentions)
    }));
  });

  // Add comment to task
  fastify.post('/tasks/:taskId/comments', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { taskId } = request.params;
    const { content } = request.body;

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Comment content is required' });
    }

    // Get task to verify it exists and get project
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, name: true } } }
    });

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Extract @mentions
    const mentionRegex = /@(\w+)/g;
    const mentionNames = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentionNames.push(match[1]);
    }

    // Find mentioned users
    const mentionedUsers = await prisma.user.findMany({
      where: {
        OR: mentionNames.map(name => ({ name: { contains: name } }))
      }
    });

    const mentionIds = mentionedUsers.map(u => u.id);

    const comment = await prisma.taskComment.create({
      data: {
        content,
        mentions: JSON.stringify(mentionIds),
        taskId,
        authorId: request.user.id
      },
      include: {
        author: { select: { id: true, name: true, email: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'TASK_COMMENTED',
        action: 'commented',
        entityType: 'TASK',
        entityId: taskId,
        entityName: task.title,
        metadata: JSON.stringify({ commentId: comment.id }),
        projectId: task.projectId,
        userId: request.user.id
      }
    });

    // Notify mentioned users
    for (const user of mentionedUsers) {
      if (user.id !== request.user.id) {
        await prisma.notification.create({
          data: {
            type: 'MENTION',
            title: 'You were mentioned in a comment',
            message: `${request.user.name} mentioned you in a comment on "${task.title}"`,
            data: JSON.stringify({
              taskId,
              commentId: comment.id,
              projectId: task.projectId
            }),
            userId: user.id
          }
        });

        fastify.notify(user.id, 'MENTION', {
          taskId,
          commentId: comment.id,
          projectId: task.projectId
        });
      }
    }

    // Notify task assignee if not the commenter
    if (task.assigneeId && task.assigneeId !== request.user.id && !mentionIds.includes(task.assigneeId)) {
      await prisma.notification.create({
        data: {
          type: 'TASK_COMMENT',
          title: 'New comment on your task',
          message: `${request.user.name} commented on "${task.title}"`,
          data: JSON.stringify({
            taskId,
            commentId: comment.id,
            projectId: task.projectId
          }),
          userId: task.assigneeId
        }
      });

      fastify.notify(task.assigneeId, 'TASK_COMMENT', {
        taskId,
        commentId: comment.id
      });
    }

    return reply.status(201).send({
      ...comment,
      mentions: mentionIds
    });
  });

  // Update comment
  fastify.put('/comments/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { content } = request.body;

    const existing = await prisma.taskComment.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Comment not found' });
    }

    if (existing.authorId !== request.user.id) {
      return reply.status(403).send({ error: 'Can only edit your own comments' });
    }

    // Re-extract mentions
    const mentionRegex = /@(\w+)/g;
    const mentionNames = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentionNames.push(match[1]);
    }

    const mentionedUsers = await prisma.user.findMany({
      where: {
        OR: mentionNames.length > 0
          ? mentionNames.map(name => ({ name: { contains: name } }))
          : [{ id: 'none' }]
      }
    });

    const mentionIds = mentionedUsers.map(u => u.id);

    const comment = await prisma.taskComment.update({
      where: { id },
      data: {
        content,
        mentions: JSON.stringify(mentionIds)
      },
      include: {
        author: { select: { id: true, name: true, email: true } }
      }
    });

    return {
      ...comment,
      mentions: mentionIds
    };
  });

  // Delete comment
  fastify.delete('/comments/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.taskComment.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Comment not found' });
    }

    // Only author or admin can delete
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this comment' });
    }

    await prisma.taskComment.delete({ where: { id } });

    return { success: true };
  });

  // Get users for @mention autocomplete
  fastify.get('/users/mentionable', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { query } = request.query;

    const where = { isActive: true };

    if (query && query.length >= 1) {
      where.name = { contains: query };
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      take: 10
    });

    return users;
  });
}
