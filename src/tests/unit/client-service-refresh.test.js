import test from 'node:test';
import Fastify from 'fastify';
import routes from '../../routes/client-service-panels.routes.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { encrypt } from '../../utils/crypto.js';
import { createClientServiceMapping, updateClientServiceMapping, readClientServicePanels, publishClientServiceSnapshot } from '../../services/client-service-panels.service.js';
import { refreshClientServiceReports, listClientServiceCredentials } from '../../services/client-service-refresh.service.js';
process.env.CREDENTIALS_KEY = 'offline-refresh-fixture-only';
const user = { id: 'staff-a', organizationId: 'org-a', role: 'ADMIN', isActive: true };
const match = (row, where = {}) => row && Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => match(row, part)) : value && typeof value === 'object' && !(value instanceof Date) ? value.notIn ? !value.notIn.includes(row[key]) : false : row[key] === value);
function fixture() {
  const auth = { username: randomUUID(), password: randomUUID() };
  const state = { actor: { ...user }, client: { id: 'client-a', organizationId: 'org-a', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE' }, projects: [], reports: [], audits: [], credential: { id: 'credential-a', organizationId: 'org-a', clientId: 'client-a', projectId: null, url: 'https://openseo.ashbi.ca/login', username: auth.username, password: encrypt(auth.password), updatedAt: new Date('2026-01-01') } };
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
  return { db, state, auth };
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
  assert.doesNotMatch(JSON.stringify(metadata), /password/);
  assert.equal(JSON.stringify(metadata).includes(f.auth.username), false);
  assert.equal(JSON.stringify(metadata).includes(f.auth.password), false);
  f.state.actor.role = 'TEAM';
  await assert.rejects(listClientServiceCredentials(f.db, user, 'client-a'), { code: 'ROLE_DENIED' });
});

function credentialChoiceFixture(rows, afterPage = () => {}) {
  const f = fixture(), queries = [];
  f.db.credential.findMany = async args => {
    const { where, select, take, orderBy } = args;
    queries.push(structuredClone(args));
    assert.deepEqual({ organizationId: where.organizationId, clientId: where.clientId, projectId: where.projectId },
      { organizationId: 'org-a', clientId: 'client-a', projectId: null });
    assert.deepEqual(where.username, { not: '' });assert.deepEqual(where.url, { not: null });
    assert.deepEqual(orderBy, { id: 'asc' });assert.equal(take, 100);
    assert.deepEqual(Object.keys(select).sort(), ['clientId', 'id', 'label', 'organizationId', 'projectId', 'url', 'username']);
    const page = rows.filter(row => row.organizationId === where.organizationId && row.clientId === where.clientId
      && row.projectId === null && row.username != null && row.username !== '' && row.url != null
      && (!where.id || row.id > where.id.gt))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, take)
      .map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]])));
    afterPage(queries.length, f.state);
    return page;
  };
  return { ...f, queries };
}
const choiceUsernameMarker = randomUUID();
const choiceSecretMarker = randomUUID();
const choiceRow = (id, extra = {}) => ({ id, organizationId: 'org-a', clientId: 'client-a', projectId: null,
  label: `Credential ${id}`, username: choiceUsernameMarker, password: choiceSecretMarker, url: 'https://openseo.ashbi.ca/login', ...extra });
const numbered = number => String(number).padStart(4, '0');

test('eligible credential after more than 100 unrelated entries remains selectable with normalized URL forms', async () => {
  const rows = Array.from({ length: 225 }, (_, index) => choiceRow(`a-${numbered(index)}`, { url: 'https://other.example.invalid' }));
  rows.push(choiceRow('z-valid', { url: 'https://openseo.ashbi.%63a:443/login' }),
    choiceRow('z-foreign-client', { clientId: 'foreign' }), choiceRow('z-foreign-org', { organizationId: 'foreign' }),
    choiceRow('z-project-secret', { projectId: 'project-a' }));
  const f = credentialChoiceFixture(rows);
  const result = await listClientServiceCredentials(f.db, user, 'client-a');
  assert.deepEqual(result, { credentials: [{ id: 'z-valid', label: 'Credential z-valid', usernamePresent: true }], truncated: false });
  assert.equal(f.queries.length, 3);assert.equal(f.queries[1].where.id.gt, 'a-0099');assert.equal(f.queries[2].where.id.gt, 'a-0199');
  assert.doesNotMatch(JSON.stringify(result), /url|password/);
  assert.equal(JSON.stringify(result).includes(choiceUsernameMarker), false);
  assert.equal(JSON.stringify(result).includes(choiceSecretMarker), false);
});

