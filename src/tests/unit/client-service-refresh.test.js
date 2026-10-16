import test from 'node:test';
import Fastify from 'fastify';
import routes from '../../routes/client-service-panels.routes.js';
import assert from 'node:assert/strict';
import { encrypt } from '../../utils/crypto.js';
import { createClientServiceMapping, updateClientServiceMapping, readClientServicePanels, publishClientServiceSnapshot } from '../../services/client-service-panels.service.js';
import { refreshClientServiceReports, listClientServiceCredentials } from '../../services/client-service-refresh.service.js';
process.env.CREDENTIALS_KEY = 'offline-refresh-fixture-only';
const user = { id: 'staff-a', organizationId: 'org-a', role: 'ADMIN', isActive: true };
const match = (row, where = {}) => row && Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => match(row, part)) : value && typeof value === 'object' && !(value instanceof Date) ? value.notIn ? !value.notIn.includes(row[key]) : false : row[key] === value);
function fixture() {
  const state = { actor: { ...user }, client: { id: 'client-a', organizationId: 'org-a', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE' }, projects: [], reports: [], audits: [], credential: { id: 'credential-a', organizationId: 'org-a', clientId: 'client-a', projectId: null, url: 'https://openseo.ashbi.ca/login', username: 'proxy-user', password: encrypt('not-real-password'), updatedAt: new Date('2026-01-01') } };
  const db = {
    $queryRaw: async () => [],
    credential: { findFirst: async ({ where }) => match(state.credential, where) ? structuredClone(state.credential) : null, findMany: async () => [state.credential] },
    credentialAccessAudit: { create: async () => ({ id: 'access-a' }) },
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

async function prepared() {
  const f = fixture();
  const mapping = await createClientServiceMapping(f.db, user, 'client-a', { provider: 'OPENSEO', providerProjectId: 'project-a', displayLabel: 'QA saved reports' });
  await updateClientServiceMapping(f.db, user, 'client-a', mapping.id, { revision: 1, displayLabel: 'QA saved reports', enabled: true, credentialId: 'credential-a' });
  return { ...f, mappingId: mapping.id };
}
const sample = { reports: [{ providerReportId: 'report-a', title: 'Saved source report', summary: 'Full source summary', providerEditedAt: new Date('2026-01-01') }], partial: true, providerTotalCount: 21, outcome: 'OK' };
const refresh = (f, reader) => refreshClientServiceReports(f.db, user, 'client-a', f.mappingId, { mappingRevision: 2 }, { reader });

test('credential metadata is admin-only and no username/password is projected', async () => {
  const f = await prepared();
  const metadata = await listClientServiceCredentials(f.db, user, 'client-a');
  assert.deepEqual(metadata, { credentials: [{ id: 'credential-a', label: undefined, usernamePresent: true }], truncated: false });
  assert.doesNotMatch(JSON.stringify(metadata), /proxy-user|password/);
  f.state.actor.role = 'TEAM';
  await assert.rejects(listClientServiceCredentials(f.db, user, 'client-a'), { code: 'ROLE_DENIED' });
});

test('refresh preserves unknown metric time and per-row provenance without leaking credentials to TEAM', async () => {
  const f = await prepared(); let calls = 0;
  await refresh(f, async input => { calls++; assert.equal(input.password, 'not-real-password'); return sample; });
  assert.equal(calls, 1);
  const report = f.state.reports[0];
  assert.equal(report.sourceReportedAt, null); assert.equal(report.provenance, 'OPENSEO_SAVED_REPORT_PULL'); assert.deepEqual(report.providerEditedAt, sample.reports[0].providerEditedAt);
  f.state.actor.role = 'TEAM';
  const read = await readClientServicePanels(f.db, { ...user, role: 'TEAM' }, 'client-a');
  assert.equal(read.projects[0].refreshPartial, true);
  assert.equal(read.projects[0].sourceFreshness, 'unknown');
  assert.doesNotMatch(JSON.stringify(read), /credential-a|proxy-user|not-real-password/);
});

test('empty and unavailable observations retain all existing rows and never imply complete deletion', async () => {
  for (const outcome of ['EMPTY', 'UNAVAILABLE']) {
    const f = await prepared();
    f.state.reports.push({ id: 'old', mappingId: f.mappingId, organizationId: 'org-a', clientId: 'client-a', providerReportId: 'old', title: 'Old', summary: 'Retained' });
    await refresh(f, async () => { if (outcome === 'UNAVAILABLE') throw new Error('private provider error'); return { reports: [], partial: true, providerTotalCount: 0, outcome }; });
    assert.equal(f.state.reports.length, 1); assert.equal(f.state.projects[0].refreshOutcome, outcome);
    assert.notEqual(f.state.projects[0].lastOutcome, 'EMPTY');
  }
});

test('demotion, client retirement, mapping revision/project change and credential rotation after network prevent publication', async () => {
  const changes = [f => { f.state.actor.role = 'TEAM'; }, f => { f.state.actor.isActive = false; }, f => { f.state.client.deletedAt = new Date(); }, f => { f.state.client.status = 'PAUSED'; }, f => { f.state.client.relationshipStatus = 'ARCHIVED'; }, f => { f.state.projects[0].enabled = false; }, f => { f.state.projects[0].revision++; }, f => { f.state.projects[0].providerProjectId = 'foreign'; }, f => { f.state.projects[0].credentialId = null; }, f => { f.state.credential.password = encrypt('rotated'); }, f => { f.state.credential.url = 'https://other.example'; }];
  for (const change of changes) {
    const f = await prepared();
    await assert.rejects(refresh(f, async () => { change(f); return sample; }));
    assert.equal(f.state.reports.length, 0); assert.equal(f.state.projects[0].refreshOutcome, undefined);
  }
});

test('an unbound/foreign credential never reaches the provider and audit failure atomically rolls back publication', async () => {
  const f = await prepared(); let calls = 0;
  f.state.credential.clientId = 'other-client';
  await assert.rejects(refresh(f, async () => { calls++; return sample; })); assert.equal(calls, 0);
  f.state.credential.clientId = 'client-a';
  const original = f.db.auditEvent.create;
  f.db.auditEvent.create = async args => args.data.action === 'client_service_project.refreshed' ? null : original(args);
  await assert.rejects(refresh(f, async () => sample), { code: 'SERVICE_PANEL_AUDIT_UNAVAILABLE' });
  assert.equal(f.state.reports.length, 0); assert.equal(f.state.projects[0].revision, 2);
});


test('vault disclosure audit failure prevents any outbound read', async () => {
  const f = await prepared(); let calls = 0;
  f.db.credentialAccessAudit.create = async () => { throw new Error('Synthetic credential audit failure'); };
  await assert.rejects(refresh(f, async () => { calls++; return sample; }), { code: 'SERVICE_PANEL_UNAVAILABLE' });
  assert.equal(calls, 0); assert.equal(f.state.projects[0].revision, 2);
});


test('HTTP refresh requires current ADMIN and an explicit configured revision; GET remains storage-only', async () => {
  const f = await prepared(); f.state.projects[0].credentialId = null;
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = { ...user }; request.prisma = f.db; });
  await app.register(routes, { prefix: '/api/clients' });
  try {
    const read = await app.inject({ method: 'GET', url: '/api/clients/client-a/service-panels' });
    assert.equal(read.statusCode, 200); assert.equal(f.state.projects[0].revision, 2);
    const absent = await app.inject({ method: 'POST', url: `/api/clients/client-a/service-panels/${f.mappingId}/refresh`, payload: { mappingRevision: 2 } });
    assert.equal(absent.statusCode, 409); assert.equal(absent.json().code, 'AUTH_REQUIRED');
    f.state.actor.role = 'TEAM';
    const denied = await app.inject({ method: 'POST', url: `/api/clients/client-a/service-panels/${f.mappingId}/refresh`, payload: { mappingRevision: 2 } });
    assert.equal(denied.statusCode, 403);
    const credentials = await app.inject({ method: 'GET', url: '/api/clients/client-a/service-panel-credentials' });
    assert.equal(credentials.statusCode, 403);
    assert.equal(f.state.projects[0].revision, 2);
  } finally { await app.close(); }
});


test('manual publication resets pulled provenance and provider edit time; omitted credential binding is preserved', async () => {
  const f = await prepared(); await refresh(f, async () => sample);
  await publishClientServiceSnapshot(f.db, user, 'client-a', f.mappingId, { mappingRevision: 3, providerProjectIdMatch: 'project-a', outcome: 'OK', complete: false, reports: [{ providerReportId: 'report-a', title: 'Staff edited report', summary: 'Manually supplied summary', sourceReportedAt: null }] });
  assert.equal(f.state.reports[0].provenance, 'ADMIN_PUBLISHED_SNAPSHOT');
  assert.equal(f.state.reports[0].providerEditedAt, null);
  await updateClientServiceMapping(f.db, user, 'client-a', f.mappingId, { revision: 4, displayLabel: 'Paused mapping', enabled: false });
  assert.equal(f.state.projects[0].credentialId, 'credential-a');
  await updateClientServiceMapping(f.db, user, 'client-a', f.mappingId, { revision: 5, displayLabel: 'Unbound mapping', enabled: false, credentialId: null });
  assert.equal(f.state.projects[0].credentialId, null);
});
