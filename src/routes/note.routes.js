// Notes & Documents routes

import { prisma } from '../index.js';

export default async function noteRoutes(fastify) {
  // List notes for a project
  fastify.get('/projects/:projectId/notes', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { projectId } = request.params;
    const { type, search, pinned } = request.query;

    const where = { projectId };

    if (type) where.type = type;
    if (pinned === 'true') where.isPinned = true;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } }
      ];
    }

    const notes = await prisma.note.findMany({
      where,
      include: {
        author: { select: { id: true, name: true } }
      },
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' }
      ]
    });

    return notes.map(n => ({
      ...n,
      tags: JSON.parse(n.tags)
    }));
  });

  // Get single note
  fastify.get('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const note = await prisma.note.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    if (!note) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    return {
      ...note,
      tags: JSON.parse(note.tags)
    };
  });

  // Create note
  fastify.post('/projects/:projectId/notes', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { title, content, type = 'NOTE', tags = [], isPinned = false } = request.body;

    if (!title?.trim()) {
      return reply.status(400).send({ error: 'Title is required' });
    }

    const note = await prisma.note.create({
      data: {
        title,
        content: content || '',
        type,
        tags: JSON.stringify(tags),
        isPinned,
        projectId,
        authorId: request.user.id
      },
      include: {
        author: { select: { id: true, name: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'NOTE_CREATED',
        action: 'created',
        entityType: 'NOTE',
        entityId: note.id,
        entityName: title,
        projectId,
        userId: request.user.id
      }
    });

    return reply.status(201).send({
      ...note,
      tags: JSON.parse(note.tags)
    });
  });

  // Update note
  fastify.put('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, content, type, tags, isPinned } = request.body;

    const existing = await prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (type !== undefined) data.type = type;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (isPinned !== undefined) data.isPinned = isPinned;

    const note = await prisma.note.update({
      where: { id },
      data,
      include: {
        author: { select: { id: true, name: true } }
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'NOTE_UPDATED',
        action: 'updated',
        entityType: 'NOTE',
        entityId: note.id,
        entityName: note.title,
        projectId: existing.projectId,
        userId: request.user.id
      }
    });

    return {
      ...note,
      tags: JSON.parse(note.tags)
    };
  });

  // Delete note
  fastify.delete('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    // Only author or admin can delete
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this note' });
    }

    await prisma.note.delete({ where: { id } });

    return { success: true };
  });

  // Toggle pin status
  fastify.post('/notes/:id/pin', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    const note = await prisma.note.update({
      where: { id },
      data: { isPinned: !existing.isPinned }
    });

    return { isPinned: note.isPinned };
  });
}
