import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readClientServicePanels, createClientServiceMapping, updateClientServiceMapping, publishClientServiceSnapshot, serviceSnapshotSchema } from '../../services/client-service-panels.service.js';
import routes from '../../routes/client-service-panels.routes.js';
import { WORKSPACE_SERVICE_PANEL_TOOLS } from '../../integrations/workspace-service-panel-tools.js';
const user = { id: 'staff-a', organizationId: 'org-a', role: 'ADMIN', isActive: true };
const match = (row, where = {}) => row && Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => match(row, part)) : value && typeof value === 'object' && !(value instanceof Date) ? value.notIn ? !value.notIn.includes(row[key]) : false : row[key] === value);
function fixture() {
  const state = { actor: { ...user }, client: { id: 'client-a', organizationId: 'org-a', deletedAt: null }, projects: [], reports: [], audits: [] };
  const db = {
    user: { findFirst: async ({ where }) => match(state.actor, where) ? state.actor : null },
    client: { findFirst: async ({ where }) => match(state.client, where) ? state.client : null },
    auditEvent: { create: async ({ data }) => { state.audits.push(data); return { id: 'audit-a', ...data }; } },
    $transaction: async fn => { const before = structuredClone(state); try { return await fn(db); } catch (error) { Object.assign(state, before); throw error; } },
  };
  for (const [key, collection] of [['clientServiceProject', 'projects'], ['clientServiceReport', 'reports']]) db[key] = {
    count: async ({ where }) => state[collection].filter(row => match(row, where)).length,
    findFirst: async ({ where }) => structuredClone(state[collection].find(row => match(row, where)) ?? null),
    findMany: async ({ where, take, include }) => state[collection].filter(row => match(row, where)).slice(0, take).map(row => ({ ...structuredClone(row), ...(include ? { reports: state.reports.filter(report => report.mappingId === row.id).slice(0, include.reports.take) } : {}) })),
    create: async ({ data }) => { const row = { id: `${key}-${state[collection].length}`, enabled: true, revision: 1, lastAttemptAt: null, lastSuccessAt: null, lastOutcome: null, failureCode: null, ...data }; state[collection].push(row); return structuredClone(row); },
    updateMany: async ({ where, data }) => { let count = 0; for (const row of state[collection]) if (match(row, where)) { Object.assign(row, { ...data, ...(data.revision ? { revision: row.revision + data.revision.increment } : {}) }); count++; } return { count }; },
    deleteMany: async ({ where }) => { const before = state[collection].length; state[collection] = state[collection].filter(row => !match(row, where)); return { count: before - state[collection].length }; },
  };
  return { db, state };
}
const mappingInput = { provider: 'OPENSEO', providerProjectId: 'brand-a', displayLabel: 'Brand A' };
const report = { providerReportId: 'report-a', title: 'Source report', summary: 'A supplied finding.', sourceReportedAt: null };
const snapshot = (revision, fields = {}) => ({ mappingRevision: revision, providerProjectIdMatch: 'brand-a', outcome: 'OK', complete: true, reports: [report], ...fields });

