import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClientServiceMapping, updateClientServiceMapping, publishClientServiceSnapshot, readClientServicePanels } from '../../services/client-service-panels.service.js';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
const publication = revision => ({ mappingRevision: revision, providerProjectIdMatch: 'source-project', outcome: 'OK', complete: true,
  reports: [{ providerReportId: 'report-a', title: 'Synthetic report', summary: 'Disposable fixture only.', sourceReportedAt: null }] });
function withoutAudit(client) {
  return new Proxy(client, { get(target, key) {
    if (key === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit failure'); } };
    if (key === '$transaction') return (fn, ...args) => target.$transaction(tx => fn(withoutAudit(tx)), ...args);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}
test('saved panels database tenant edges, current roles, CAS and audit rollback', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `service-panels-${key}-${randomUUID()}`); const users = []; const clients = [];
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Saved panels QA' } });
      users.push(await raw.user.create({ data: { organizationId, role: 'ADMIN', name: 'QA admin', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Saved panels QA' } }));
    }
    const clientId = clients[0].id;
    const mapping = await createClientServiceMapping(raw, users[0], clientId, { provider: 'OPENSEO', providerProjectId: 'source-project', displayLabel: 'Saved brand' });
    await assert.rejects(readClientServicePanels(raw, users[1], clientId), { code: 'RECORD_NOT_FOUND' });
    await assert.rejects(raw.clientServiceProject.create({ data: { organizationId: orgs[0], clientId: clients[1].id, providerProjectId: 'illegal', displayLabel: 'Cross tenant' } }));
    await assert.rejects(raw.clientServiceReport.create({ data: { organizationId: orgs[1], clientId: clients[1].id, mappingId: mapping.id, providerReportId: 'illegal', title: 'Cross mapping', summary: 'Must fail' } }));
    const sibling = await raw.client.create({ data: { organizationId: orgs[0], name: 'Same tenant other client' } });
    await assert.rejects(raw.clientServiceReport.create({ data: { organizationId: orgs[0], clientId: sibling.id, mappingId: mapping.id, providerReportId: 'illegal', title: 'Wrong client mapping', summary: 'Must fail' } }));
    const writes = await Promise.allSettled([publishClientServiceSnapshot(raw, users[0], clientId, mapping.id, publication(1)), publishClientServiceSnapshot(raw, users[0], clientId, mapping.id, publication(1))]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'SERVICE_PANEL_CONFLICT');
    const before = await readClientServicePanels(raw, users[0], clientId);
    await assert.rejects(publishClientServiceSnapshot(withoutAudit(raw), users[0], clientId, mapping.id, { ...publication(2), outcome: 'EMPTY', reports: [] }), { code: 'SERVICE_PANEL_AUDIT_UNAVAILABLE' });
    assert.deepEqual(await readClientServicePanels(raw, users[0], clientId), before);
    await publishClientServiceSnapshot(raw, users[0], clientId, mapping.id, { ...publication(2), outcome: 'UNAVAILABLE', complete: false, reports: [], failureCode: 'PROVIDER_UNAVAILABLE' });
    const unavailable = await readClientServicePanels(raw, users[0], clientId);
    assert.equal(unavailable.projects[0].status, 'unavailable'); assert.equal(unavailable.projects[0].reports.length, 1); assert.deepEqual(unavailable.projects[0].lastSuccessAt, before.projects[0].lastSuccessAt);
    await assert.rejects(updateClientServiceMapping(raw, users[0], clientId, mapping.id, { revision: 2, displayLabel: 'Stale edit', enabled: false }), { code: 'SERVICE_PANEL_CONFLICT' });
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'TEAM' } });
    await assert.rejects(publishClientServiceSnapshot(raw, users[0], clientId, mapping.id, publication(3)), { code: 'ROLE_DENIED' });
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'ADMIN' } });
    await raw.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
    await assert.rejects(readClientServicePanels(raw, users[0], clientId), { code: 'RECORD_NOT_FOUND' });
  } finally {
    await raw.clientServiceReport.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.clientServiceProject.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
