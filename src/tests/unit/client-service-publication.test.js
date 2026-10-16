import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createWorkspaceTools, workspaceRegistry } from '../../integrations/workspace-tools.js';
import { createToolExecutor } from '../../ai/tools/executor.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { MCP_OAUTH_SCOPES } from '../../auth/mcp-oauth-provider.js';
import { executeServicePublication } from '../../services/client-service-publication.service.js';
import aiToolRoutes from '../../routes/ai-tool.routes.js';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';
const name = 'publish_client_service_report_snapshot';
const input = { clientId: 'client-a', mappingId: 'mapping-a', snapshot: { mappingRevision: 1, providerProjectIdMatch: 'source-a', outcome: 'OK', complete: true,
  reports: [{ providerReportId: 'r1', title: 'Supplied report', summary: 'PRIVATE SAVED REPORT', sourceReportedAt: null }] } };
function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb()); db.tables.user.forEach(row => { row.isActive = true; });
  db.tables.clientServiceProject.push({ id: 'mapping-a', organizationId: 'org-a', clientId: 'client-a', provider: 'OPENSEO', providerProjectId: 'source-a', displayLabel: 'Brand A', enabled: true, revision: 1 });
  db.tables.clientServiceReport.push({ id: 'old-a', organizationId: 'org-a', clientId: 'client-a', mappingId: 'mapping-a', providerReportId: 'old', title: 'Old report', summary: 'Old supplied text' });
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(row => row.id === 'admin-a')), scopes: ['workspace:read', 'workspace:actions'] };
  const tools = createWorkspaceTools();
  const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  const prepare = (key = 'saved-report-intent-1', fields = input) => tools.call(ctx, name, { input: fields, idempotencyKey: key });
  return { db, ctx, tools, executor, prepare };
}
test('publication is allowlisted irreversible, ADMIN-only and invisible to unchanged read-only OAuth', async () => {
  const f = fixture(); const tool = workspaceRegistry.get(name);
  assert.equal(tool.irreversible, true); assert.equal(tool.external, false); assert.equal(tool.requiresConfirmation, true); assert.equal(tool.retry.maxAttempts, 1);
  assert.deepEqual(tool.roles, ['ADMIN']); assert.deepEqual(tool.approval.approverRoles, ['ADMIN']); assert.equal(tool.execution.isolationLevel, 'Serializable');
  assert.equal(f.tools.list(f.ctx).find(row => row.name === name).annotations.destructiveHint, true);
  assert.deepEqual(MCP_OAUTH_SCOPES, ['workspace:read']);
  const readOnly = { ...f.ctx, scopes: ['workspace:read'] };
  assert.equal(f.tools.list(readOnly).some(row => row.name === name), false); await assert.rejects(f.tools.call(readOnly, name, { input, idempotencyKey: 'readonly-report' }), { code: 'TOOL_UNAVAILABLE' });
  f.ctx.user.role = 'TEAM'; await assert.rejects(f.prepare(), { code: 'TOOL_UNAVAILABLE' }); assert.equal(f.db.tables.aiBridgeAction.length, 0);
});
test('exact destructive preview performs no publication until confirmation, then recovers idempotently despite revision advance', async () => {
  const f = fixture(); const p = await f.prepare(); assert.equal(f.db.tables.clientServiceProject[0].revision, 1); assert.equal(f.db.tables.clientServiceReport[0].providerReportId, 'old');
  assert.deepEqual(p.action.preview.effects, { suppliedCount: 1, replacedCount: 0, deletedCount: 1, retainedCount: 0, preservesLastGood: false });
  assert.equal(p.action.preview.destination.providerProjectId, 'source-a'); assert.equal(p.action.preview.source, 'ADMIN_PUBLISHED_SNAPSHOT');
  const originalTx = f.db.$transaction; let isolation;
  f.db.$transaction = (work, options) => { isolation = options?.isolationLevel; return originalTx(work); };
  const done = await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id }); assert.equal(isolation, 'Serializable');
  assert.equal(done.action.status, 'EXECUTED'); assert.equal(f.db.tables.clientServiceProject[0].revision, 2); assert.deepEqual(f.db.tables.clientServiceReport.map(row => row.providerReportId), ['r1']);
  const replay = await f.prepare(); assert.equal(replay.idempotent, true); assert.equal(replay.action.id, p.action.id);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: p.action.id })).action.status, 'EXECUTED');
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id })).idempotent, true); assert.equal(f.db.tables.clientServiceProject[0].revision, 2);
  await assert.rejects(f.prepare('saved-report-intent-1', { ...input, snapshot: { ...input.snapshot, complete: false } }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('current role, deletion, remapping and revision changes fail closed before confirmation or private receipt projection', async () => {
  for (const change of [f => { f.db.tables.user.find(row => row.id === 'admin-a').role = 'TEAM'; }, f => { f.db.tables.client[0].deletedAt = new Date(); }, f => { f.db.tables.clientServiceProject[0].providerProjectId = 'different'; }]) {
    const f = fixture(); const p = await f.prepare(); change(f);
    for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: p.action.id }));
    assert.equal(f.db.tables.clientServiceReport[0].providerReportId, 'old');
  }
  for (const change of [f => { f.db.tables.clientServiceProject[0].revision++; }, f => { f.db.tables.clientServiceProject[0].enabled = false; }]) {
    const f = fixture(); const p = await f.prepare(); change(f);
    await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal(f.db.tables.clientServiceReport[0].providerReportId, 'old');
  }
});
test('full preview rederivation detects changed replacement/deletion counts and fresh approver authority', async () => {
  const f = fixture(); const p = await f.prepare();
  f.db.tables.clientServiceReport.push({ id: 'unexpected', organizationId: 'org-a', clientId: 'client-a', mappingId: 'mapping-a', providerReportId: 'new-after-preview' });
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id }), { code: 'EXECUTION_FAILED' }); assert.equal(f.db.tables.clientServiceProject[0].revision, 1);
  const g = fixture(); const q = await g.prepare();
  await assert.rejects(executeServicePublication({ prisma: g.db, user: { id: 'admin-a', organizationId: 'org-a' }, approver: { id: 'team-a', organizationId: 'org-a' }, input: g.db.tables.aiBridgeAction[0].input, preview: q.action.preview }), { code: 'ROLE_DENIED' });
  assert.equal(g.db.tables.clientServiceReport[0].providerReportId, 'old');
});
test('publication audit failure rolls back report replacement, mapping revision and execution receipt together', async () => {
  const f = fixture(); const p = await f.prepare(); const create = f.db.auditEvent.create;
  f.db.auditEvent.create = async args => { if (args.data.action === 'client_service_project.published') throw Error('Synthetic audit outage'); return create(args); };
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(f.db.tables.clientServiceProject[0].revision, 1); assert.deepEqual(f.db.tables.clientServiceReport.map(row => row.providerReportId), ['old']);
  assert.equal(f.db.tables.aiBridgeAction[0].status, 'FAILED'); assert.equal(f.db.tables.aiBridgeAction[0].result, undefined);
});
test('partial, EMPTY and UNAVAILABLE preserve existing service semantics', async () => {
  for (const snapshot of [{ ...input.snapshot, complete: false }, { ...input.snapshot, outcome: 'EMPTY', reports: [] }, { ...input.snapshot, outcome: 'UNAVAILABLE', complete: false, reports: [], failureCode: 'AUTH_REQUIRED' }]) {
    const f = fixture(); const p = await f.prepare('outcome-case-report', { ...input, snapshot }); await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id });
    const ids = f.db.tables.clientServiceReport.map(row => row.providerReportId);
    assert.deepEqual(ids, snapshot.outcome === 'EMPTY' ? [] : snapshot.outcome === 'UNAVAILABLE' ? ['old'] : ['old', 'r1']);
  }
});
test('strict payloads and existing global input-size limit reject unsupported publication paths', async () => {
  const f = fixture();
  for (const snapshot of [{ ...input.snapshot, reports: [input.snapshot.reports[0], input.snapshot.reports[0]] }, { ...input.snapshot, reports: [{ ...input.snapshot.reports[0], sourceUrl: 'https://unverified.invalid' }] }, { ...input.snapshot, reports: [{ ...input.snapshot.reports[0], summary: '<b>HTML</b>' }] }]) await assert.rejects(f.prepare('bad-report-intent', { ...input, snapshot }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.prepare('too-large-report', { ...input, snapshot: { ...input.snapshot, reports: Array.from({ length: 5 }, (_, i) => ({ ...input.snapshot.reports[0], providerReportId: `r${i}`, summary: 'a'.repeat(4000) })) } }), { code: 'INPUT_TOO_LARGE' });
  assert.equal(f.db.tables.aiBridgeAction.length, 0);
});
test('generic approval, receipt and legacy surfaces hide pending/executed publication receipts', async t => {
  const f = fixture(); const p = await f.prepare(); const app = Fastify(); await app.register(cookie); await app.register(rateLimit, { global: false });
  app.decorate('authenticate', async r => { r.user = f.ctx.user; r.prisma = f.db; }); app.decorate('authenticateWithApiKey', async r => { r.user = f.ctx.user; r.prisma = f.db; r.apiKeyScopes = ['ai_bridge:actions']; });
  await app.register(aiToolRoutes, { prefix: '/generic' }); await app.register(aiBridgeRoutes, { prefix: '/legacy' }); t.after(() => app.close());
  for (const completed of [false, true]) {
    if (completed) await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id });
    for (const url of ['/generic/approvals', '/generic/receipts', `/generic/receipts?tool=${name}`]) { const r = await app.inject(url); assert.equal(r.statusCode, 200, r.body); assert.doesNotMatch(r.body, /PRIVATE SAVED REPORT|publish_client_service_report_snapshot/); }
    const detail = await app.inject(`/generic/approvals/${p.action.id}`); assert.equal(detail.statusCode, 404);
    const legacy = await app.inject({ method: 'POST', url: `/legacy/v1/actions/${p.action.id}/confirm`, payload: { confirm: true } }); assert.equal(legacy.statusCode, 404); assert.doesNotMatch(legacy.body, /PRIVATE SAVED REPORT/);
  }
});

test('receipt persistence failure rolls back publication and its audit, and fresh authority is rechecked inside execution', async () => {
  const f = fixture(); const p = await f.prepare(); const update = f.db.aiBridgeAction.update;
  f.db.aiBridgeAction.update = async args => { if (args.data.status === 'EXECUTED') throw Error('Synthetic receipt write failure'); return update(args); };
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(f.db.tables.clientServiceProject[0].revision, 1); assert.deepEqual(f.db.tables.clientServiceReport.map(row => row.providerReportId), ['old']);
  assert.equal(f.db.tables.auditEvent.some(row => row.action === 'client_service_project.published'), false);
  assert.equal(f.db.tables.aiBridgeAction[0].status, 'FAILED');
  const g = fixture(); const q = await g.prepare(); const transaction = g.db.$transaction;
  g.db.$transaction = work => transaction(async tx => { tx.tables.user.find(row => row.id === 'admin-a').role = 'TEAM'; return work(tx); });
  await assert.rejects(g.tools.call(g.ctx, 'confirm_action', { actionId: q.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(g.db.tables.clientServiceProject[0].revision, 1); assert.deepEqual(g.db.tables.clientServiceReport.map(row => row.providerReportId), ['old']);
});
