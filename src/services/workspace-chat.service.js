import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '../ai/tools/registry.js';
import { createScopedPrisma } from '../utils/prisma-tenant-proxy.js';
import { recordAuditEvent } from './audit-event.service.js';

const id = z.string().trim().min(1).max(100);
export const channelInputSchema = z.object({
  kind: z.enum(['COMPANY', 'CLIENT', 'PROJECT', 'DIRECT']), name: z.string().trim().min(1).max(120).optional(),
  clientId: id.optional(), projectId: id.optional(), memberIds: z.array(id).max(30).default([]),
}).strict();
export const messageInputSchema = z.object({ content: z.string().trim().min(1).max(4000), parentId: id.optional(), idempotencyKey: z.string().min(8).max(128) }).strict();
export const messagesQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(30), after: id.optional() }).strict();
export const channelsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: id.optional() }).strict();
const authorSelect = { id: true, name: true, role: true };
const channelInclude = {
  members: { where: { leftAt: null }, select: { userId: true, leftAt: true, user: { select: authorSelect } } },
  project: { select: { id: true, organizationId: true, clientId: true, deletedAt: true } },
};
const messageInclude = { author: { select: { id: true, name: true } } };
const activeParents = organizationId => [
  { OR: [{ clientId: null }, { client: { organizationId, deletedAt: null } }] },
  { OR: [{ projectId: null }, { project: { organizationId, deletedAt: null } }] },
];
const refuse = (code = 'RECORD_NOT_FOUND', statusCode = 404) => { throw new ToolError(code, 'Workspace chat unavailable', { statusCode }); };
const parse = (schema, value) => { const result = schema.safeParse(value); if (!result.success) refuse('INVALID_INPUT', 400); return result.data; };
function canonicalProject(channel) {
  return !channel.projectId || (channel.project?.id === channel.projectId
    && channel.project.organizationId === channel.organizationId
    && channel.project.deletedAt == null && channel.project.clientId === channel.clientId);
}

