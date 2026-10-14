import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createWorkspacePage, listWorkspacePages, readWorkspacePage, updateWorkspacePage } from '../../services/workspace-pages.service.js';
import Fastify from 'fastify';
import workspaceWikiRoutes from '../../routes/workspace-wiki.routes.js';

const ids = ['cabcdefghijklmnopqrstuvwa', 'cabcdefghijklmnopqrstuvwb', 'cabcdefghijklmnopqrstuvwc', 'cabcdefghijklmnopqrstuvwd'];
function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  for (const row of db.tables.user) row.isActive = true;
  let index = 0;
  const create = db.workspacePage.create;
  db.workspacePage.create = args => create({ ...args, data: { revision: 0, archivedAt: null, parentId: null, ...args.data, id: ids[index++] } });
  const update = db.workspacePage.updateMany;
  db.workspacePage.updateMany = args => update({ ...args, data: { ...args.data, revision: { increment: 1 } } });
  const actor = structuredClone(db.tables.user.find(row => row.id === 'team-a'));
  return { db, actor, ctx: { prisma: db, user: actor, scopes: ['workspace:read', 'workspace:actions'] }, tools: createWorkspaceTools() };
}

test('workspace knowledge has no client/project dependency, is scoped and pages bounded metadata', async () => {
  const { db, actor } = fixture();
  const root = await createWorkspacePage(db, { title: 'Team knowledge', content: '# Shared guide' }, actor);
  const child = await createWorkspacePage(db, { title: 'Nested guide', parentId: root.id }, actor);
  assert.equal(root.projectId, undefined); assert.equal(root.clientId, undefined); assert.equal(child.parentId, root.id);
  assert.equal(db.tables.project.length, 2); assert.equal(db.tables.client.length, 2);
  const first = await listWorkspacePages(db, { limit: 1 }, actor);
  assert.equal(first.items.length, 1); assert.equal(first.items[0].content, undefined);
  assert.equal((await listWorkspacePages(db, { limit: 1, after: first.nextCursor }, actor)).items[0].id, child.id);
  await assert.rejects(readWorkspacePage(db, root.id, { ...actor, organizationId: 'org-b', id: 'team-b' }), { statusCode: 404 });
  await assert.rejects(createWorkspacePage(db, { title: 'Foreign parent', parentId: root.id }, { ...actor, organizationId: 'org-b', id: 'team-b' }), { statusCode: 404 });
  await assert.rejects(readWorkspacePage(db, root.id, { ...actor, role: 'CLIENT' }), { statusCode: 403 });
  await assert.rejects(updateWorkspacePage(db, root.id, { revision: 0, parentId: child.id }, actor), { statusCode: 400 });
});

test('stale edits and unavailable staff are rejected; archive retains content and restore needs the current revision', async () => {
  const { db, actor } = fixture();
  const page = await createWorkspacePage(db, { title: 'Guide', content: 'Keep this content' }, actor);
  await updateWorkspacePage(db, page.id, { revision: 0, content: 'Team edit' }, actor);
  const audits = db.tables.auditEvent.length;
  await assert.rejects(updateWorkspacePage(db, page.id, { revision: 0, content: 'Stale draft' }, actor), { statusCode: 409 });
  assert.equal(db.tables.auditEvent.length, audits);
  await updateWorkspacePage(db, page.id, { revision: 1, archived: true }, actor);
  await assert.rejects(readWorkspacePage(db, page.id, actor), { statusCode: 404 });
  assert.equal((await readWorkspacePage(db, page.id, actor, true)).content, 'Team edit');
  await assert.rejects(updateWorkspacePage(db, page.id, { revision: 2, content: 'Hidden edit' }, actor), { statusCode: 409 });
  await updateWorkspacePage(db, page.id, { revision: 2, archived: false }, actor);
  db.tables.user.find(row => row.id === actor.id).isActive = false;
  await assert.rejects(updateWorkspacePage(db, page.id, { revision: 3, title: 'Deactivated author' }, actor), { statusCode: 403 });
});

test('confirmed wiki actions show exact content, execute once and refuse stale confirmation', async () => {
  const { db, ctx, tools } = fixture();
  const prepared = await tools.call(ctx, 'create_workspace_page', { input: { title: 'Approved guide', content: 'Exact human-reviewed content' }, idempotencyKey: 'wiki-create-1' });
  assert.equal(db.tables.workspacePage.length, 0);
  assert.equal(prepared.action.preview.content, 'Exact human-reviewed content');
  const result = await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id });
  assert.equal(result.action.status, 'EXECUTED'); assert.equal(db.tables.workspacePage.length, 1);
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
  const page = db.tables.workspacePage[0];
  const change = await tools.call(ctx, 'update_workspace_page', { input: { pageId: page.id, revision: 0, content: 'Proposed edit' }, idempotencyKey: 'wiki-update-1' });
  page.revision = 1;
  await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: change.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(db.tables.workspacePage[0].content, 'Exact human-reviewed content');
  await assert.rejects(tools.call({ ...ctx, scopes: ['workspace:read'] }, 'create_workspace_page', {}), { code: 'TOOL_UNAVAILABLE' });
  assert.ok(db.tables.auditEvent.some(row => row.action === 'workspace_page.created'));
});

test('a failed audit write rolls back the new knowledge page', async () => {
  const { db, actor } = fixture();
  db.auditEvent.create = async () => { throw new Error('Disposable audit outage'); };
  await assert.rejects(createWorkspacePage(db, { title: 'Retained draft' }, actor), { statusCode: 503 });
  assert.equal(db.tables.workspacePage.length, 0);
});

test('wiki HTTP routes authenticate staff, publish bounded queries and require revisions', async () => {
  const { db, actor } = fixture();
  const app = Fastify();
  app.decorate('authenticate', async request => {
    if (!request.headers['x-test-role']) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    request.user = { ...actor, role: request.headers['x-test-role'] }; request.prisma = db;
  });
  await app.register(workspaceWikiRoutes, { prefix: '/api/wiki' });
  const headers = { 'x-test-role': 'TEAM' };
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/wiki/pages' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/wiki/pages', headers: { 'x-test-role': 'CLIENT' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/wiki/pages?limit=51', headers })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/wiki/pages?includeArchived=anything', headers })).statusCode, 400);
    const created = await app.inject({ method: 'POST', url: '/api/wiki/pages', headers, payload: { title: 'HTTP knowledge' } });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    assert.equal((await app.inject({ method: 'PUT', url: `/api/wiki/pages/${id}`, headers, payload: { content: 'Unversioned' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/wiki/pages/${id}`, headers, payload: { revision: 0, content: 'Observed edit' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/wiki/pages/${id}`, headers, payload: { revision: 0, content: 'Stale edit' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/wiki/pages', headers, payload: { title: 'Attempt ownership override', organizationId: 'org-b' } })).statusCode, 400);
  } finally { await app.close(); }
});
