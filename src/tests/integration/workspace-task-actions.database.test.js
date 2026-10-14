import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('confirmed task actions persist once with atomic receipts, audit and fresh permission checks', { skip: !url && 'Disposable database is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `task-action-${key}-${randomUUID()}`);
  const tools = createWorkspaceTools();
  try {
    const users = [], projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Task action fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Owner', password: randomUUID(), role: 'TEAM' } }));
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Action project' } }));
    }
    const helper = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Contributor', password: randomUUID(), role: 'TEAM' } });
    const task = await raw.task.create({ data: { projectId: projects[0].id, assigneeId: users[0].id, title: 'Confirmed changes' } });
    const ctx = { user: users[0], prisma: createScopedPrisma(raw, orgs[0]), scopes: ['workspace:read', 'workspace:actions'] };
    const input = { taskId: task.id, projectId: projects[0].id, revision: 0, userIds: [helper.id] };
    const roster = await tools.call(ctx, 'set_task_collaborators', { input, idempotencyKey: randomUUID() });
    assert.equal(await raw.taskCollaborator.count({ where: { taskId: task.id } }), 0);
    assert.equal(roster.action.preview.after[0].name, helper.name);
    const confirmed = await tools.call(ctx, 'confirm_action', { actionId: roster.action.id });
    assert.equal(confirmed.action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: roster.action.id })).idempotent, true);
    assert.equal(await raw.taskCollaborator.count({ where: { taskId: task.id } }), 1);
    assert.equal((await raw.task.findUnique({ where: { id: task.id } })).assigneeId, users[0].id);
    assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: roster.action.id } })).approvalEvidence.method, 'api_key_confirm');
    assert.ok(await raw.auditEvent.count({ where: { organizationId: orgs[0], action: 'ai.tool_executed' } }));
    const rule = { trigger: 'AFTER_COMPLETION', frequency: 'WEEKLY', interval: 1, startDate: '2026-10-14', timeZone: 'America/Toronto' };
    const recurrence = await tools.call(ctx, 'set_task_recurrence', { input: { taskId: task.id, projectId: projects[0].id, revision: 0, rule }, idempotencyKey: randomUUID() });
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: recurrence.action.id })).action.status, 'EXECUTED');
    assert.deepEqual((await raw.task.findUnique({ where: { id: task.id } })).recurrenceRule, rule);
    const stale = await tools.call(ctx, 'set_task_collaborators', { input: { ...input, revision: 1, userIds: [] }, idempotencyKey: randomUUID() });
    await raw.task.update({ where: { id: task.id }, data: { collaboratorsRevision: { increment: 1 } } });
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: stale.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal(await raw.taskCollaborator.count({ where: { taskId: task.id } }), 1);
    assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: stale.action.id } })).status, 'FAILED');
    const revoked = await tools.call(ctx, 'set_task_recurrence', { input: { taskId: task.id, projectId: projects[0].id, revision: 1, rule: null }, idempotencyKey: randomUUID() });
    await raw.user.update({ where: { id: users[0].id }, data: { isActive: false } });
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: revoked.action.id }), { code: 'EXECUTION_FAILED' });
    assert.deepEqual((await raw.task.findUnique({ where: { id: task.id } })).recurrenceRule, rule);
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
