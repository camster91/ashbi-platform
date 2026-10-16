import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createWorkspaceTools, workspaceRegistry } from '../../integrations/workspace-tools.js';
import { createToolExecutor } from '../../ai/tools/executor.js';
import { createClientServiceMapping } from '../../services/client-service-panels.service.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
function auditFailure(raw) { return new Proxy(raw, { get(target, property) {
  if (property === '$transaction') return (fn, options) => target.$transaction(tx => fn(auditFailure(tx)), options);
  if (property === 'auditEvent') return { create: args => args.data.action === 'client_service_project.published' ? Promise.reject(Error('Synthetic publication audit failure')) : target.auditEvent.create(args) };
  const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
} }); }
test('publication MCP uses migrated PostgreSQL CAS, tenant authority and report/audit/receipt atomicity', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(value => `service-publication-${value}-${randomUUID()}`); const users = [], clients = [];
  const tools = createWorkspaceTools(); const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Publication QA' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, password: randomUUID(), name: 'Publication admin', role: 'ADMIN' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Publication client' } }));
    }
    const mapping = await createClientServiceMapping(raw, users[0], clients[0].id, { provider: 'OPENSEO', providerProjectId: 'source-project', displayLabel: 'Brand QA' });
    await raw.clientServiceReport.create({ data: { organizationId: orgs[0], clientId: clients[0].id, mappingId: mapping.id, providerReportId: 'old', title: 'Old', summary: 'Old supplied report' } });
    const ctx = { user: users[0], prisma: createScopedPrisma(raw, orgs[0]), scopes: ['workspace:read', 'workspace:actions'] };
    const input = revision => ({ clientId: clients[0].id, mappingId: mapping.id, snapshot: { mappingRevision: revision, providerProjectIdMatch: 'source-project', outcome: 'OK', complete: true, reports: [{ providerReportId: 'new', title: 'New supplied report', summary: 'Synthetic supplied text', sourceReportedAt: null }] } });
    const key = randomUUID(); const args = { input: input(1), idempotencyKey: key };
    const prepared = await Promise.all([tools.call(ctx, 'publish_client_service_report_snapshot', args), tools.call(ctx, 'publish_client_service_report_snapshot', args)]);
    assert.equal(prepared[0].action.id, prepared[1].action.id); assert.equal(prepared[0].action.preview.effects.deletedCount, 1);
    const actionId = prepared[0].action.id;
    const confirmed = await Promise.allSettled([tools.call(ctx, 'confirm_action', { actionId }), tools.call(ctx, 'confirm_action', { actionId })]);
    assert.ok(confirmed.some(row => row.status === 'fulfilled' && row.value.action.status === 'EXECUTED'));
    assert.equal((await raw.clientServiceProject.findUnique({ where: { id: mapping.id } })).revision, 2);
    assert.deepEqual((await raw.clientServiceReport.findMany({ where: { mappingId: mapping.id } })).map(row => row.providerReportId), ['new']);
    assert.equal((await tools.call(ctx, 'get_action', { actionId })).action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'publish_client_service_report_snapshot', args)).idempotent, true);
    const foreign = { ...ctx, user: users[1], prisma: createScopedPrisma(raw, orgs[1]) };
    await assert.rejects(tools.call(foreign, 'publish_client_service_report_snapshot', { input: input(2), idempotencyKey: randomUUID() }));
    const rollback = await tools.call(ctx, 'publish_client_service_report_snapshot', { input: { ...input(2), snapshot: { ...input(2).snapshot, outcome: 'EMPTY', reports: [] } }, idempotencyKey: randomUUID() });
    await assert.rejects(executor.approve({ ...ctx, prisma: auditFailure(ctx.prisma) }, rollback.action.id), { code: 'EXECUTION_FAILED' });
    assert.equal((await raw.clientServiceProject.findUnique({ where: { id: mapping.id } })).revision, 2); assert.equal(await raw.clientServiceReport.count({ where: { mappingId: mapping.id } }), 1);
    assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: rollback.action.id } })).status, 'FAILED');
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'TEAM' } });
    await assert.rejects(tools.call(ctx, 'get_action', { actionId }));
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.clientServiceReport.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.clientServiceProject.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } }); await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } }); await raw.$disconnect();
  }
});
