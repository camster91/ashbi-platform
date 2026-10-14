// Notes & Documents routes

import { validateBody, noteProjectCreateSchema, noteUpdateV2Schema, noteFromTemplateSchema } from '../validators/schemas.js';
import { noteRestoreData, noteAccessSchema, authorizeNote, publicNote, noteAccessContext, visibleNoteIds, readNoteAccess, saveNoteAccess, noteMentionUsers, preserveNoteAudience } from '../services/note-access.service.js';
import { withStageTransaction } from '../services/task-stages.service.js';
import { softDelete } from '../services/trash.service.js';
import { portfolioFilterSchema } from '../validators/schemas.js';
import { portfolioWhere } from '../shared/portfolio.js';
import { z } from 'zod';
import { currentWikiStaff as currentNoteStaff } from '../services/workspace-page-authorization.js';
import { composeDocumentAudience } from '../shared/document-audiences.js';

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
    ...publicNote(note, note.permissions),
    tags: parseStringArray(note.tags),
    mentions: parseStringArray(note.mentions),
    contentFormat: 'MARKDOWN_PLAINTEXT',
  };
}

export async function findAuthorizedMentionUsers(prisma, organizationId, requestedIds = []) {
  const ids = [...new Set(requestedIds)];
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } },
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

async function presentAuthorizedNotes(prisma, actor, notes) {
  const access = await noteAccessContext(prisma, actor);
  await access.load(notes.map(note => note.id), notes);
  return notes.filter(note => access.rights(note.id).canRead).map(note => presentNote({ ...note, permissions: access.rights(note.id) }));
}

