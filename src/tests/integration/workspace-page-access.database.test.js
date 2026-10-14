import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createWorkspacePage, readWorkspacePage, listWorkspacePages, updateWorkspacePage } from '../../services/workspace-pages.service.js';
import { readWorkspacePageAccess, saveWorkspacePageAccess } from '../../services/workspace-page-access.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('restricted knowledge enforces inherited access, raw grant boundaries and fresh confirmed permissions', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `page-access-${key}-${randomUUID()}`);
  try {
    for (const organizationId of orgs) await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Page access fixture' } });
    const people = [];
    for (const [organizationId, role] of [[orgs[0], 'TEAM'], [orgs[0], 'TEAM'], [orgs[1], 'TEAM'], [orgs[0], 'ADMIN'], [orgs[0], 'CLIENT']]) people.push(await raw.user.create({ data: { organizationId, role, name: 'Page access QA', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } }));
    const a = createScopedPrisma(raw, orgs[0]), b = createScopedPrisma(raw, orgs[1]);
    const root = await createWorkspacePage(a, { title: 'Restricted root', content: 'Confidential source', accessMode: 'RESTRICTED' }, people[0]);
    const child = await createWorkspacePage(a, { title: 'Restricted descendant', parentId: root.id }, people[0]);
    await assert.rejects(readWorkspacePage(a, root.id, people[1]), { statusCode: 404 });
    await assert.rejects(readWorkspacePage(a, child.id, people[1]), { statusCode: 404 });
    assert.deepEqual((await listWorkspacePages(a, { search: 'Restricted' }, people[1])).items, []);
    await assert.rejects(readWorkspacePage(b, root.id, people[2]), { statusCode: 404 });
    await assert.rejects(readWorkspacePage(a, root.id, people[4]), { statusCode: 403 });
    await assert.rejects(raw.workspacePageGrant.create({ data: { organizationId: orgs[0], pageId: root.id, userId: people[2].id, role: 'READ' } }), /belongs to another organization/);
    await assert.rejects(raw.workspacePage.update({ where: { id: root.id }, data: { authorId: people[1].id } }), /author cannot change/);
    const access = await saveWorkspacePageAccess(a, root.id, { revision: 0, mode: 'RESTRICTED', members: [{ userId: people[1].id, role: 'READ' }] }, people[0]);
    assert.ok(access.revision > 0);
    assert.equal((await readWorkspacePage(a, child.id, people[1])).permissions.canEdit, false);
    await assert.rejects(readWorkspacePageAccess(a, root.id, people[1]), { statusCode: 403 });
    await assert.rejects(raw.user.update({ where: { id: people[1].id }, data: { organizationId: orgs[1] } }), /grantee cannot move to another organization/);
    const rootBeforeRaw = await raw.workspacePage.findUnique({ where: { id: root.id } });
    await raw.workspacePageGrant.updateMany({ where: { pageId: root.id, userId: people[1].id }, data: { role: 'EDIT' } });
    const rootAfterRaw = await raw.workspacePage.findUnique({ where: { id: root.id } });
    assert.ok(rootAfterRaw.accessRevision > rootBeforeRaw.accessRevision);
    assert.ok(rootAfterRaw.revision > rootBeforeRaw.revision);
    assert.equal((await readWorkspacePage(a, child.id, people[1])).permissions.canEdit, true);
    await assert.rejects(updateWorkspacePage(a, root.id, { revision: rootAfterRaw.revision, archived: true }, people[0]), { statusCode: 409 });
    await assert.rejects(raw.workspacePage.update({ where: { id: root.id }, data: { archivedAt: new Date() } }), /Move or archive nested pages/);
    const tools = createWorkspaceTools();
    const ctx = { prisma: a, user: people[1], scopes: ['workspace:read', 'workspace:actions'] };
    const edit = await tools.call(ctx, 'update_workspace_page', { input: { pageId: root.id, revision: rootAfterRaw.revision, content: 'Queued editor draft' }, idempotencyKey: randomUUID() });
    const beforeRevoke = await readWorkspacePageAccess(a, root.id, people[0]);
    await saveWorkspacePageAccess(a, root.id, { revision: beforeRevoke.revision, mode: 'RESTRICTED', members: [] }, people[0]);
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: edit.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal((await raw.workspacePage.findUnique({ where: { id: root.id } })).content, 'Confidential source');
    const ownerCtx = { ...ctx, user: people[0] };
    const current = await readWorkspacePageAccess(a, root.id, people[0]);
    const prepared = await tools.call(ownerCtx, 'set_workspace_page_access', { input: { pageId: root.id, revision: current.revision, mode: 'RESTRICTED', members: [{ userId: people[1].id, role: 'READ' }] }, idempotencyKey: randomUUID() });
    assert.equal((await tools.call(ownerCtx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
    assert.equal((await tools.call(ownerCtx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
    const final = await readWorkspacePageAccess(a, root.id, people[0]);
    const competing = await Promise.allSettled([
      saveWorkspacePageAccess(a, root.id, { revision: final.revision, mode: 'TEAM', members: [] }, people[0]),
      saveWorkspacePageAccess(a, root.id, { revision: final.revision, mode: 'RESTRICTED', members: [] }, people[0]),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], action: 'workspace_page.access_changed' } }));
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspacePageGrant.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspacePage.updateMany({ where: { organizationId: { in: orgs } }, data: { parentId: null } });
    await raw.workspacePage.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