test('stored report read is side effect free, bounded and identical to MCP projection', async () => {
  const { db, state } = fixture();
  assert.deepEqual((await readClientServicePanels(db, user, 'client-a')).projects, []);
  assert.equal(state.audits.length, 0);
  const tool = WORKSPACE_SERVICE_PANEL_TOOLS[0]; assert.equal(tool.class, 'read');
  assert.deepEqual(await tool.run({ prisma: db, user, input: { clientId: 'client-a', limit: 20 } }), await readClientServicePanels(db, user, 'client-a'));
  await assert.rejects(readClientServicePanels(db, user, 'client-a', { limit: 51 }), { code: 'INVALID_INPUT' });
});
test('current actor, tenant and deleted-client guards reject stale JWTs before mapping writes', async () => {
  const { db, state } = fixture();
  for (const role of ['CLIENT', 'BOT']) await assert.rejects(readClientServicePanels(db, { ...user, role }, 'client-a'), { code: 'ROLE_DENIED' });
  state.actor.role = 'TEAM'; await assert.rejects(createClientServiceMapping(db, user, 'client-a', mappingInput), { code: 'ROLE_DENIED' });
  state.actor.role = 'ADMIN'; state.client.deletedAt = new Date(); await assert.rejects(readClientServicePanels(db, user, 'client-a'), { code: 'RECORD_NOT_FOUND' });
  state.client.deletedAt = null; await assert.rejects(readClientServicePanels(db, user, 'client-other'), { code: 'RECORD_NOT_FOUND' });
  state.actor.isActive = false; await assert.rejects(readClientServicePanels(db, user, 'client-a'), { code: 'ROLE_DENIED' });
  assert.equal(state.projects.length, 0);
});
test('admin mapping CAS rejects remaps and stale publication; staff cannot see disabled mappings', async () => {
  const { db, state } = fixture(); const mapping = await createClientServiceMapping(db, user, 'client-a', mappingInput);
  await assert.rejects(updateClientServiceMapping(db, user, 'client-a', mapping.id, { revision: 1, displayLabel: 'Changed', enabled: true, providerProjectId: 'brand-b' }), { code: 'INVALID_INPUT' });
  await updateClientServiceMapping(db, user, 'client-a', mapping.id, { revision: 1, displayLabel: 'Paused', enabled: false });
  await assert.rejects(publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(1)), { code: 'SERVICE_PANEL_CONFLICT' });
  state.actor.role = 'TEAM'; assert.equal((await readClientServicePanels(db, { ...user, role: 'TEAM' }, 'client-a')).projects.length, 0);
  assert.equal(state.audits.length, 2);
});
test('complete/partial/empty/unavailable snapshots retain explicit provenance and preserve last good reports', async () => {
  const { db, state } = fixture(); const mapping = await createClientServiceMapping(db, user, 'client-a', mappingInput);
  assert.equal((await readClientServicePanels(db, user, 'client-a')).projects[0].status, 'never-fetched');
  await publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(1));
  let panel = (await readClientServicePanels(db, user, 'client-a')).projects[0]; assert.equal(panel.status, 'ready'); assert.equal(panel.sourceObservedAt, null); assert.equal(panel.reports[0].sourceUrl, null); assert.ok(panel.reports[0].hubStoredAt);
  const lastGood = panel.lastSuccessAt;
  await publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(2, { outcome: 'UNAVAILABLE', reports: [], complete: false, failureCode: 'AUTH_REQUIRED' }));
  panel = (await readClientServicePanels(db, user, 'client-a')).projects[0]; assert.equal(panel.status, 'unavailable'); assert.equal(panel.reports.length, 1); assert.deepEqual(panel.lastSuccessAt, lastGood);
  await publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(3, { complete: false, reports: [{ ...report, providerReportId: 'report-b' }] })); assert.equal(state.reports.length, 2);
  await publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(4, { outcome: 'EMPTY', reports: [] })); assert.equal(state.reports.length, 0); assert.equal((await readClientServicePanels(db, user, 'client-a')).projects[0].status, 'empty');
});
test('bounded Hub-storage pages never claim the whole mapping source freshness', async () => {
  const { db } = fixture(); const mapping = await createClientServiceMapping(db, user, 'client-a', mappingInput);
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const recent = new Date(Date.now() - 60000).toISOString();
  // The newest source date may be beyond both the visible page and its sentinel:
  // storage order is independent from source report chronology.
  await publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(1, { reports: [
    { ...report, providerReportId: 'stored-first', sourceReportedAt: old },
    { ...report, providerReportId: 'sentinel', sourceReportedAt: old },
    { ...report, providerReportId: 'source-newest', sourceReportedAt: recent },
  ] }));
  const limited = (await readClientServicePanels(db, user, 'client-a', { limit: 1 })).projects[0];
  assert.equal(limited.hasMoreReports, true); assert.equal(limited.sourceObservedAt, null); assert.equal(limited.sourceFreshness, 'unknown');
  assert.equal(limited.reports.length, 1); assert.equal(limited.reports[0].sourceReportedAt.toISOString(), old);
  assert.equal(limited.status, 'ready', 'completeness uncertainty is not provider failure');
  const complete = (await readClientServicePanels(db, user, 'client-a', { limit: 3 })).projects[0];
  assert.equal(complete.hasMoreReports, false); assert.equal(complete.sourceObservedAt.toISOString(), recent); assert.equal(complete.sourceFreshness, 'recent');
});

test('strict publication rejects duplicate IDs, arbitrary URLs, HTML, future times and wrong mapping project', async () => {
  const { db, state } = fixture(); const mapping = await createClientServiceMapping(db, user, 'client-a', mappingInput);
  for (const input of [snapshot(1, { reports: [report, report] }), snapshot(1, { reports: [{ ...report, sourceUrl: 'https://attacker.invalid' }] }), snapshot(1, { reports: [{ ...report, summary: '<b>Unsafe</b>' }] }), snapshot(1, { reports: [{ ...report, sourceReportedAt: '2999-01-01T00:00:00Z' }] }), snapshot(1, { providerProjectIdMatch: 'different' }), snapshot(1, { outcome: 'EMPTY', complete: false, reports: [] })]) await assert.rejects(publishClientServiceSnapshot(db, user, 'client-a', mapping.id, input));
  assert.equal(state.reports.length, 0); assert.equal(state.projects[0].revision, 1); assert.equal(state.audits.length, 1);
  assert.equal(serviceSnapshotSchema.safeParse(snapshot(1, { reports: Array(51).fill(report) })).success, false);
});
test('audit failure rolls back reports and mapping revision atomically', async () => {
  const { db, state } = fixture(); const mapping = await createClientServiceMapping(db, user, 'client-a', mappingInput);
  db.auditEvent.create = async () => { throw new Error('Private database details'); };
  await assert.rejects(publishClientServiceSnapshot(db, user, 'client-a', mapping.id, snapshot(1)), { code: 'SERVICE_PANEL_AUDIT_UNAVAILABLE' });
  assert.equal(state.reports.length, 0); assert.equal(state.projects[0].revision, 1);
});
test('HTTP read and publication errors are sanitized and current staff authorization is required', async () => {
  const { db } = fixture(); const app = Fastify(); app.decorate('authenticate', async request => { request.user = user; request.prisma = db; }); await app.register(routes, { prefix: '/api/clients' });
  try {
    assert.equal((await app.inject('/api/clients/client-a/service-panels')).statusCode, 200);
    const bad = await app.inject({ method: 'POST', url: '/api/clients/client-a/service-panels', payload: { ...mappingInput, secret: 'bad' } }); assert.equal(bad.statusCode, 400);
    db.clientServiceProject.findMany = async () => { throw new Error('private connection string'); };
    const failed = await app.inject('/api/clients/client-a/service-panels'); assert.equal(failed.statusCode, 503); assert.doesNotMatch(failed.body, /private/);
  } finally { await app.close(); }
});
