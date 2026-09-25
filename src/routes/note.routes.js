// Notes & Documents routes

import { validateBody, noteProjectCreateSchema, noteUpdateV2Schema, noteFromTemplateSchema } from '../validators/schemas.js';
import { softDelete } from '../services/trash.service.js';

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function presentNote(note) {
  return {
    ...note,
    tags: parseStringArray(note.tags),
    mentions: parseStringArray(note.mentions),
    contentFormat: 'MARKDOWN_PLAINTEXT',
  };
}

export async function findAuthorizedMentionUsers(prisma, organizationId, requestedIds = []) {
  const ids = [...new Set(requestedIds)];
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId, isActive: true },
    select: { id: true, name: true },
  });
  return users.length === ids.length ? users : null;
}

export async function validateParent(prisma, { parentId, projectId, noteId = null }) {
  if (!parentId) return { ok: true };
  if (parentId === noteId) return { ok: false, error: 'A document cannot be its own parent' };

  const seen = new Set(noteId ? [noteId] : []);
  let currentId = parentId;
  for (let depth = 0; depth < 200; depth += 1) {
    if (seen.has(currentId)) return { ok: false, error: 'Document hierarchy would create a cycle' };
    seen.add(currentId);
    const current = await prisma.note.findFirst({
      where: { id: currentId, projectId },
      select: { id: true, parentId: true },
    });
    if (!current) return { ok: false, error: 'Parent document must be active and in the same project' };
    if (!current.parentId) return { ok: true };
    currentId = current.parentId;
  }
  return { ok: false, error: 'Document hierarchy exceeds the supported depth' };
}

async function createMentionNotifications(prisma, { users, actorId, note, projectId }) {
  for (const user of users) {
    if (user.id === actorId) continue;
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'note.mentioned',
        title: `Mentioned in ${note.title}`,
        message: 'A teammate mentioned you in a project document.',
        data: { noteId: note.id, projectId },
      },
    });
  }
}