async function actorScope(prisma, user) {
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role)) refuse('ROLE_DENIED', 403);
  const db = createScopedPrisma(prisma, user.organizationId);
  const actor = await db.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true }, select: { ...authorSelect, organizationId: true, isActive: true } });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) refuse('ROLE_DENIED', 403);
  return { db, actor, organizationId: user.organizationId };
}
async function channelForMember(db, actor, channelId) {
  parse(id, channelId);
  const channel = await db.workspaceChatChannel.findFirst({ where: { id: channelId, organizationId: actor.organizationId, archivedAt: null, AND: activeParents(actor.organizationId), members: { some: { userId: actor.id, organizationId: actor.organizationId, leftAt: null } } }, include: channelInclude });
  if (!channel || channel.organizationId !== actor.organizationId || channel.archivedAt != null || !canonicalProject(channel) || !channel.members?.some(m => m.userId === actor.id && m.leftAt == null)) refuse();
  return channel;
}
// Obtain the channel row lock before touching message or member rows. This
// matches the database triggers' channel-first ordering, preventing lock
// upgrades and member/channel inversion during concurrent sends/revocations.
async function lockChannel(db, actor, channel) {
  const result = await db.workspaceChatChannel.updateMany({
    where: {
      id: channel.id, organizationId: actor.organizationId, archivedAt: null,
      AND: activeParents(actor.organizationId),
      ...(channel.projectId ? { project: { id: channel.projectId, clientId: channel.clientId, organizationId: actor.organizationId, deletedAt: null } } : {}),
      members: { some: { userId: actor.id, organizationId: actor.organizationId, leftAt: null } },
    },
    data: { revision: { increment: 1 } },
  });
  if (result.count !== 1) refuse();
}
async function transaction(prisma, user, operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await prisma.$transaction(async tx => { const scope = await actorScope(tx, user); return operation(scope); }, { isolationLevel: 'Serializable' }); }
    catch (error) { if (['P2034', 'P2002'].includes(error?.code) && attempt < 2) continue; throw error; }
  }
}
async function audit(db, actor, action, entityId, metadata = {}) {
  const event = await recordAuditEvent(db, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', action, entityId, metadata });
  if (!event) refuse('AUDIT_UNAVAILABLE', 503);
}

export async function listWorkspaceChatPeople(prisma, user) {
  const { db, organizationId } = await actorScope(prisma, user);
  const items = await db.user.findMany({ where: { organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: authorSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 });
  return { items };
}
export async function listWorkspaceChatChannels(prisma, user, input = {}) {
  const { limit, after } = parse(channelsQuerySchema, input);
  const { db, actor, organizationId } = await actorScope(prisma, user);
  const rows = await db.workspaceChatChannel.findMany({ where: { organizationId, archivedAt: null, ...(after ? { id: { gt: after } } : {}), AND: activeParents(organizationId), members: { some: { userId: actor.id, organizationId, leftAt: null } } }, include: channelInclude, orderBy: [{ id: 'asc' }], take: limit + 1 });
  const scanned = rows.slice(0, limit);
  // Cursor follows the scanned rows rather than the visible subset: a moved
  // project may yield an empty page, which must still advance to later rows.
  return { items: scanned.filter(canonicalProject), nextCursor: rows.length > limit ? scanned.at(-1).id : null };
}
export async function createWorkspaceChatChannel(prisma, user, input) {
  const data = parse(channelInputSchema, input);
  return transaction(prisma, user, async ({ db, actor, organizationId }) => {
    const memberIds = [...new Set([actor.id, ...data.memberIds])].sort();
    if (memberIds.length > 30) refuse('INVALID_INPUT', 400);
    if (data.kind === 'COMPANY' && actor.role !== 'ADMIN') refuse('ROLE_DENIED', 403);
    if (data.kind === 'DIRECT' && (memberIds.length < 2 || data.clientId || data.projectId || data.name)) refuse('INVALID_INPUT', 400);
    if (data.kind !== 'DIRECT' && !data.name) refuse('INVALID_INPUT', 400);
    if ((data.kind === 'COMPANY' && (data.clientId || data.projectId)) || (data.kind === 'CLIENT' && (!data.clientId || data.projectId)) || (data.kind === 'PROJECT' && !data.projectId)) refuse('INVALID_INPUT', 400);
    const people = await db.user.findMany({ where: { id: { in: memberIds }, organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } });
    if (people.length !== memberIds.length || !memberIds.every(memberId => people.some(person => person.id === memberId))) refuse('INVALID_INPUT', 400);
    let clientId = data.clientId ?? null;
    if (data.projectId) {
      const project = await db.project.findFirst({ where: { id: data.projectId, organizationId, deletedAt: null }, select: { id: true, clientId: true, organizationId: true, deletedAt: true } });
      if (!project || project.organizationId !== organizationId || project.deletedAt != null || (clientId && project.clientId !== clientId)) refuse();
      clientId = project.clientId;
    }
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, organizationId: true, deletedAt: true } });
      if (!client || client.organizationId !== organizationId || client.deletedAt != null) refuse();
    }
    const directKey = data.kind === 'DIRECT' ? createHash('sha256').update(JSON.stringify(memberIds)).digest('hex') : null;
    if (directKey) {
      const existing = await db.workspaceChatChannel.findFirst({ where: { organizationId, directKey }, include: channelInclude });
      if (existing) { if (existing.archivedAt || !memberIds.every(memberId => existing.members.some(m => m.userId === memberId)) || existing.members.length !== memberIds.length) refuse('CHAT_CONFLICT', 409); return { channel: existing }; }
    }
    const channel = await db.workspaceChatChannel.create({ data: { organizationId, kind: data.kind, name: data.name ?? 'Direct message', clientId, projectId: data.projectId ?? null, directKey, createdById: actor.id } });
    await db.workspaceChatMember.createMany({ data: memberIds.map(userId => ({ organizationId, channelId: channel.id, userId })) });
    await audit(db, actor, 'workspace_chat.channel_created', channel.id, { kind: data.kind, memberCount: memberIds.length });
    return { channel: await channelForMember(db, actor, channel.id) };
  });
}
export async function getWorkspaceChatMessages(prisma, user, channelId, input = {}) {
  const { limit, after } = parse(messagesQuerySchema, input);
  const { db, actor, organizationId } = await actorScope(prisma, user);
  const channel = await channelForMember(db, actor, channelId);
  let cursor;
  if (after) {
    cursor = await db.workspaceChatMessage.findFirst({ where: { id: after, channelId, organizationId }, select: { id: true, createdAt: true } });
    if (!cursor) refuse();
  }
  const rows = await db.workspaceChatMessage.findMany({ where: { channelId, organizationId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, include: messageInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const page = rows.slice(0, limit);
  return { channel, items: page.reverse(), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function postWorkspaceChatMessage(prisma, user, channelId, input) {
  const { content, parentId, idempotencyKey } = parse(messageInputSchema, input);
  return transaction(prisma, user, async ({ db, actor, organizationId }) => {
    const channel = await channelForMember(db, actor, channelId);
    await lockChannel(db, actor, channel);
    const existing = await db.workspaceChatMessage.findFirst({ where: { channelId, organizationId, clientKey: idempotencyKey }, include: messageInclude });
    if (existing) { if (existing.authorId !== actor.id || existing.content !== content || (existing.parentId ?? null) !== (parentId ?? null)) refuse('CHAT_CONFLICT', 409); return { message: existing, duplicate: true }; }
    if (parentId && !await db.workspaceChatMessage.findFirst({ where: { id: parentId, channelId, organizationId }, select: { id: true } })) refuse();
    const message = await db.workspaceChatMessage.create({ data: { organizationId, channelId, authorId: actor.id, content, parentId: parentId ?? null, clientKey: idempotencyKey }, include: messageInclude });
    await audit(db, actor, 'workspace_chat.message_created', message.id, { channelId, parentId: parentId ?? null });
    return { message, duplicate: false };
  });
}
export async function markWorkspaceChatRead(prisma, user, channelId) {
  return transaction(prisma, user, async ({ db, actor, organizationId }) => {
    const channel = await channelForMember(db, actor, channelId);
    await lockChannel(db, actor, channel);
    const lastReadAt = new Date();
    await db.workspaceChatMember.updateMany({ where: { channelId, userId: actor.id, organizationId, leftAt: null }, data: { lastReadAt } });
    return { lastReadAt };
  });
}
export async function setWorkspaceChatMember(prisma, user, channelId, userId, active) {
  parse(id, userId);
  if (typeof active !== 'boolean') refuse('INVALID_INPUT', 400);
  return transaction(prisma, user, async ({ db, actor, organizationId }) => {
    const channel = await channelForMember(db, actor, channelId);
    if (channel.kind === 'DIRECT') refuse('CHAT_CONFLICT', 409);
    if (!(actor.role === 'ADMIN' || channel.createdById === actor.id || (!active && userId === actor.id))) refuse('ROLE_DENIED', 403);
    await lockChannel(db, actor, channel);
    const member = await db.workspaceChatMember.findFirst({ where: { channelId, userId, organizationId } });
    // Joining and rejoining grant the retained channel history, as for the
    // existing staff membership policy. DIRECT participant sets stay fixed.
    if (active) {
      if ((!member || member.leftAt) && channel.members.length >= 30) refuse('CHAT_CONFLICT', 409);
      const person = await db.user.findFirst({ where: { id: userId, organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } });
      if (!person) refuse();
      if (!member) await db.workspaceChatMember.create({ data: { channelId, userId, organizationId } });
      else if (member.leftAt) await db.workspaceChatMember.updateMany({ where: { channelId, userId, organizationId }, data: { leftAt: null } });
    } else if (!active && member) await db.workspaceChatMember.updateMany({ where: { channelId, userId, organizationId, leftAt: null }, data: { leftAt: new Date() } });
    await audit(db, actor, 'workspace_chat.membership_changed', channelId, { channelId, memberUserId: userId, active });
    return { active };
  });
}
