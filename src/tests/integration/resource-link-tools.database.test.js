import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('resource MCP confirms one PostgreSQL write with atomic audit/receipt and refuses current authority or order drift', { skip: !url && 'Disposable database is not configured', timeout: 150_000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `resource-mcp-${key}-${randomUUID()}`);
  const users = [], projects = [];
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Resource MCP fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Resource staff', password: randomUUID(), role: 'TEAM' } }));
      const client = await raw.client.create({ data: { organizationId, name: 'Resource fixture client' } });
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Resource fixture project' } }));
    }
    const tools = createWorkspaceTools(), scoped = createScopedPrisma(raw, orgs[0]);
    const ctx = { prisma: scoped, user: users[0], scopes: ['workspace:read', 'workspace:actions'] };
    const base = { entityType: 'PROJECT', entityId: projects[0].id, title: 'Source edge', url: 'https://example.test/a?x=1&x=2#part', createIntentId: randomUUID(), source: { system: 'fixture', recordId: 'original-01', originalTitle: 'Source edge', originalUrl: 'https://example.test/a?x=1&x=2#part', originalCreatedAt: '2025-01-01 12:30:00', originalPosition: 2 } };
    const prepare = async (name, input, key = randomUUID()) => {
      const preview = (await tools.call(ctx, `preview_${name}`, input)).output;
      return tools.call(ctx, name, { input: { ...input, fingerprint: preview.fingerprint }, idempotencyKey: key });
    };
    await assert.rejects(prepare('create_resource_link', { ...base, entityId: projects[1].id }), { code: 'RECORD_NOT_FOUND' });
    const pending = await prepare('create_resource_link', base);
    assert.equal(await raw.resourceLink.count({ where: { organizationId: orgs[0] } }), 0);
    await tools.call(ctx, 'confirm_action', { actionId: pending.action.id }); // Treat response as lost; reconcile the receipt.
    const recovered = await tools.call(ctx, 'get_action', { actionId: pending.action.id });
    assert.equal(recovered.action.status, 'EXECUTED');
    const row = recovered.action.result;
    assert.equal(row.url, base.url); assert.deepEqual(row.source, base.source);
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
    assert.equal(await raw.resourceLink.count({ where: { organizationId: orgs[0] } }), 1);
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgs[0], action: 'resource_link.create', entityId: row.id } }), 1);
    const order = await prepare('reorder_resource_links', { entityType: 'PROJECT', entityId: projects[0].id, ordered: [{ id: row.id, expectedRevision: row.revision }] });
    const extra = await prepare('create_resource_link', { ...base, createIntentId: randomUUID(), source: { ...base.source, recordId: 'original-02' } });
    await tools.call(ctx, 'confirm_action', { actionId: extra.action.id });
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: order.action.id }), { code: 'EXECUTION_FAILED', statusCode: 409 });
    assert.equal(await raw.resourceLink.count({ where: { organizationId: orgs[0] } }), 2);
    const auditRefusing = new Proxy(scoped, { get(target, key) {
      if (key === '$transaction') return (work, options) => target.$transaction(tx => work(new Proxy(tx, { get(client, field) {
        if (field === 'auditEvent') return { ...client.auditEvent, create: args => args.data.action === 'resource_link.create' ? Promise.reject(new Error('Synthetic required audit failure')) : client.auditEvent.create(args) };
        const value = client[field]; return typeof value === 'function' ? value.bind(client) : value;
      } })), options);
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const rejected = await prepare('create_resource_link', { ...base, createIntentId: randomUUID() });
    await assert.rejects(tools.call({ ...ctx, prisma: auditRefusing }, 'confirm_action', { actionId: rejected.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal(await raw.resourceLink.count({ where: { organizationId: orgs[0] } }), 2);
    assert.equal((await tools.call(ctx, 'get_action', { actionId: rejected.action.id })).action.status, 'FAILED');
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'CLIENT' } });
    assert.equal((await tools.listCurrent(ctx)).some(tool => tool.name === 'list_resource_links'), false);
    for (const name of ['get_action', 'confirm_action']) await assert.rejects(tools.call(ctx, name, { actionId: pending.action.id }), { code: 'ROLE_DENIED' });
    assert.equal(await raw.resourceLink.count({ where: { organizationId: orgs[0] } }), 2);
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    // Disposable integration fixture only: resource links intentionally reject
    // normal deletion. Restrict trigger bypass to these random fixture orgs.
    await raw.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe('DELETE FROM resource_links WHERE "organizationId" = ANY($1::text[])', orgs);
    });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