export default async function noteRoutes(fastify) {
  // List ALL notes across all projects (global docs view)
  fastify.get('/notes', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { type, search, pinned, projectId } = request.query;

    const where = {};
    if (projectId) where.projectId = projectId;
    if (type) where.type = type;
    if (pinned === 'true') where.isPinned = true;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      ];
    }

    const notes = await request.prisma.note.findMany({
      where,
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }
      },
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' }
      ],
      take: 200
    });

    return notes.map(presentNote);
  });

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
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      ];
    }

    const notes = await request.prisma.note.findMany({
      where,
      include: {
        author: { select: { id: true, name: true } }
      },
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' }
      ]
    });

    return notes.map(presentNote);
  });

  // Templates remain project-owned, so request tenancy guarantees they can
  // only be listed or reused inside the authenticated organization.
  fastify.get('/notes/templates', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const templates = await request.prisma.note.findMany({
      where: { isTemplate: true },
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ title: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return templates.map(presentNote);
  });

  // Get single note
  fastify.get('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const note = await request.prisma.note.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    if (!note) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    return presentNote(note);
  });

  // Create note
  fastify.post('/projects/:projectId/notes', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(noteProjectCreateSchema),
  }, async (request, reply) => {
    const { projectId } = request.params;
    const { title, content = '', type = 'NOTE', tags = [], isPinned = false, isTemplate = false, parentId = null, mentionUserIds = [] } = request.body;
    const project = await request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const parentCheck = await validateParent(request.prisma, { parentId, projectId });
    if (!parentCheck.ok) return reply.status(400).send({ error: parentCheck.error });
    const mentionUsers = await findAuthorizedMentionUsers(request.prisma, request.user.organizationId, mentionUserIds);
    if (!mentionUsers) return reply.status(400).send({ error: 'Mentions must reference active members of your organization' });

    const note = await request.prisma.$transaction(async transaction => {
      const created = await transaction.note.create({
        data: {
          title, content, type, tags: JSON.stringify(tags), mentions: JSON.stringify(mentionUserIds),
          isPinned, isTemplate, parentId, projectId, authorId: request.user.id,
        },
        include: { author: { select: { id: true, name: true } } },
      });
      await transaction.activity.create({
        data: {
          type: 'NOTE_CREATED', action: 'created', entityType: 'NOTE', entityId: created.id,
          entityName: title, metadata: JSON.stringify({ parentId, isTemplate, mentionUserIds }),
          projectId, userId: request.user.id,
        },
      });
      await createMentionNotifications(transaction, { users: mentionUsers, actorId: request.user.id, note: created, projectId });
      return created;
    });

    return reply.status(201).send(presentNote(note));
  });

  fastify.post('/projects/:projectId/notes/from-template/:templateId', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(noteFromTemplateSchema),
  }, async (request, reply) => {
    const { projectId, templateId } = request.params;
    const { title, parentId = null, mentionUserIds = [] } = request.body;
    const [project, template] = await Promise.all([
      request.prisma.project.findFirst({ where: { id: projectId }, select: { id: true } }),
      request.prisma.note.findFirst({ where: { id: templateId, isTemplate: true } }),
    ]);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const parentCheck = await validateParent(request.prisma, { parentId, projectId });
    if (!parentCheck.ok) return reply.status(400).send({ error: parentCheck.error });
    const mentionUsers = await findAuthorizedMentionUsers(request.prisma, request.user.organizationId, mentionUserIds);
    if (!mentionUsers) return reply.status(400).send({ error: 'Mentions must reference active members of your organization' });

    const note = await request.prisma.$transaction(async transaction => {
      const created = await transaction.note.create({
        data: {
          title: title || template.title,
          content: template.content,
          type: template.type,
          tags: template.tags,
          mentions: JSON.stringify(mentionUserIds),
          isPinned: false,
          isTemplate: false,
          parentId,
          projectId,
          authorId: request.user.id,
        },
        include: { author: { select: { id: true, name: true } } },
      });
      await transaction.activity.create({
        data: {
          type: 'NOTE_CREATED_FROM_TEMPLATE', action: 'created', entityType: 'NOTE', entityId: created.id,
          entityName: created.title, metadata: JSON.stringify({ templateId, parentId, mentionUserIds }),
          projectId, userId: request.user.id,
        },
      });
      await createMentionNotifications(transaction, { users: mentionUsers, actorId: request.user.id, note: created, projectId });
      return created;
    });
    return reply.status(201).send(presentNote(note));
  });

  // Update note
  fastify.put('/notes/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(noteUpdateV2Schema),
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, content, type, tags, isPinned, isTemplate, parentId, mentionUserIds } = request.body;

    const existing = await request.prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    if (parentId !== undefined) {
      const parentCheck = await validateParent(request.prisma, { parentId, projectId: existing.projectId, noteId: id });
      if (!parentCheck.ok) return reply.status(400).send({ error: parentCheck.error });
    }
    const mentionUsers = mentionUserIds === undefined
      ? []
      : await findAuthorizedMentionUsers(request.prisma, request.user.organizationId, mentionUserIds);
    if (mentionUsers === null) return reply.status(400).send({ error: 'Mentions must reference active members of your organization' });

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (type !== undefined) data.type = type;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (isPinned !== undefined) data.isPinned = isPinned;
    if (isTemplate !== undefined) data.isTemplate = isTemplate;
    if (parentId !== undefined) data.parentId = parentId;
    if (mentionUserIds !== undefined) data.mentions = JSON.stringify(mentionUserIds);

    const priorMentions = new Set(parseStringArray(existing.mentions));
    const newlyMentioned = mentionUsers.filter(user => !priorMentions.has(user.id));
    const note = await request.prisma.$transaction(async transaction => {
      const updated = await transaction.note.update({
        where: { id }, data, include: { author: { select: { id: true, name: true } } },
      });
      await transaction.activity.create({
        data: {
          type: parentId !== undefined && parentId !== existing.parentId ? 'NOTE_MOVED' : 'NOTE_UPDATED',
          action: parentId !== undefined && parentId !== existing.parentId ? 'moved' : 'updated',
          entityType: 'NOTE', entityId: updated.id, entityName: updated.title,
          metadata: JSON.stringify({ previousParentId: existing.parentId, parentId: updated.parentId, mentionUserIds: parseStringArray(updated.mentions) }),
          projectId: existing.projectId, userId: request.user.id,
        },
      });
      await createMentionNotifications(transaction, { users: newlyMentioned, actorId: request.user.id, note: updated, projectId: existing.projectId });
      return updated;
    });

    return presentNote(note);
  });

  // Delete note
  fastify.delete('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    // Only author or admin can delete
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this note' });
    }

    const { trashedItem } = await softDelete({
      scopedPrisma: request.prisma,
      entity: 'NOTE',
      recordId: id,
      organizationId: request.user.organizationId,
      // Archived parents cannot remain in the active hierarchy. Promote their
      // direct children atomically with the recovery ledger and soft deletion.
      beforeDelete: transaction => transaction.note.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    });

    return { success: true, trashId: trashedItem.id };
  });

  // Restore one recently soft-deleted note. Explicit deletedAt criteria bypasses
  // the normal soft-delete read filter while tenant scoping remains enforced.
  fastify.post('/notes/:id/restore', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.note.findFirst({
      where: { id, deletedAt: { not: null } }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Deleted note not found' });
    }
    if (existing.authorId !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot restore this note' });
    }

    const parent = existing.parentId
      ? await request.prisma.note.findFirst({ where: { id: existing.parentId, projectId: existing.projectId }, select: { id: true } })
      : null;
    const note = await request.prisma.note.update({
      where: { id },
      data: { deletedAt: null, parentId: parent?.id || null }
    });
    return { success: true, note: presentNote(note) };
  });

  // Toggle pin status
  fastify.post('/notes/:id/pin', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.note.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    const note = await request.prisma.note.update({
      where: { id },
      data: { isPinned: !existing.isPinned }
    });

    return { isPinned: note.isPinned };
  });
}
