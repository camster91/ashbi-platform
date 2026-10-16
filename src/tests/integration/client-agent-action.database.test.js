import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import routes from '../../routes/client-agent-action.routes.js';
import { reauthCookies, withSession } from '../helpers/reauth.js';
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
test('client task plugin PostgreSQL concurrency, revocation and task/receipt rollback', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `client-task-${key}-${randomUUID()}`), users = [], clients = [], projects = [];
  const tools = createWorkspaceTools();
  const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Client task fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Task teammate', password: randomUUID(), role: 'TEAM' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Canonical client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Task project', status: 'ACTIVE' } }));
      await raw.clientAgentProfile.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Account manager', instructions: '', revision: 1, enabled: true, pluginIds: ['client-work', 'client-task-actions'], createdById: users.at(-1).id, updatedById: users.at(-1).id } });
    }
    const ctx = { user: users[0], prisma: createScopedPrisma(raw, orgs[0]), scopes: ['workspace:read', 'workspace:actions'] };
    const input = { clientId: clients[0].id, projectId: projects[0].id, title: 'Review artwork', description: 'Client task proposal', priority: 'HIGH' };
    const prepare = (key = randomUUID(), overrides = {}) => tools.call(ctx, 'create_client_task', { input: { ...input, ...overrides }, idempotencyKey: key });
    const count = () => raw.task.count({ where: { projectId: projects[0].id } });
    const key = randomUUID(); const prepared = await Promise.all([prepare(key), prepare(key)]);
    assert.equal(prepared[0].action.id, prepared[1].action.id); assert.equal(await count(), 0);
    const actionId = prepared[0].action.id;
    const confirmed = await Promise.allSettled([tools.call(ctx, 'confirm_action', { actionId }), tools.call(ctx, 'confirm_action', { actionId })]);
    assert.ok(confirmed.some(row => row.status === 'fulfilled' && row.value.action.status === 'EXECUTED'));
    assert.equal(await count(), 1);
    const receipt = await raw.aiBridgeAction.findUnique({ where: { id: actionId } });
    assert.equal(receipt.status, 'EXECUTED'); assert.equal(receipt.result.task.projectId, projects[0].id);
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId })).idempotent, true);
    assert.equal((await prepare(key)).idempotent, true);
    await assert.rejects(prepare(key, { title: 'Different intent' }), { code: 'IDEMPOTENCY_CONFLICT' });
    await assert.rejects(prepare(randomUUID(), { projectId: projects[1].id }));
    const otherClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Other client' } });
    const otherProject = await raw.project.create({ data: { organizationId: orgs[0], clientId: otherClient.id, name: 'Wrong client', status: 'ACTIVE' } });
    await assert.rejects(prepare(randomUUID(), { projectId: otherProject.id }), { code: 'TARGET_UNAVAILABLE' });
    // ADMIN still cannot cross a canonical client binding.
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'ADMIN' } }); ctx.user = { ...users[0], role: 'ADMIN' };
    await assert.rejects(prepare(randomUUID(), { projectId: otherProject.id }), { code: 'TARGET_UNAVAILABLE' });
    for (const change of ['pause', 'remove-plugin', 'revision', 'remap-project', 'demote']) {
      const pending = await prepare();
      if (change === 'pause') await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { enabled: false } });
      if (change === 'remove-plugin') await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { pluginIds: ['client-work'] } });
      if (change === 'revision') await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { revision: { increment: 1 } } });
      if (change === 'remap-project') await raw.project.update({ where: { id: projects[0].id }, data: { clientId: otherClient.id } });
      if (change === 'demote') await raw.user.update({ where: { id: users[0].id }, data: { role: 'CLIENT' } });
      await assert.rejects(tools.call(ctx, 'get_action', { actionId: pending.action.id }));
      await assert.rejects(executor.approve(ctx, pending.action.id), { code: 'EXECUTION_FAILED' });
      assert.equal(await count(), 1);
      await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { enabled: true, pluginIds: ['client-work', 'client-task-actions'] } });
      await raw.project.update({ where: { id: projects[0].id }, data: { clientId: clients[0].id } });
      await raw.user.update({ where: { id: users[0].id }, data: { role: 'ADMIN' } });
    }
    // A revoked preview remains withdrawable without exposing its saved fields.
    const revokedIntent = randomUUID(); const revoked = await prepare(revokedIntent);
    await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { revision: { increment: 1 } } });
    const app = Fastify(); await app.register(cookie);
    app.decorate('authenticate', async request => { request.user = withSession(ctx.user); request.prisma = ctx.prisma; });
    await app.register(routes, { prefix: '/api/clients' });
    const base = `/api/clients/${clients[0].id}/assistant/task-actions`;
    const cookies = reauthCookies(ctx.user);
    try {
      assert.equal((await app.inject(`${base}/${revoked.action.id}`)).json().code, 'TARGET_UNAVAILABLE');
      const discarded = await app.inject({ method: 'POST', url: `${base}/by-intent/${revokedIntent}/reject`, payload: {}, cookies });
      assert.equal(discarded.statusCode, 200, discarded.body);
      assert.deepEqual(discarded.json(), { action: { id: revoked.action.id, status: 'REJECTED' } });
      assert.equal(await count(), 1);
      // Real PostgreSQL competing claims: cancellation and execution cannot both win.
      const racing = await prepare();
      await Promise.allSettled([
        executor.approve(ctx, racing.action.id, { ownerOnly: true }),
        app.inject({ method: 'POST', url: `${base}/${racing.action.id}/reject`, payload: {}, cookies }),
      ]);
      const final = await raw.aiBridgeAction.findUnique({ where: { id: racing.action.id } });
      assert.ok(['EXECUTED', 'REJECTED'].includes(final.status), `Unexpected competing claim status ${final.status}`);
      const created = await raw.task.count({ where: { id: final.result?.task?.id ?? 'no-created-task', projectId: projects[0].id } });
      assert.equal(created, final.status === 'EXECUTED' ? 1 : 0);
      if (final.status === 'EXECUTED') {
        // Keep the existing suite's one-task baseline for later rollback assertions.
        await raw.task.delete({ where: { id: final.result.task.id } });
      }
    } finally { await app.close(); }
    const expired = await prepare(); await raw.aiBridgeAction.update({ where: { id: expired.action.id }, data: { expiresAt: new Date(0) } });
    await assert.rejects(executor.approve(ctx, expired.action.id), { code: 'ACTION_EXPIRED' });
    const rollback = await prepare();
    const failureDb = new Proxy(ctx.prisma, { get(target, property) {
      if (property !== '$transaction') return target[property];
      return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, key) {
        if (key !== 'task') return inner[key];
        return { ...inner.task, create: async args => { await inner.task.create(args); throw new Error('Force rollback after task insert'); } };
      } })), options);
    } });
    await assert.rejects(executor.approve({ ...ctx, prisma: failureDb }, rollback.action.id), { code: 'EXECUTION_FAILED' });
    assert.equal(await count(), 1); assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: rollback.action.id } })).status, 'FAILED');
    await raw.clientAgentProfile.updateMany({ where: { clientId: clients[0].id }, data: { enabled: false } });
    await assert.rejects(tools.call(ctx, 'get_action', { actionId }));
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId }));
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.clientAgentProfile.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
