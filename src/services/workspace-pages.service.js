import { workspacePageCreateSchema, workspacePageUpdateSchema } from '../validators/schemas.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const author = { select: { id: true, name: true, isActive: true } };
async function audit(prisma, page, actor, action) {
  const event = await recordAuditEvent(prisma, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', action, entityId: page.id, metadata: { revision: page.revision, parentId: page.parentId } });
  if (!event) fail(503, 'Knowledge page could not be saved with its audit record. Your draft is retained.');
}
async function staff(prisma, actor) {
  if (!actor?.organizationId || !['ADMIN', 'TEAM'].includes(actor.role)) fail(403, 'Team access required');
  const current = await prisma.user.findFirst({ where: { id: actor.id, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } });
  if (!current) fail(403, 'Team access required');
}
export async function validateWorkspacePageParent(prisma, parentId, organizationId, pageId) {
  if (!parentId) return;
  const visited = new Set(pageId ? [pageId] : []);
  let currentId = parentId;
  for (let depth = 0; currentId; depth++) {
    if (visited.has(currentId) || depth >= 200) fail(400, 'Choose a parent outside this page’s descendants.');
    visited.add(currentId);
    const current = await prisma.workspacePage.findFirst({ where: { id: currentId, organizationId, archivedAt: null }, select: { id: true, parentId: true } });
    if (!current) fail(404, 'Parent page is unavailable');
    currentId = current.parentId;
  }
}
export async function listWorkspacePages(prisma, { limit = 25, after, search = '', includeArchived = false, parentId } = {}, actor) {
  await staff(prisma, actor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof search !== 'string' || search.length > 200 || typeof includeArchived !== 'boolean' || (after !== undefined && (typeof after !== 'string' || !after || after.length > 80))) fail(400, 'Invalid knowledge page query');
  const rows = await prisma.workspacePage.findMany({ where: { organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }), ...(after ? { id: { gt: after } } : {}), ...(parentId !== undefined ? { parentId: parentId === 'ROOT' ? null : parentId } : {}), ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }] } : {}) },
    orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, title: true, parentId: true, revision: true, archivedAt: true, authorId: true, updatedAt: true } });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function readWorkspacePage(prisma, id, actor, includeArchived = false) {
  await staff(prisma, actor);
  const page = await prisma.workspacePage.findFirst({ where: { id, organizationId: actor.organizationId, ...(includeArchived ? {} : { archivedAt: null }) }, include: { author } });
  if (!page) fail(404, 'Knowledge page not found');
  return { ...page, contentFormat: 'MARKDOWN_PLAINTEXT' };
}
export async function createWorkspacePage(prisma, input, actor) {
  return withStageTransaction(prisma, tx => createWorkspacePageInTransaction(tx, input, actor), 'Knowledge pages changed while saving. Reload and try again.');
}
export async function createWorkspacePageInTransaction(tx, input, actor) {
  const parsed = workspacePageCreateSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Enter a title, bounded Markdown content and an available parent page.');
    await staff(tx, actor);
    await validateWorkspacePageParent(tx, parsed.data.parentId, actor.organizationId);
    const page = await tx.workspacePage.create({ data: { ...parsed.data, organizationId: actor.organizationId, authorId: actor.id }, include: { author } });
    await audit(tx, page, actor, 'workspace_page.created');
    return page;
}
export async function updateWorkspacePage(prisma, id, input, actor) {
  return withStageTransaction(prisma, tx => updateWorkspacePageInTransaction(tx, id, input, actor), 'Knowledge pages changed while saving. Your draft is retained; reload before saving.');
}
export async function updateWorkspacePageInTransaction(tx, id, input, actor) {
  const parsed = workspacePageUpdateSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Provide the observed page revision and valid page changes.');
    await staff(tx, actor);
    const current = await tx.workspacePage.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!current) fail(404, 'Knowledge page not found');
    if (current.revision !== parsed.data.revision) fail(409, 'Knowledge page changed. Your draft is retained; reload before saving.');
    const { revision, archived, ...changes } = parsed.data;
    if (current.archivedAt && archived !== false) fail(409, 'Restore this page before editing it.');
    await validateWorkspacePageParent(tx, changes.parentId === undefined ? current.parentId : changes.parentId, actor.organizationId, id);
    const changed = await tx.workspacePage.updateMany({ where: { id, organizationId: actor.organizationId, revision }, data: { ...changes, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    if (changed.count !== 1) fail(409, 'Knowledge page changed. Your draft is retained; reload before saving.');
    const page = await tx.workspacePage.findFirst({ where: { id, organizationId: actor.organizationId }, include: { author } });
    await audit(tx, page, actor, archived === true ? 'workspace_page.archived' : archived === false ? 'workspace_page.restored' : 'workspace_page.updated');
    return page;
}