export default async function noteRoutes(fastify) {
  // List ALL notes across all projects (global docs view)
  fastify.get('/notes', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { type, search, pinned, projectId } = request.query;
    const portfolio = portfolioFilterSchema.safeParse(request.query.portfolio);
    if (!portfolio.success) return reply.status(400).send({ error: 'Invalid portfolio filter' });
    const paginated = request.query.paginated === 'true';
    if (request.query.paginated !== undefined && !['true', 'false'].includes(request.query.paginated)) return reply.status(400).send({ error: 'Invalid pagination mode' });
    const paging = z.object({ page: z.coerce.number().int().min(1).max(100000), limit: z.coerce.number().int().min(1).max(100) }).safeParse({ page: request.query.page ?? '1', limit: request.query.limit ?? '100' });
    if (paginated && !paging.success) return reply.status(400).send({ error: 'Invalid document pagination' });

    const where = {};
    if (portfolio.data) where.project = portfolioWhere(portfolio.data);
    if (projectId) where.projectId = projectId;
    if (type) where.type = type;
    if (pinned === 'true') where.isPinned = true;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      ];
    }

    const visibleIds = await visibleNoteIds(request.prisma, request.user, where);
    where.id = { in: visibleIds };
    const notes = await request.prisma.note.findMany({
      where,
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } }
      },
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' },
        { id: 'asc' }
      ],
      take: paginated ? paging.data.limit : 200,
      ...(paginated ? { skip: (paging.data.page - 1) * paging.data.limit } : {})
    });
    if (paginated) {
      const total = await request.prisma.note.count({ where });
      return { notes: await presentAuthorizedNotes(request.prisma, request.user, notes), pagination: { page: paging.data.page, limit: paging.data.limit, total, pages: Math.ceil(total / paging.data.limit) } };
    }
    return await presentAuthorizedNotes(request.prisma, request.user, notes);
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

    const visibleIds = await visibleNoteIds(request.prisma, request.user, where);
    where.id = { in: visibleIds };
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

    return await presentAuthorizedNotes(request.prisma, request.user, notes);
  });

  // Templates remain project-owned, so request tenancy guarantees they can
  // only be listed or reused inside the authenticated organization.
  fastify.get('/notes/templates', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const visibleIds = await visibleNoteIds(request.prisma, request.user, { isTemplate: true });
    const templates = await request.prisma.note.findMany({
      where: { isTemplate: true, id: { in: visibleIds } },
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ title: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return presentAuthorizedNotes(request.prisma, request.user, templates);
  });

  // Get single note
  fastify.get('/notes/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const authorized = await authorizeNote(request.prisma, id, request.user);
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

    return presentNote({ ...note, permissions: authorized.permissions });
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

    const note = await withStageTransaction(request.prisma, async transaction => {
      await currentNoteStaff(transaction, request.user);
      if (parentId) await authorizeNote(transaction, parentId, request.user, { edit: true });
      const authorizedMentions = await noteMentionUsers(transaction, request.user, mentionUserIds, { authorId: request.user.id, projectId }, parentId);
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
      await createMentionNotifications(transaction, { users: authorizedMentions, actorId: request.user.id, note: created, projectId });
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
    await authorizeNote(request.prisma, templateId, request.user);
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

    const note = await withStageTransaction(request.prisma, async transaction => {
      const sourceAccess = await authorizeNote(transaction, templateId, request.user);
      if (sourceAccess.note.revision !== template.revision || !sourceAccess.note.isTemplate) throw Object.assign(new Error('Template changed. Reload before copying.'), { statusCode: 409 });
      if (parentId) await authorizeNote(transaction, parentId, request.user, { edit: true });
      const templateBarrier = composeDocumentAudience(sourceAccess.path);
      const authorizedMentions = await noteMentionUsers(transaction, sourceAccess.user, mentionUserIds, { authorId: request.user.id, projectId, audienceBarrier: templateBarrier }, parentId);
      const created = await transaction.note.create({
        data: {
          title: title || template.title,
          audienceBarrier: templateBarrier,
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
      await createMentionNotifications(transaction, { users: authorizedMentions, actorId: request.user.id, note: created, projectId });
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
    const { revision, title, content, type, tags, isPinned, isTemplate, parentId, mentionUserIds } = request.body;

    const { note: existing } = await authorizeNote(request.prisma, id, request.user, { edit: true });

    if (!existing) {
      return reply.status(404).send({ error: 'Note not found' });
    }

    if (existing.revision !== revision) return reply.status(409).send({ error: 'Document changed since you started editing. Your draft has not been saved. Reload the document before trying again.' });

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
    const note = await withStageTransaction(request.prisma, async transaction => {
      const access = await authorizeNote(transaction, id, request.user, { edit: true, manage: parentId !== undefined && parentId !== existing.parentId });
      if (access.note.revision !== revision) throw Object.assign(new Error('Document changed. Your draft is retained.'), { statusCode: 409 });
      if (parentId !== undefined && parentId !== existing.parentId) {
        if (parentId) await authorizeNote(transaction, parentId, request.user, { edit: true });
        data.audienceBarrier = composeDocumentAudience(access.path);
      }
      const authorizedMentions = await noteMentionUsers(transaction, access.user, mentionUserIds || [], { ...access.note, ...data }, parentId !== undefined ? parentId : access.note.parentId);
      const changed = await transaction.note.updateMany({ where: { id, revision, deletedAt: null }, data });
      if (changed.count !== 1) throw Object.assign(new Error('Document changed since you started editing. Your draft has not been saved. Reload the document before trying again.'), { statusCode: 409 });
      const updated = await transaction.note.findUnique({ where: { id }, include: { author: { select: { id: true, name: true } } } });
      await transaction.activity.create({
        data: {
          type: parentId !== undefined && parentId !== existing.parentId ? 'NOTE_MOVED' : 'NOTE_UPDATED',
          action: parentId !== undefined && parentId !== existing.parentId ? 'moved' : 'updated',
          entityType: 'NOTE', entityId: updated.id, entityName: updated.title,
          metadata: JSON.stringify({ previousParentId: existing.parentId, parentId: updated.parentId, mentionUserIds: parseStringArray(updated.mentions) }),
          projectId: existing.projectId, userId: request.user.id,
        },
      });
      await createMentionNotifications(transaction, { users: authorizedMentions.filter(user => newlyMentioned.some(row => row.id === user.id)), actorId: request.user.id, note: updated, projectId: existing.projectId });
      return updated;
    });

    return presentNote(note);
  });

  fastify.get('/notes/:id/access', { onRequest: [fastify.authenticate] }, request => readNoteAccess(request.prisma, request.params.id, request.user));
  fastify.put('/notes/:id/access', { onRequest: [fastify.authenticate], preHandler: validateBody(noteAccessSchema) }, request => saveNoteAccess(request.prisma, request.params.id, request.body, request.user));

  fastify.delete('/notes/:id', { onRequest: [fastify.authenticate] }, async request => {
    const { id } = request.params;
    const { trashedItem } = await softDelete({ scopedPrisma: request.prisma, entity: 'NOTE', recordId: id, organizationId: request.user.organizationId,
      beforeDelete: async transaction => {
        const barrier = await preserveNoteAudience(transaction, id, request.user);
        const children = await transaction.note.findMany({ where: { parentId: id, deletedAt: null }, select: { id: true } });
        // Compute every child barrier against the original tree before moving any.
        const access = await noteAccessContext(transaction, request.user);
        await access.load(children.map(row => row.id));
        const promotions = children.map(row => ({ id: row.id, barrier: composeDocumentAudience(access.path(row.id)) }));
        for (const child of promotions) await transaction.note.update({ where: { id: child.id }, data: { audienceBarrier: child.barrier, parentId: null } });
        await transaction.note.update({ where: { id }, data: { audienceBarrier: barrier, parentId: null } });
      }
    });
    return { success: true, trashId: trashedItem.id };
  });

  fastify.post('/notes/:id/restore', { onRequest: [fastify.authenticate] }, async request => {
    const note = await withStageTransaction(request.prisma, async transaction => {
      const data = await noteRestoreData(transaction, request.params.id, request.user);
      return transaction.note.update({ where: { id: request.params.id, deletedAt: { not: null } }, data });
    });
    return { success: true, note: presentNote(note) };
  });

  fastify.post('/notes/:id/pin', { onRequest: [fastify.authenticate] }, async request => {
    return withStageTransaction(request.prisma, async transaction => {
      const { note: existing } = await authorizeNote(transaction, request.params.id, request.user, { edit: true });
      const note = await transaction.note.update({ where: { id: existing.id }, data: { isPinned: !existing.isPinned } });
      return { isPinned: note.isPinned };
    });
  });
}
