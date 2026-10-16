import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { encrypt } from '../../utils/crypto.js';
import { createClientServiceMapping, updateClientServiceMapping } from '../../services/client-service-panels.service.js';
import { refreshClientServiceReports } from '../../services/client-service-refresh.service.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
const sample = { reports: [{ providerReportId: 'report-a', title: 'Synthetic saved report', summary: 'Disposable fixture summary', providerEditedAt: new Date('2026-01-01') }], partial: true, providerTotalCount: 21, outcome: 'OK' };
function withoutRefreshAudit(db) {
  return new Proxy(db, { get(target, key) {
    if (key === 'auditEvent') return { create: async args => { if (args.data.action === 'client_service_project.refreshed') throw new Error('Synthetic audit failure'); return target.auditEvent.create(args); } };
    if (key === '$transaction') return (fn, options) => target.$transaction(tx => fn(withoutRefreshAudit(tx)), options);
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } });
}

test('PostgreSQL saved-report refresh: tenant FK, current authority, rotation, CAS, atomic audit and retention', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  process.env.CREDENTIALS_KEY = 'disposable-openseo-fixture-only';
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const organizationId = `report-refresh-${randomUUID()}`;
  try {
    await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Disposable report pull fixture' } });
    const actor = await raw.user.create({ data: { organizationId, role: 'ADMIN', name: 'Fixture staff', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } });
    const client = await raw.client.create({ data: { organizationId, name: 'Disposable canonical client' } });
    const other = await raw.client.create({ data: { organizationId, name: 'Different disposable client' } });
    const credential = await raw.credential.create({ data: { organizationId, clientId: client.id, label: 'Synthetic public proxy login', username: 'fixture-proxy', url: 'https://openseo.ashbi.ca/login', password: encrypt('not-a-real-proxy-password') } });
    const mapping = await createClientServiceMapping(raw, actor, client.id, { provider: 'OPENSEO', providerProjectId: 'project-a', displayLabel: 'Disposable saved report project' });
    await assert.rejects(raw.clientServiceProject.update({ where: { id: mapping.id }, data: { credentialId: credential.id, clientId: other.id } }));
    await updateClientServiceMapping(raw, actor, client.id, mapping.id, { revision: 1, enabled: true, displayLabel: 'Disposable saved reports', credentialId: credential.id });
    const revision = async () => (await raw.clientServiceProject.findUnique({ where: { id: mapping.id } })).revision;
    const run = async (reader, db = raw) => refreshClientServiceReports(db, actor, client.id, mapping.id, { mappingRevision: await revision() }, { reader });
    const rows = () => raw.clientServiceReport.findMany({ where: { mappingId: mapping.id } });
    for (const change of [
      () => raw.user.update({ where: { id: actor.id }, data: { role: 'TEAM' } }),
      () => raw.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } }),
      () => raw.client.update({ where: { id: client.id }, data: { status: 'PAUSED' } }),
      () => raw.credential.update({ where: { id: credential.id }, data: { password: encrypt('rotated-fixture-password') } }),
      () => raw.clientServiceProject.update({ where: { id: mapping.id }, data: { providerProjectId: 'remapped-project' } }),
    ]) {
      await assert.rejects(run(async () => { await change(); return sample; }));
      assert.equal((await rows()).length, 0);
      await raw.user.update({ where: { id: actor.id }, data: { role: 'ADMIN' } });
      await raw.client.update({ where: { id: client.id }, data: { deletedAt: null, status: 'ACTIVE' } });
      await raw.clientServiceProject.update({ where: { id: mapping.id }, data: { providerProjectId: 'project-a' } });
    }
    await assert.rejects(run(async () => sample, withoutRefreshAudit(raw)), { code: 'SERVICE_PANEL_AUDIT_UNAVAILABLE' });
    assert.equal((await rows()).length, 0); assert.equal(await revision(), 2);
    let waiting = 0; let release;
    const ready = new Promise(resolve => { release = resolve; });
    const reader = async () => { if (++waiting === 2) release(); await ready; return sample; };
    const results = await Promise.allSettled([run(reader), run(reader)]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.find(row => row.status === 'rejected').reason.code, 'SERVICE_PANEL_CONFLICT');
    const original = await rows(); assert.equal(original.length, 1); assert.equal(original[0].sourceReportedAt, null);
    assert.equal(original[0].provenance, 'OPENSEO_SAVED_REPORT_PULL');
    await run(async () => ({ reports: [], partial: true, providerTotalCount: 0, outcome: 'EMPTY' }));
    assert.deepEqual(await rows(), original);
    await run(async () => { throw new Error('Private provider failure'); });
    assert.deepEqual(await rows(), original);
    const current = await raw.clientServiceProject.findUnique({ where: { id: mapping.id } });
    assert.equal(current.refreshOutcome, 'UNAVAILABLE'); assert.equal(current.refreshPartial, true);
    assert.equal(await raw.auditEvent.count({ where: { organizationId, entityId: mapping.id, action: 'client_service_project.refreshed' } }), 3);
  } finally {
    await raw.clientServiceReport.deleteMany({ where: { organizationId } });
    await raw.clientServiceProject.deleteMany({ where: { organizationId } });
    await raw.credential.deleteMany({ where: { organizationId } });
    await raw.client.deleteMany({ where: { organizationId } });
    await raw.user.deleteMany({ where: { organizationId } });
    // Disposable fixture only; production append-only guards are never changed.
    await raw.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`DELETE FROM "credential_access_audits" WHERE "organizationId"=${organizationId}`;
    });
    if (await purgeFixtureAuditEvents(raw, { ids: [organizationId] })) await raw.organization.delete({ where: { id: organizationId } });
    await raw.$disconnect();
  }
});
