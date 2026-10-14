import { createHash } from 'node:crypto';
import { z } from 'zod';
import { composeDocumentAudience, documentAudienceRights } from '../shared/document-audiences.js';
import { currentWikiStaff } from './workspace-page-authorization.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const scope = organizationId => ({ project: { organizationId } });
const metadata = { id: true, projectId: true, authorId: true, parentId: true, deletedAt: true, accessMode: true, accessRevision: true, accessGrants: true, audienceBarrier: true };
export const noteAccessSchema = z.object({ revision: z.number().int().min(0), mode: z.enum(['TEAM', 'RESTRICTED']), members: z.array(z.object({ userId: z.string().min(1).max(80), role: z.enum(['READ', 'EDIT']) }).strict()).max(100) }).strict().refine(value => new Set(value.members.map(row => row.userId)).size === value.members.length, 'Choose unique members');

// Metadata only, fetched in bounded batches. Hidden content/rosters never become
// a response; complete ancestors are evaluated before paging or counting reads.
export async function noteAccessContext(prisma, actor) {
  const user = await currentWikiStaff(prisma, actor);
  const cache = new Map();
  async function load(ids, seeds = [], includeDeleted = false) {
    for (const row of seeds) cache.set(row.id, { ...row, organizationId: user.organizationId, grants: row.accessGrants });
    let missing = [...new Set([...ids.filter(id => !cache.has(id)), ...seeds.map(row => row.parentId).filter(id => id && !cache.has(id))])];
    for (let depth = 0; missing.length && depth <= 200; depth++) {
      const parents = [];
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        const rows = await prisma.note.findMany({ where: { id: { in: batch }, ...scope(user.organizationId), deletedAt: includeDeleted ? {} : null }, select: metadata, take: 100 });
        for (const id of batch) cache.set(id, null);
        for (const row of rows) {
          cache.set(row.id, { ...row, organizationId: user.organizationId, grants: row.accessGrants });
          if (row.parentId && !cache.has(row.parentId)) parents.push(row.parentId);
        }
      }
      missing = [...new Set(parents)].filter(id => !cache.has(id));
    }
  }
  function path(id) {
    const nodes = [], seen = new Set(); let node = cache.get(id);
    while (node && nodes.length < 200 && !seen.has(node.id)) {
      nodes.push(node); seen.add(node.id);
      if (!node.parentId) return nodes;
      node = cache.get(node.parentId);
    }
    return nodes; // Algebra fails closed for incomplete/cyclic paths.
  }
  return { user, load, path, rights: id => documentAudienceRights(path(id), user), clear: () => cache.clear() };
}

export async function authorizeNote(prisma, id, actor, { edit = false, manage = false, includeDeleted = false } = {}) {
  const access = await noteAccessContext(prisma, actor);
  await access.load([id], [], includeDeleted);
  const permissions = access.rights(id);
  if (!permissions.canRead) fail(404, 'Document not found');
  if (edit && !permissions.canEdit) fail(403, 'This document is read only');
  if (manage && !permissions.canManage) fail(403, 'The document owner or an administrator manages access and hierarchy');
  const note = await prisma.note.findFirst({ where: { id, ...scope(access.user.organizationId), ...(includeDeleted ? { deletedAt: { not: null } } : { deletedAt: null }) } });
  if (!note) fail(404, 'Document not found');
  return { note, permissions, user: access.user, path: access.path(id) };
}

export function publicNote(note, permissions) {
  const { accessGrants: _grants, audienceBarrier: _barrier, ...safe } = note;
  return { ...safe, ...(permissions ? { permissions } : {}) };
}

export async function visibleNoteIds(prisma, actor, where = {}) {
  const access = await noteAccessContext(prisma, actor);
  const ids = []; let after;
  for (;;) {
    const rows = await prisma.note.findMany({ where: { AND: [where, scope(access.user.organizationId), { deletedAt: null }, ...(after ? [{ id: { gt: after } }] : [])] }, select: metadata, orderBy: { id: 'asc' }, take: 100 });
    await access.load(rows.map(row => row.id), rows);
    for (const row of rows) if (access.rights(row.id).canRead) ids.push(row.id);
    access.clear();
    if (rows.length < 100) return ids;
    after = rows.at(-1).id;
  }
}

export async function readNoteAccess(prisma, id, actor) {
  const { note, user } = await authorizeNote(prisma, id, actor, { manage: true });
  const ids = note.accessGrants.map(row => row.userId);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids }, organizationId: user.organizationId }, select: { id: true, name: true, role: true, isActive: true } }) : [];
  const members = note.accessGrants.map(grant => { const member = users.find(row => row.id === grant.userId); return { ...grant, name: member?.name || 'Unavailable teammate', isActive: Boolean(member?.isActive && ['ADMIN', 'TEAM'].includes(member.role)) }; });
  return { noteId: id, ownerId: note.authorId, revision: note.accessRevision, mode: note.accessMode, members, inheritedRestrictions: Boolean(note.parentId || note.audienceBarrier) };
}

export async function saveNoteAccess(prisma, id, input, actor) {
  return withStageTransaction(prisma, tx => saveNoteAccessInTransaction(tx, id, input, actor));
}