test('100 eligible credentials followed by unrelated tail are complete rather than falsely truncated', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => choiceRow(`a-${numbered(index)}`));
  rows.push(...Array.from({ length: 230 }, (_, index) => choiceRow(`z-${numbered(index)}`, { username: 'invalid:username' })));
  const f = credentialChoiceFixture(rows), result = await listClientServiceCredentials(f.db, user, 'client-a');
  assert.equal(result.credentials.length, 100);assert.equal(result.truncated, false);assert.equal(f.queries.length, 4);
  assert.equal(result.credentials.at(-1).id, 'a-0099');
});

test('truncation is proved by the 101st eligible credential across filtered pages', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => choiceRow(`a-${numbered(index)}`, { url: 'https://openseo.ashbi.ca/?untrusted=1' }));
  rows.push(...Array.from({ length: 180 }, (_, index) => choiceRow(`z-${numbered(index)}`)));
  const f = credentialChoiceFixture(rows), result = await listClientServiceCredentials(f.db, user, 'client-a');
  assert.equal(result.credentials.length, 100);assert.equal(result.truncated, true);assert.equal(f.queries.length, 3);
  assert.equal(result.credentials[0].id, 'z-0000');assert.equal(result.credentials.at(-1).id, 'z-0099');
});

test('credential traversal rechecks current ADMIN and canonical client authority before returning choices', async () => {
  for (const revoke of [state => { state.actor.role = 'TEAM'; }, state => { state.client.deletedAt = new Date(); }]) {
    const f = credentialChoiceFixture([choiceRow('a-valid')], (_page, state) => revoke(state));
    await assert.rejects(listClientServiceCredentials(f.db, user, 'client-a'), error => ['ROLE_DENIED', 'RECORD_NOT_FOUND'].includes(error.code));
  }
});

test('slow credential traversal fails closed instead of returning a partial selection or guessed truncation', async t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const f = credentialChoiceFixture(Array.from({ length: 150 }, (_, index) => choiceRow(numbered(index))), () => { now = 5001; });
  await assert.rejects(listClientServiceCredentials(f.db, user, 'client-a'), { code: 'SERVICE_PANEL_UNAVAILABLE', statusCode: 503 });
  assert.equal(f.queries.length, 1);
});

test('refresh preserves unknown metric time and per-row provenance without leaking credentials to TEAM', async () => {
  const f = await prepared(); let calls = 0;
  await refresh(f, async input => { calls++; assert.equal(input.password, f.auth.password); assert.equal(input.username, f.auth.username); return sample; });
  assert.equal(calls, 1);
  const report = f.state.reports[0];
  assert.equal(report.sourceReportedAt, null); assert.equal(report.provenance, 'OPENSEO_SAVED_REPORT_PULL'); assert.deepEqual(report.providerEditedAt, sample.reports[0].providerEditedAt);
  f.state.actor.role = 'TEAM';
  const read = await readClientServicePanels(f.db, { ...user, role: 'TEAM' }, 'client-a');
  assert.equal(read.projects[0].refreshPartial, true);
  assert.equal(read.projects[0].sourceFreshness, 'unknown');
  assert.doesNotMatch(JSON.stringify(read), /credential-a/);
  assert.equal(JSON.stringify(read).includes(f.auth.username), false);
  assert.equal(JSON.stringify(read).includes(f.auth.password), false);
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
  const changes = [f => { f.state.actor.role = 'TEAM'; }, f => { f.state.actor.isActive = false; }, f => { f.state.client.deletedAt = new Date(); }, f => { f.state.client.status = 'PAUSED'; }, f => { f.state.client.relationshipStatus = 'ARCHIVED'; }, f => { f.state.projects[0].enabled = false; }, f => { f.state.projects[0].revision++; }, f => { f.state.projects[0].providerProjectId = 'foreign'; }, f => { f.state.projects[0].credentialId = null; }, f => { f.state.credential.password = encrypt(randomUUID()); }, f => { f.state.credential.url = 'https://other.example'; }];
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
