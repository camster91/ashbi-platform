import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createWorkspacePage, updateWorkspacePage, readWorkspacePage, listWorkspacePages } from '../../services/workspace-pages.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('project-independent knowledge preserves hierarchy, tenant scope, revisions, archives and confirmed receipts', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `knowledge-${key}-${randomUUID()}`);
  try {
    const actors = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Knowledge fixture' } });
      actors.push(await raw.user.create({ data: { organizationId, name: 'Wiki editor', email: `${randomUUID()}@e2e.example.test`, password: randomUUID(), role: 'TEAM' } }));
    }
    const a = createScopedPrisma(raw, orgs[0]), b = createScopedPrisma(raw, orgs[1]);
    const root = await createWorkspacePage(a, { title: 'Root guide', content: '# Canonical knowledge' }, actors[0]);
    const child = await createWorkspacePage(a, { title: 'Nested guide', parentId: root.id, content: 'Keep this content' }, actors[0]);
    const foreign = await createWorkspacePage(b, { title: 'Foreign guide' }, actors[1]);
    assert.equal(await raw.project.count({ where: { organizationId: { in: orgs } } }), 0);
    assert.equal(await raw.client.count({ where: { organizationId: { in: orgs } } }), 0);
    await assert.rejects(readWorkspacePage(b, root.id, actors[1]), { statusCode: 404 });
    await assert.rejects(raw.workspacePage.create({ data: { organizationId: orgs[0], authorId: actors[1].id, title: 'Foreign author' } }), /author belongs to another organization/);
    await assert.rejects(raw.workspacePage.update({ where: { id: child.id }, data: { parentId: foreign.id } }), /parent belongs to another organization/);
    await assert.rejects(raw.workspacePage.update({ where: { id: root.id }, data: { parentId: child.id } }), /hierarchy cycle/);
    await assert.rejects(raw.workspacePage.update({ where: { id: root.id }, data: { organizationId: orgs[1] } }), /organization cannot change/);
    await assert.rejects(raw.user.update({ where: { id: actors[0].id }, data: { organizationId: orgs[1] } }), /author cannot move to another organization/);
    const metadata = await listWorkspacePages(a, { limit: 1 }, actors[0]);
    assert.equal(metadata.items.length, 1); assert.equal(metadata.items[0].content, undefined); assert.ok(metadata.nextCursor);
    await updateWorkspacePage(a, root.id, { revision: 0, archived: true }, actors[0]);
    const promoted = await raw.workspacePage.findUnique({ where: { id: child.id } });
    assert.equal(promoted.parentId, null); assert.equal(promoted.content, child.content); assert.equal(promoted.revision, 1);
    await assert.rejects(raw.workspacePage.create({ data: { organizationId: orgs[0], authorId: actors[0].id, parentId: root.id, title: 'Archived parent' } }), /parent is archived/);
    assert.equal((await readWorkspacePage(a, root.id, actors[0], true)).content, root.content);
    await updateWorkspacePage(a, root.id, { revision: 1, archived: false }, actors[0]);
    const tools = createWorkspaceTools(), ctx = { prisma: a, user: actors[0], scopes: ['workspace:read', 'workspace:actions'] };
    const prepared = await tools.call(ctx, 'update_workspace_page', { input: { pageId: root.id, revision: 2, content: 'Human-reviewed update' }, idempotencyKey: randomUUID() });
    assert.equal((await raw.workspacePage.findUnique({ where: { id: root.id } })).content, root.content);
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
    assert.equal((await raw.workspacePage.findUnique({ where: { id: root.id } })).revision, 3);
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], entityId: root.id, action: 'workspace_page.updated' } }));
    const stale = await tools.call(ctx, 'update_workspace_page', { input: { pageId: root.id, revision: 3, title: 'Stale title' }, idempotencyKey: randomUUID() });
    await updateWorkspacePage(a, root.id, { revision: 3, title: 'Teammate update' }, actors[0]);
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: stale.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal((await raw.workspacePage.findUnique({ where: { id: root.id } })).title, 'Teammate update');
    const other = await createWorkspacePage(a, { title: 'Another root' }, actors[0]);
    const graphRace = await Promise.allSettled([
      updateWorkspacePage(a, root.id, { revision: 4, parentId: other.id }, actors[0]),
      updateWorkspacePage(a, other.id, { revision: 0, parentId: root.id }, actors[0]),
    ]);
    assert.equal(graphRace.filter(result => result.status === 'fulfilled').length, 1);
    const current = await raw.workspacePage.findMany({ where: { id: { in: [root.id, other.id] } } });
    assert.ok(!current.every(page => page.parentId), 'concurrent moves cannot create a cycle');
    const archivedParent = await createWorkspacePage(a, { title: 'Archive restore parent' }, actors[0]);
    const archivedChild = await createWorkspacePage(a, { title: 'Archived child', parentId: archivedParent.id }, actors[0]);
    await raw.workspacePage.update({ where: { id: archivedChild.id }, data: { archivedAt: new Date() } });
    await raw.workspacePage.update({ where: { id: archivedParent.id }, data: { archivedAt: new Date() } });
    await assert.rejects(raw.workspacePage.update({ where: { id: archivedChild.id }, data: { archivedAt: null } }), /parent is archived/);
    assert.ok((await raw.workspacePage.findUnique({ where: { id: archivedChild.id } })).archivedAt);
    await raw.workspacePage.update({ where: { id: archivedParent.id }, data: { archivedAt: null } });
    await raw.workspacePage.update({ where: { id: archivedChild.id }, data: { archivedAt: null } });
    assert.equal((await raw.workspacePage.findUnique({ where: { id: archivedChild.id } })).archivedAt, null);
    await raw.user.update({ where: { id: actors[0].id }, data: { isActive: false } });
    await assert.rejects(readWorkspacePage(a, root.id, actors[0], true), { statusCode: 403 });
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspacePage.updateMany({ where: { organizationId: { in: orgs } }, data: { parentId: null } });
    await raw.workspacePage.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