export async function saveNoteAccessInTransaction(tx, id, input, actor) {
    const parsed = noteAccessSchema.safeParse(input);
    if (!parsed.success) fail(400, 'Choose an audience, observed revision and unique staff members');
    const { note, user } = await authorizeNote(tx, id, actor, { manage: true });
    if (note.accessRevision !== parsed.data.revision) fail(409, 'Document access changed. Reload before saving.');
    if (parsed.data.members.some(row => row.userId === note.authorId)) fail(400, 'The document owner retains access automatically');
    const added = parsed.data.members.filter(row => !note.accessGrants.some(old => old.userId === row.userId && old.role === row.role));
    if (added.length && await tx.user.count({ where: { id: { in: added.map(row => row.userId) }, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } } }) !== added.length) fail(404, 'A selected teammate is unavailable');
    const changed = await tx.note.updateMany({ where: { id, accessRevision: parsed.data.revision, deletedAt: null, ...scope(user.organizationId) }, data: { accessMode: parsed.data.mode, accessGrants: parsed.data.members } });
    if (changed.count !== 1) fail(409, 'Document access changed. Reload before saving.');
    if (!await recordAuditEvent(tx, { organizationId: user.organizationId, actorUserId: user.id, actorType: 'USER', action: 'note.access_changed', entityId: id, metadata: { fromMode: note.accessMode, toMode: parsed.data.mode, memberCount: parsed.data.members.length } })) fail(503, 'Document access could not be saved with its audit record');
    return readNoteAccess(tx, id, user);
}

export async function preserveNoteAudience(prisma, id, actor) {
  const access = await authorizeNote(prisma, id, actor, { manage: true });
  // No administrator ids are copied into permanent grants. Demotion revokes
  // administrator bypass even after archive/promotion/template-copy operations.
  return composeDocumentAudience(access.path);
}

export async function noteRestoreData(prisma, id, actor) {
  const access = await authorizeNote(prisma, id, actor, { manage: true, includeDeleted: true });
  if (!access.note.parentId) return { deletedAt: null, parentId: null };
  const parent = await prisma.note.findFirst({ where: { id: access.note.parentId, projectId: access.note.projectId, ...scope(access.user.organizationId), deletedAt: null }, select: { id: true } });
  if (parent) {
    await authorizeNote(prisma, parent.id, actor, { edit: true });
    return { deletedAt: null, parentId: parent.id };
  }
  // Older archived rows can still refer to deleted ancestors. Preserve their
  // complete effective audience before becoming a root; never guess a missing
  // ancestor's permissions or trust the trash ledger as current authorization.
  let barrier;
  try { barrier = composeDocumentAudience(access.path); }
  catch { fail(409, 'The document audience cannot be recovered without its ancestor metadata'); }
  return { deletedAt: null, parentId: null, audienceBarrier: barrier };
}

export async function noteMentionUsers(prisma, actor, ids, candidate, parentId) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const users = await prisma.user.findMany({ where: { id: { in: unique }, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, name: true, role: true, organizationId: true, isActive: true } });
  if (users.length !== unique.length) fail(400, 'Mentions must reference active staff with document access');
  const access = await noteAccessContext(prisma, actor);
  if (parentId) await access.load([parentId]);
  const nodes = [{ ...candidate, id: candidate.id || 'pending-document', parentId: parentId || null, organizationId: actor.organizationId, grants: candidate.accessGrants || [], accessMode: candidate.accessMode || 'TEAM' }, ...(parentId ? access.path(parentId) : [])];
  if (users.some(user => !documentAudienceRights(nodes, user).canRead)) fail(400, 'Mentions must reference active staff with document access');
  return users;
}

export async function prepareNoteAccess(prisma, id, input, actor) {
  const parsed = noteAccessSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Choose a valid audience and observed access revision');
  const access = await authorizeNote(prisma, id, actor, { manage: true });
  if (access.note.accessRevision !== parsed.data.revision) fail(409, 'Document access changed. Reload before saving.');
  const current = await readNoteAccess(prisma, id, actor);
  const proposedIds = parsed.data.members.map(row => row.userId);
  const users = proposedIds.length ? await prisma.user.findMany({ where: { id: { in: proposedIds }, organizationId: access.user.organizationId }, select: { id: true, name: true, role: true, isActive: true } }) : [];
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor: access.user, input: { ...parsed.data, members: [...parsed.data.members].sort((a, b) => a.userId.localeCompare(b.userId)) }, path: access.path.map(row => ({ id: row.id, parentId: row.parentId, accessRevision: row.accessRevision, authorId: row.authorId, accessMode: row.accessMode, accessGrants: row.accessGrants, audienceBarrier: row.audienceBarrier })), users: [...users].sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex');
  return { current, proposed: { mode: parsed.data.mode, members: parsed.data.members.map(row => ({ ...row, name: users.find(user => user.id === row.userId)?.name || 'Unavailable teammate' })) }, fingerprint, descendantVisibilityCanChange: true, inheritedRestrictionsRemain: current.inheritedRestrictions };
}

export async function noteNotificationWhere(prisma, actor) {
  const candidates = await prisma.notification.findMany({ where: { userId: actor.id, type: 'note.mentioned' }, select: { id: true, data: true } });
  if (!candidates.length) return {};
  let access;
  try { access = await noteAccessContext(prisma, actor); }
  catch (error) { if (error.statusCode === 403) return { type: { not: 'note.mentioned' } }; throw error; }
  await access.load(candidates.map(row => row.data?.noteId).filter(id => typeof id === 'string'));
  return { OR: [{ type: { not: 'note.mentioned' } }, { id: { in: candidates.filter(row => access.rights(row.data?.noteId).canRead).map(row => row.id) } }] };
}
