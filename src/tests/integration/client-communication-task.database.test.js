import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createWorkspaceTools, workspaceRegistry } from '../../integrations/workspace-tools.js';
import { createToolExecutor } from '../../ai/tools/executor.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('stored inbox task confirmation is source-bound, tenant-safe, concurrent-idempotent and atomic in PostgreSQL', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `communication-task-${key}-${randomUUID()}`);
  const users = [], clients = [], projects = [], threadIds = [];
  const tools = createWorkspaceTools();
  const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Source-linked task fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Communication teammate', password: randomUUID(), role: 'TEAM' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Canonical task client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Task project' } }));
    }
    const helper = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Other teammate', password: randomUUID(), role: 'TEAM' } });
    const ctx = { user: users[0], prisma: createScopedPrisma(raw, orgs[0]), scopes: ['workspace:read', 'workspace:actions'] };
    const thread = await raw.thread.create({ data: { subject: 'Client request', clientId: clients[0].id, assignedToId: users[0].id } }); threadIds.push(thread.id);
    const message = await raw.message.create({ data: { threadId: thread.id, direction: 'INBOUND', senderEmail: 'client@example.test', subject: 'Artwork review', bodyText: 'Please review this artwork', receivedAt: new Date('2026-10-16T12:00:00Z') } });
    const input = { clientId: clients[0].id, source: 'inbox', messageId: message.id, projectId: projects[0].id, title: 'Review client artwork', priority: 'HIGH' };
    const prepare = (key = randomUUID(), overrides = {}) => tools.call(ctx, 'create_task_from_client_message', { input: { ...input, ...overrides }, idempotencyKey: key });
    const count = () => raw.task.count({ where: { projectId: projects[0].id } });

    const key = randomUUID();
    const prepared = await Promise.all([prepare(key), prepare(key)]);
    assert.equal(prepared[0].action.id, prepared[1].action.id);
    assert.equal(await count(), 0);
    assert.equal(prepared[0].action.preview.source.subject, message.subject);
    const actionId = prepared[0].action.id;
    const confirmed = await Promise.allSettled([tools.call(ctx, 'confirm_action', { actionId }), tools.call(ctx, 'confirm_action', { actionId })]);
    assert.ok(confirmed.some(result => result.status === 'fulfilled' && result.value.action.status === 'EXECUTED'));
    assert.equal(await count(), 1);
    const receipt = await raw.aiBridgeAction.findUnique({ where: { id: actionId } });
    assert.equal(receipt.status, 'EXECUTED'); assert.equal(receipt.result.task.sourceThreadId, thread.id);
    assert.equal((await raw.task.findUnique({ where: { id: receipt.result.task.id } })).sourceThreadId, thread.id);
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId })).idempotent, true);
    await assert.rejects(prepare(key, { title: 'Changed title' }), { code: 'IDEMPOTENCY_CONFLICT' });

    await assert.rejects(prepare(randomUUID(), { projectId: projects[1].id }));
    const sameOrgClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Other canonical client' } });
    const otherProject = await raw.project.create({ data: { organizationId: orgs[0], clientId: sameOrgClient.id, name: 'Wrong client' } });
    await assert.rejects(prepare(randomUUID(), { projectId: otherProject.id }), { code: 'TARGET_UNAVAILABLE' });

    const stale = await prepare();
    await raw.message.update({ where: { id: message.id }, data: { bodyText: 'Updated request after preview' } });
    await assert.rejects(executor.approve(ctx, stale.action.id, { method: 'api_key_confirm', ownerOnly: true }), { code: 'EXECUTION_FAILED' });
    assert.equal(await count(), 1); assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: stale.action.id } })).errorCode, 'ACTION_TARGET_UNAVAILABLE');

    const revoked = await prepare();
    await raw.thread.update({ where: { id: thread.id }, data: { assignedToId: helper.id } });
    await assert.rejects(tools.call(ctx, 'get_action', { actionId: revoked.action.id }));
    await assert.rejects(executor.approve(ctx, revoked.action.id, { method: 'api_key_confirm', ownerOnly: true }), { code: 'EXECUTION_FAILED' });
    await raw.thread.update({ where: { id: thread.id }, data: { assignedToId: users[0].id } });
    assert.equal(await count(), 1);

    const roleRevoked = await prepare();
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'CLIENT' } });
    await assert.rejects(executor.approve(ctx, roleRevoked.action.id, { method: 'api_key_confirm', ownerOnly: true }), { code: 'EXECUTION_FAILED' });
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'TEAM' } });
    assert.equal(await count(), 1);

    for (const target of ['project', 'client', 'message']) {
      const pending = await prepare();
      if (target === 'message') await raw.message.delete({ where: { id: message.id } });
      else await raw[target].update({ where: { id: target === 'project' ? projects[0].id : clients[0].id }, data: { deletedAt: new Date() } });
      await assert.rejects(executor.approve(ctx, pending.action.id, { method: 'api_key_confirm', ownerOnly: true }), { code: 'EXECUTION_FAILED' });
      assert.equal(await count(), 1);
      if (target !== 'message') await raw[target].update({ where: { id: target === 'project' ? projects[0].id : clients[0].id }, data: { deletedAt: null } });
    }

    // New source for the remaining expiry and real rollback exercises.
    const nextMessage = await raw.message.create({ data: { threadId: thread.id, direction: 'INBOUND', senderEmail: 'client@example.test', subject: 'Second request', bodyText: 'Stored request' } });
    input.messageId = nextMessage.id;
    const expired = await prepare();
    await raw.aiBridgeAction.update({ where: { id: expired.action.id }, data: { expiresAt: new Date(0) } });
    await assert.rejects(executor.approve(ctx, expired.action.id), { code: 'ACTION_EXPIRED' });
    assert.equal(await count(), 1);

    const rollback = await prepare();
    const failureDb = new Proxy(ctx.prisma, { get(target, key) {
      if (key !== '$transaction') return target[key];
      return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, property) {
        if (property !== 'task') return inner[property];
        return { ...inner.task, create: async args => { await inner.task.create(args); throw new Error('Force rollback after task insert'); } };
      } })), options);
    } });
    await assert.rejects(executor.approve({ ...ctx, prisma: failureDb }, rollback.action.id), { code: 'EXECUTION_FAILED' });
    assert.equal(await count(), 1);
    assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: rollback.action.id } })).status, 'FAILED');
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.message.deleteMany({ where: { threadId: { in: threadIds } } });
    await raw.thread.deleteMany({ where: { id: { in: threadIds } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
