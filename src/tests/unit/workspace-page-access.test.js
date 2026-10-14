import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { listWorkspacePages, readWorkspacePage, updateWorkspacePage } from '../../services/workspace-pages.service.js';
import { readWorkspacePageAccess, saveWorkspacePageAccess } from '../../services/workspace-page-access.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const ownerId = 'cabcdefghijklmnopqrstuv01', memberId = 'cabcdefghijklmnopqrstuv02', foreignId = 'cabcdefghijklmnopqrstuv03';
const rootId = 'cabcdefghijklmnopqrstuvwa', childId = 'cabcdefghijklmnopqrstuvwb';
function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  for (const user of db.tables.user) user.isActive = true;
  db.tables.user.find(row => row.id === 'team-a').id = ownerId;
  db.tables.user.find(row => row.id === 'team2-a').id = memberId;
  db.tables.user.find(row => row.id === 'team-b').id = foreignId;
  const owner = structuredClone(db.tables.user.find(row => row.id === ownerId)), member = structuredClone(db.tables.user.find(row => row.id === memberId));
  db.tables.workspacePage.push(
    { id: rootId, organizationId: 'org-a', authorId: ownerId, parentId: null, title: 'Private root', content: 'Private source', revision: 0, accessMode: 'RESTRICTED', accessRevision: 0, archivedAt: null },
    { id: childId, organizationId: 'org-a', authorId: ownerId, parentId: rootId, title: 'Private descendant', content: 'Private detail', revision: 0, accessMode: 'TEAM', accessRevision: 0, archivedAt: null },
  );
  const update = db.workspacePage.updateMany;
  db.workspacePage.updateMany = args => update({ ...args, data: { ...args.data, revision: { increment: 1 } } });
  return { db, owner, member, tools: createWorkspaceTools() };
}
test('private ancestor permissions deny direct reads, child grants, search, hierarchy and MCP discovery', async () => {
  const { db, owner, member, tools } = fixture();
  db.tables.workspacePageGrant.push({ id: 'child-grant', pageId: childId, organizationId: 'org-a', userId: memberId, role: 'EDIT' });
  await assert.rejects(readWorkspacePage(db, rootId, member), { statusCode: 404 });
  await assert.rejects(readWorkspacePage(db, childId, member), { statusCode: 404 });
  assert.deepEqual((await listWorkspacePages(db, { search: 'Private' }, member)).items, []);
  assert.deepEqual((await listWorkspacePages(db, { parentId: rootId }, member)).items, []);
  const ctx = { prisma: db, user: member, scopes: ['workspace:read', 'workspace:actions'] };
  assert.deepEqual((await tools.call(ctx, 'list_workspace_pages', { search: 'Private' })).output.items, []);
  await assert.rejects(tools.call(ctx, 'get_workspace_page', { pageId: childId }));
  assert.ok(db.tables.auditEvent.some(row => row.action === 'ai.tool_denied'));
  assert.equal((await readWorkspacePage(db, childId, owner)).permissions.canManage, true);
});
test('readers cannot write or inspect grants; editors cannot change hierarchy, archive or access', async () => {
  const { db, owner, member } = fixture();
  await saveWorkspacePageAccess(db, rootId, { revision: 0, mode: 'RESTRICTED', members: [{ userId: memberId, role: 'READ' }] }, owner);
  assert.equal((await readWorkspacePage(db, rootId, member)).permissions.canEdit, false);
  assert.equal((await readWorkspacePage(db, childId, member)).permissions.canEdit, false, 'Read-only parent access remains read only in descendants');
  await assert.rejects(updateWorkspacePage(db, rootId, { revision: 1, content: 'Reader overwrite' }, member), { statusCode: 403 });
  await assert.rejects(readWorkspacePageAccess(db, rootId, member), { statusCode: 403 });
  await saveWorkspacePageAccess(db, rootId, { revision: 1, mode: 'RESTRICTED', members: [{ userId: memberId, role: 'EDIT' }] }, owner);
  await updateWorkspacePage(db, rootId, { revision: 2, content: 'Permitted editor update' }, member);
  await assert.rejects(updateWorkspacePage(db, childId, { revision: 0, parentId: null }, member), { statusCode: 403 });
  await assert.rejects(updateWorkspacePage(db, rootId, { revision: 3, archived: true }, member), { statusCode: 403 });
});
test('pagination scans hidden batches to fill a visible page without exposing hidden cursors or names', async () => {
  const { db, member } = fixture();
  for (let index = 0; index < 110; index++) db.tables.workspacePage.push({ id: `hidden-${String(index).padStart(3, '0')}`, organizationId: 'org-a', authorId: ownerId, parentId: null, accessMode: 'RESTRICTED', archivedAt: null, title: 'Hidden' });
  for (let index = 0; index < 3; index++) db.tables.workspacePage.push({ id: `visible-${index}`, organizationId: 'org-a', authorId: ownerId, parentId: null, accessMode: 'TEAM', archivedAt: null, title: `Visible ${index}` });
  const page = await listWorkspacePages(db, { limit: 2 }, member);
  assert.deepEqual(page.items.map(row => row.id), ['visible-0', 'visible-1']);
  assert.equal(page.nextCursor, 'visible-1');
  assert.deepEqual((await listWorkspacePages(db, { limit: 2, after: page.nextCursor }, member)).items.map(row => row.id), ['visible-2']);
});
test('restricted parents cannot auto-promote children on archive, and stale administrator claims do not bypass access', async () => {
  const { db, owner } = fixture();
  await assert.rejects(updateWorkspacePage(db, rootId, { revision: 0, archived: true }, owner), { statusCode: 409 });
  const admin = structuredClone(db.tables.user.find(row => row.id === 'admin-a'));
  db.tables.user.find(row => row.id === admin.id).role = 'TEAM';
  await assert.rejects(readWorkspacePage(db, rootId, admin), { statusCode: 404 });
  await assert.rejects(saveWorkspacePageAccess(db, rootId, { revision: 0, mode: 'RESTRICTED', members: [{ userId: foreignId, role: 'READ' }] }, owner), { statusCode: 404 });
  await assert.rejects(saveWorkspacePageAccess(db, rootId, { revision: 0, mode: 'RESTRICTED', members: [{ userId: ownerId, role: 'READ' }] }, owner), { statusCode: 400 });
});

test('confirmed access changes require owner review and a content action cannot outlive revoked permissions', async () => {
  const { db, owner, member, tools } = fixture();
  const ctx = { prisma: db, user: owner, scopes: ['workspace:read', 'workspace:actions'] };
  const prepared = await tools.call(ctx, 'set_workspace_page_access', { input: { pageId: rootId, revision: 0, mode: 'RESTRICTED', members: [{ userId: memberId, role: 'EDIT' }] }, idempotencyKey: 'page-access-1' });
  assert.equal(db.tables.workspacePageGrant.length, 0);
  assert.equal(prepared.action.preview.after.members[0].name, 'Second A');
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
  const editCtx = { ...ctx, user: member };
  const edit = await tools.call(editCtx, 'update_workspace_page', { input: { pageId: rootId, revision: 1, content: 'Queued editor draft' }, idempotencyKey: 'page-edit-1' });
  await saveWorkspacePageAccess(db, rootId, { revision: 1, mode: 'RESTRICTED', members: [] }, owner);
  await assert.rejects(tools.call(editCtx, 'confirm_action', { actionId: edit.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(db.tables.workspacePage[0].content, 'Private source');
});
