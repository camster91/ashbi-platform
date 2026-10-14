import { workspacePageCreateSchema, workspacePageUpdateSchema } from '../validators/schemas.js';
import { withStageTransaction } from './task-stages.service.js';
import { recordAuditEvent } from './audit-event.service.js';
import { currentWikiStaff, pageAccessContext, pageAccessSelect, authorizeWorkspacePage } from './workspace-page-authorization.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const author = { select: { id: true, name: true, isActive: true } };
async function audit(prisma, page, actor, action) {
  const event = await recordAuditEvent(prisma, { organizationId: actor.organizationId, actorUserId: actor.id, actorType: 'USER', action, entityId: page.id, metadata: { revision: page.revision, parentId: page.parentId } });
  if (!event) fail(503, 'Knowledge page could not be saved with its audit record. Your draft is retained.');
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
  const access = await pageAccessContext(prisma, actor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof search !== 'string' || search.length > 200 || typeof includeArchived !== 'boolean' || (after !== undefined && (typeof after !== 'string' || !after || after.length > 80))) fail(400, 'Invalid knowledge page query');
  const visible = []; let cursor = after;
  while (visible.length <= limit) {
    const rows = await prisma.workspacePage.findMany({ where: { organizationId: access.user.organizationId, ...(includeArchived ? {} : { archivedAt: null }), ...(cursor ? { id: { gt: cursor } } : {}), ...(parentId !== undefined ? { parentId: parentId === 'ROOT' ? null : parentId } : {}), ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }] } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { ...pageAccessSelect(access.user.id), title: true, revision: true, updatedAt: true } });
    await access.load(rows.map(row => row.id), rows);
    for (const row of rows) {
      const permissions = access.rights(row.id);
      if (permissions.canRead) { const { grants: _grants, organizationId: _organizationId, ...metadata } = row; visible.push({ ...metadata, permissions }); }
      if (visible.length > limit) break;
    }
    access.clear();
    if (visible.length > limit || rows.length < 100) break;
    cursor = rows.at(-1).id;
  }
  return { items: visible.slice(0, limit), nextCursor: visible.length > limit ? visible[limit - 1].id : null };
}
export async function readWorkspacePage(prisma, id, actor, includeArchived = false) {
  const access = await authorizeWorkspacePage(prisma, id, actor, { includeArchived });
  const page = await prisma.workspacePage.findFirst({ where: { id, organizationId: access.user.organizationId, ...(includeArchived ? {} : { archivedAt: null }) }, include: { author } });
  if (!page) fail(404, 'Knowledge page not found');
  return { ...page, permissions: access.permissions, contentFormat: 'MARKDOWN_PLAINTEXT' };
}
export async function createWorkspacePage(prisma, input, actor) {
  return withStageTransaction(prisma, tx => createWorkspacePageInTransaction(tx, input, actor), 'Knowledge pages changed while saving. Reload and try again.');
}
export async function createWorkspacePageInTransaction(tx, input, actor) {
  const parsed = workspacePageCreateSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Enter a title, bounded Markdown content and an available parent page.');
    await currentWikiStaff(tx, actor);
    if (parsed.data.parentId) await authorizeWorkspacePage(tx, parsed.data.parentId, actor, { edit: true, includeArchived: false });
    await validateWorkspacePageParent(tx, parsed.data.parentId, actor.organizationId);
    const page = await tx.workspacePage.create({ data: { ...parsed.data, organizationId: actor.organizationId, authorId: actor.id }, include: { author } });
    await audit(tx, page, actor, 'workspace_page.created');
    return readWorkspacePage(tx, page.id, actor, true);
}
export async function updateWorkspacePage(prisma, id, input, actor) {
  return withStageTransaction(prisma, tx => updateWorkspacePageInTransaction(tx, id, input, actor), 'Knowledge pages changed while saving. Your draft is retained; reload before saving.');
}
export async function updateWorkspacePageInTransaction(tx, id, input, actor) {
  const parsed = workspacePageUpdateSchema.safeParse(input);
  if (!parsed.success) fail(400, 'Provide the observed page revision and valid page changes.');
    await validateWorkspacePageChange(tx, id, parsed.data, actor);
    const { revision, archived, ...changes } = parsed.data;
    const changed = await tx.workspacePage.updateMany({ where: { id, organizationId: actor.organizationId, revision }, data: { ...changes, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    if (changed.count !== 1) fail(409, 'Knowledge page changed. Your draft is retained; reload before saving.');
    const page = await tx.workspacePage.findFirst({ where: { id, organizationId: actor.organizationId }, include: { author } });
    await audit(tx, page, actor, archived === true ? 'workspace_page.archived' : archived === false ? 'workspace_page.restored' : 'workspace_page.updated');
    return readWorkspacePage(tx, page.id, actor, true);
}

export async function validateWorkspacePageChange(prisma, id, input, actor) {
  const access = await authorizeWorkspacePage(prisma, id, actor, { edit: true });
  const current = access.page;
  if (current.revision !== input.revision) fail(409, 'Knowledge page changed. Your draft is retained; reload before saving.');
  const moving = input.parentId !== undefined && input.parentId !== current.parentId;
  const archiving = input.archived !== undefined && input.archived !== Boolean(current.archivedAt);
  if ((moving || archiving) && !access.permissions.canManage) fail(403, 'The page owner or an administrator manages hierarchy and archive');
  if (current.archivedAt && input.archived !== false) fail(409, 'Restore this page before editing it.');
  if (moving && input.parentId) await authorizeWorkspacePage(prisma, input.parentId, actor, { edit: true, includeArchived: false });
  await validateWorkspacePageParent(prisma, moving ? input.parentId : current.parentId, access.user.organizationId, id);
  if (input.archived === true && current.accessMode === 'RESTRICTED' && await prisma.workspacePage.count({ where: { parentId: id, organizationId: access.user.organizationId, archivedAt: null } })) fail(409, 'Move or archive nested pages before archiving a restricted page');
  return access;
}
