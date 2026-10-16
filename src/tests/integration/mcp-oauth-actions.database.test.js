import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createClientServiceMapping } from '../../services/client-service-panels.service.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('migrated OAuth action binding is immutable and current key authority guards Serializable publication', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizationId = `scoped-oauth-${randomUUID()}`;
  const scopes = ['workspace:read', 'workspace:service-reports:publish'];
  try {
    await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Scoped OAuth disposable QA' } });
    const user = await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, password: randomUUID(), name: 'OAuth fixture', role: 'ADMIN' } });
    const client = await raw.client.create({ data: { organizationId, name: 'Synthetic canonical client' } });
    const mapping = await createClientServiceMapping(raw, user, client.id, { provider: 'OPENSEO', providerProjectId: 'fixture-source', displayLabel: 'Fixture reports' });
    const key = await raw.apiKey.create({ data: { userId: user.id, name: 'Disposable scoped grant', key: randomUUID(), scopes, expiresAt: new Date(Date.now() + 3600000) } });
    const ctx = { prisma: raw, user, scopes, oauth: { keyId: key.id, clientId: 'https://chatgpt.com/oauth/client.json', sessionVersion: user.sessionVersion, scopes, expiresAt: Date.now() + 86400000 } };
    const tools = createWorkspaceTools();
    const args = revision => ({ input: { clientId: client.id, mappingId: mapping.id, snapshot: { mappingRevision: revision, providerProjectIdMatch: 'fixture-source', outcome: 'OK', complete: false, reports: [{ providerReportId: randomUUID(), title: 'Synthetic report', summary: 'Supplied test data', sourceReportedAt: null }] } }, idempotencyKey: randomUUID() });
    const input = args(1), pending = await tools.call(ctx, 'publish_client_service_report_snapshot', input);
    const stored = await raw.aiBridgeAction.findUnique({ where: { id: pending.action.id } });
    assert.equal(stored.authorizationBinding.keyId, key.id);
    await assert.rejects(raw.aiBridgeAction.update({ where: { id: stored.id }, data: { authorizationBinding: { ...stored.authorizationBinding, keyId: 'other-grant' } } }));
    await assert.rejects(raw.aiBridgeAction.create({ data: { organizationId, userId: user.id, action: 'create_calendar_event', idempotencyKey: randomUUID(), input: {}, inputHash: 'hash', preview: {}, expiresAt: new Date(Date.now() + 60000), authorizationBinding: stored.authorizationBinding } }));
    const done = await tools.call(ctx, 'confirm_action', { actionId: stored.id });
    assert.equal(done.action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'publish_client_service_report_snapshot', input)).idempotent, true);
    assert.equal(await raw.clientServiceReport.count({ where: { mappingId: mapping.id } }), 1);
    await raw.apiKey.update({ where: { id: key.id }, data: { isActive: false, revokedAt: new Date() } });
    for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(tools.call(ctx, operation, { actionId: stored.id }));
    await raw.apiKey.update({ where: { id: key.id }, data: { isActive: true, revokedAt: null } });
    const proposal = await tools.call(ctx, 'publish_client_service_report_snapshot', args(2));
    const raceDb = new Proxy(raw, { get(target, property) {
      if (property === '$transaction') return async (callback, options) => {
        await raw.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
        return target.$transaction(callback, options);
      };
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(tools.call({ ...ctx, prisma: raceDb }, 'confirm_action', { actionId: proposal.action.id }));
    assert.equal((await raw.aiBridgeAction.findUnique({ where: { id: proposal.action.id } })).status, 'PENDING_CONFIRMATION');
    assert.equal((await raw.clientServiceProject.findUnique({ where: { id: mapping.id } })).revision, 2);
    assert.equal(await raw.clientServiceReport.count({ where: { mappingId: mapping.id } }), 1);
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId } });
    await raw.clientServiceReport.deleteMany({ where: { organizationId } });
    await raw.clientServiceProject.deleteMany({ where: { organizationId } });
    await raw.client.deleteMany({ where: { organizationId } });
    await raw.apiKey.deleteMany({ where: { user: { organizationId } } });
    await raw.user.deleteMany({ where: { organizationId } });
    if (await purgeFixtureAuditEvents(raw, { ids: [organizationId] })) await raw.organization.deleteMany({ where: { id: organizationId } });
    await raw.$disconnect();
  }
});
