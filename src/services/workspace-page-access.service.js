import { workspacePageAccessSchema } from '../validators/schemas.js';
import { authorizeWorkspacePage } from './workspace-page-authorization.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { attributeDocumentEdit } from './document-history-actor.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export async function readWorkspacePageAccess(prisma, id, actor) {
  const { page } = await authorizeWorkspacePage(prisma, id, actor, { manage: true });
  const members = await prisma.workspacePageGrant.findMany({ where: { pageId: id, organizationId: actor.organizationId }, orderBy: { userId: 'asc' }, take: 100, select: { userId: true, role: true, user: { select: { name: true, isActive: true, role: true } } } });
  return { pageId: id, ownerId: page.authorId, mode: page.accessMode, revision: page.accessRevision, members: members.map(row => ({ userId: row.userId, role: row.role, name: row.user?.name || 'Unavailable teammate', isActive: Boolean(row.user?.isActive && ['ADMIN', 'TEAM'].includes(row.user?.role)) })), parentRestrictionsApply: Boolean(page.parentId) };
}
export async function workspacePageAccessOptions(prisma, id, { search = '', after, limit = 25 }, actor) {
  const { page } = await authorizeWorkspacePage(prisma, id, actor, { manage: true });
  const rows = await prisma.user.findMany({ where: { organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] }, AND: [{ id: { not: page.authorId } }, ...(after ? [{ id: { gt: after } }] : [])], ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, name: true } });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function validateWorkspacePageAccess(prisma, id, input, actor) {
  const parsed = workspacePageAccessSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Choose an audience, observed access revision and unique staff members.');
  const current = await readWorkspacePageAccess(prisma, id, actor);
  if (current.revision !== parsed.data.revision) fail(409, 'Page access changed. Reload before saving.');
  if (parsed.data.members.some(row => row.userId === current.ownerId)) fail(400, 'The page owner retains access automatically.');
  const known = new Map(current.members.map(row => [row.userId, row]));
  const added = parsed.data.members.filter(row => !known.has(row.userId) || known.get(row.userId).role !== row.role);
  if (added.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: added.map(row => row.userId) }, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, name: true }, take: 100 });
    if (rows.length !== added.length) fail(404, 'A selected teammate is unavailable');
    for (const row of rows) known.set(row.id, { userId: row.id, name: row.name, isActive: true });
  }
  return { current, input: parsed.data, proposed: parsed.data.members.map(row => ({ ...known.get(row.userId), ...row })) };
}
export async function saveWorkspacePageAccess(prisma, id, input, actor) {
  return withStageTransaction(prisma, tx => saveWorkspacePageAccessInTransaction(tx, id, input, actor), 'Page access changed while saving. Reload before trying again.');
}
export async function saveWorkspacePageAccessInTransaction(tx, id, input, actor) {
  const validated = await validateWorkspacePageAccess(tx, id, input, actor);
  await attributeDocumentEdit(tx, actor);
  await tx.workspacePageGrant.deleteMany({ where: { pageId: id, organizationId: actor.organizationId } });
  if (validated.input.members.length) await tx.workspacePageGrant.createMany({ data: validated.input.members.map(row => ({ ...row, pageId: id, organizationId: actor.organizationId })) });
  // Capture the final audience in the document revision, within the same transaction.
  const changed = await tx.workspacePage.updateMany({ where: { id, organizationId: actor.organizationId, accessRevision: validated.input.revision }, data: { accessMode: validated.input.mode, accessRevision: { increment: 1 } } });
  if (changed.count !== 1) fail(409, 'Page access changed. Reload before saving.');
  const current = await readWorkspacePageAccess(tx, id, actor);
  if (!await recordAuditEvent(tx, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', action: 'workspace_page.access_changed', entityId: id, metadata: { fromMode: validated.current.mode, toMode: current.mode, revision: current.revision, memberCount: current.members.length } })) fail(503, 'Page access could not be saved with its audit record.');
  return current;
}
