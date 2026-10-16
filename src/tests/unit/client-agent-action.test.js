import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import routes from '../../routes/client-agent-action.routes.js';
import aiToolRoutes from '../../routes/ai-tool.routes.js';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';
import { createWorkspaceTools, workspaceRegistry } from '../../integrations/workspace-tools.js';
import { createToolExecutor } from '../../ai/tools/executor.js';
import { ToolError } from '../../ai/tools/registry.js';
import { executeClientTask } from '../../services/client-agent-action.service.js';
import { clientAgentProfileUpdateSchema } from '../../services/client-agent-profile.service.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { reauthCookies, withSession } from '../helpers/reauth.js';

const input = { clientId: 'client-a', projectId: 'project-a', title: 'Review artwork', priority: 'HIGH', description: 'Review supplied artwork', dueDate: '2026-10-20T12:00:00.000Z' };
function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(row => { row.isActive = true; });
  const profile = { id: 'profile-a', organizationId: 'org-a', clientId: 'client-a', revision: 1, enabled: true, pluginIds: ['client-work', 'client-task-actions'] };
  db.clientAgentProfile = { findFirst: async ({ where }) => where.organizationId === profile.organizationId && where.clientId === profile.clientId ? structuredClone(profile) : null };
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(row => row.id === 'team-a')), scopes: ['workspace:read', 'workspace:actions'] };
  const tools = createWorkspaceTools();
  const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  const prepare = (key = 'client-task-intent-1', override = {}) => tools.call(ctx, 'create_client_task', { input: { ...input, ...override }, idempotencyKey: key });
  return { db, ctx, tools, executor, profile, prepare };
}

test('task plugin is opt-in and strict: no assignee, URL, billing or arbitrary tools', async () => {
  const f = fixture(); f.profile.pluginIds = ['client-work'];
  await assert.rejects(f.prepare(), { code: 'TARGET_UNAVAILABLE' });
  assert.equal(f.db.tables.aiBridgeAction.length, 0);
  f.profile.pluginIds.push('client-task-actions');
  for (const extra of [{ assigneeId: 'team-a' }, { amount: 50 }, { tool: 'anything' }, { url: 'https://example.test' }]) await assert.rejects(f.prepare('invalid-extra-1', extra), { code: 'INVALID_INPUT' });
  const profile = { revision: 1, name: 'Account manager', instructions: '', enabled: true, pluginIds: ['client-work', 'client-task-actions'] };
  assert.equal(clientAgentProfileUpdateSchema.safeParse(profile).success, true);
  assert.equal(clientAgentProfileUpdateSchema.safeParse({ ...profile, pluginIds: ['arbitrary'] }).success, false);
});

test('immutable preview creates no task until explicit confirmation; Serializable receipt is idempotent', async () => {
  const f = fixture(), before = f.db.tables.task.length;
  const original = f.db.$transaction; let serializable = false;
  f.db.$transaction = (fn, options) => { serializable = options?.isolationLevel === 'Serializable'; return original(fn); };
  const pending = await f.prepare();
  assert.equal(f.db.tables.task.length, before);
  assert.deepEqual(pending.action.preview.task, { title: input.title, description: input.description, priority: input.priority, dueDate: input.dueDate });
  assert.equal(pending.action.preview.profileRevision, 1);
  assert.equal(pending.action.preview.destination.clientId, 'client-a');
  const done = await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id });
  assert.equal(serializable, true); assert.equal(done.action.status, 'EXECUTED');
  assert.equal(f.db.tables.task.length, before + 1); assert.equal(done.action.result.task.projectId, 'project-a');
  assert.equal((await f.prepare()).idempotent, true);
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
  assert.equal(f.db.tables.task.length, before + 1);
  await assert.rejects(f.prepare('client-task-intent-1', { title: 'Changed' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('profile edits, revocation and canonical remapping deny receipt reads, retries and transaction execution', async () => {
  for (const change of [f => { f.profile.enabled = false; }, f => { f.profile.pluginIds = ['client-work']; }, f => { f.profile.revision++; }, f => { f.db.tables.project[0].clientId = 'client-b'; }, f => { f.db.tables.project[0].organizationId = 'org-b'; }, f => { f.db.tables.project[0].deletedAt = new Date(); }, f => { f.db.tables.project[0].status = 'ON_HOLD'; }, f => { f.db.tables.client[0].deletedAt = new Date(); }, f => { f.db.tables.user.find(row => row.id === f.ctx.user.id).role = 'CLIENT'; }, f => { f.db.tables.user.find(row => row.id === f.ctx.user.id).isActive = false; }]) {
    const f = fixture(); const pending = await f.prepare(); const before = f.db.tables.task.length; change(f);
    for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: pending.action.id }));
    await assert.rejects(f.prepare());
    await assert.rejects(f.executor.approve(f.ctx, pending.action.id), { code: 'EXECUTION_FAILED' });
    assert.equal(f.db.tables.task.length, before);
  }
});

test('executed receipts remain protected after profile pause; ADMIN cannot use wrong canonical client', async () => {
  const f = fixture(); const pending = await f.prepare(); await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id });
  f.profile.enabled = false;
  for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: pending.action.id }));
  await assert.rejects(f.prepare());
  const g = fixture(); g.ctx.user.role = 'ADMIN'; g.db.tables.user.find(row => row.id === g.ctx.user.id).role = 'ADMIN';
  g.db.tables.project.push({ ...g.db.tables.project[0], id: 'wrong-client-project', clientId: 'client-b' });
  await assert.rejects(g.prepare('wrong-client-admin', { projectId: 'wrong-client-project' }), { code: 'TARGET_UNAVAILABLE' });
  await assert.rejects(g.prepare('foreign-project-admin', { projectId: 'project-b' }), { code: 'TARGET_UNAVAILABLE' });
  g.ctx.user.organizationId = 'org-b'; await assert.rejects(g.prepare(), { code: 'ROLE_DENIED' });
});

test('transaction rechecks approver and rolls back inserted tasks on persistence failure', async () => {
  const f = fixture(); const pending = await f.prepare();
  const approver = structuredClone(f.ctx.user); f.db.tables.user.find(row => row.id === approver.id).role = 'CLIENT';
  await assert.rejects(executeClientTask({ prisma: f.db, user: { id: 'admin-a', organizationId: 'org-a' }, approver, input, preview: pending.action.preview }), { code: 'ROLE_DENIED' });
  const g = fixture(), before = g.db.tables.task.length; const action = await g.prepare(); const original = g.db.task.create;
  g.db.task.create = async args => { await original(args); throw new Error('rollback insert'); };
  await assert.rejects(g.executor.approve(g.ctx, action.action.id), { code: 'EXECUTION_FAILED' });
  assert.equal(g.db.tables.task.length, before); assert.equal(g.db.tables.aiBridgeAction[0].status, 'FAILED');
  const h = fixture(); const expired = await h.prepare(); h.db.tables.aiBridgeAction[0].expiresAt = new Date(0);
  await assert.rejects(h.executor.approve(h.ctx, expired.action.id), { code: 'ACTION_EXPIRED' });
});

test('HTTP identity/recovery/recent-auth and workspace read-only key boundaries', async t => {
  const f = fixture(); const app = Fastify(); await app.register(cookie);
  app.decorate('authenticate', async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; });
  await app.register(routes, { prefix: '/api/clients' }); t.after(() => app.close());
  const base = '/api/clients/client-a/assistant/task-actions'; const { clientId: _client, ...form } = input;
  const prepared = await app.inject({ method: 'POST', url: base, payload: { input: form, idempotencyKey: 'http-client-task-1' } });
  assert.equal(prepared.statusCode, 200, prepared.body); const actionId = prepared.json().action.id;
  assert.equal(prepared.headers['cache-control'], 'no-store');
  assert.equal((await app.inject(`${base}/by-intent/http-client-task-1`)).json().action.id, actionId);
  assert.equal((await app.inject(`/api/clients/client-b/assistant/task-actions/${actionId}`)).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${actionId}/confirm`, payload: { confirm: true } })).json().code, 'REAUTH_REQUIRED');
  const result = await app.inject({ method: 'POST', url: `${base}/${actionId}/confirm`, payload: { confirm: true }, cookies: reauthCookies(f.ctx.user) });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().action.status, 'EXECUTED');
  f.profile.enabled = false;
  assert.equal((await app.inject(`${base}/${actionId}`)).statusCode, 409);
  assert.equal((await app.inject(`${base}/by-intent/http-client-task-1`)).statusCode, 409);
  const readOnly = { ...f.ctx, scopes: ['workspace:read'] };
  assert.equal(f.tools.list(readOnly).some(tool => tool.name === 'create_client_task'), false);
  await assert.rejects(f.tools.call(readOnly, 'create_client_task', { input, idempotencyKey: 'readonly-intent-1' }), { code: 'TOOL_UNAVAILABLE' });
});

test('generic assistant and legacy bridge routes never expose source-bound pending or executed receipts', async t => {
  const f = fixture();
  const pending = await f.prepare('generic-hidden-pending', { title: 'PRIVATE SOURCE PENDING' });
  const completed = await f.prepare('generic-hidden-completed', { title: 'PRIVATE SOURCE EXECUTED' });
  await f.tools.call(f.ctx, 'confirm_action', { actionId: completed.action.id });
  const ordinary = await f.executor.invoke(f.ctx, { tool: 'create_task', input: { projectId: 'project-a', title: 'Normal task preview' }, idempotencyKey: 'generic-visible-task', source: 'ai_bridge' });
  const app = Fastify(); await app.register(cookie); await app.register(rateLimit, { global: false });
  const authenticate = async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; r.apiKeyScopes = ['ai_bridge:read', 'ai_bridge:actions']; };
  app.decorate('authenticate', authenticate); app.decorate('authenticateWithApiKey', authenticate);
  let genericExecutions = 0;
  const guardExecutor = { ...f.executor, approve: async (...args) => { genericExecutions++; return f.executor.approve(...args); }, reject: async (...args) => { genericExecutions++; return f.executor.reject(...args); } };
  await app.register(aiToolRoutes, { prefix: '/generic', toolExecutor: guardExecutor });
  await app.register(aiBridgeRoutes, { prefix: '/legacy', toolExecutor: guardExecutor });
  await app.register(routes, { prefix: '/api/clients' });
  t.after(() => app.close());
  const sourceBase = '/api/clients/client-a/assistant/task-actions';
  // The authorized source-specific surface remains available before reassignment.
  assert.equal((await app.inject(`${sourceBase}/${pending.action.id}`)).statusCode, 200);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id })).action.id, pending.action.id);
  f.profile.enabled = false;
  for (const url of ['/generic/approvals', '/generic/receipts', '/generic/receipts?tool=create_client_task', '/generic/receipts?status=EXECUTED&source=ai_bridge']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, response.body);
    assert.doesNotMatch(response.body, /PRIVATE SOURCE|create_client_task|Client artwork|client@example.test/);
  }
  assert.equal((await app.inject('/generic/approvals')).json().approvals[0].id, ordinary.action.id);
  const cookies = reauthCookies(f.ctx.user);
  for (const row of [pending.action, completed.action]) {
    const detail = await app.inject(`/generic/approvals/${row.id}`);
    assert.equal(detail.statusCode, 404); assert.doesNotMatch(detail.body, /PRIVATE SOURCE|Client artwork/);
    for (const [url, payload] of [[`/generic/approvals/${row.id}/approve`, {}], [`/generic/approvals/${row.id}/reject`, { reason: 'not_needed' }], [`/legacy/v1/actions/${row.id}/confirm`, { confirm: true }]]) {
      const response = await app.inject({ method: 'POST', url, payload, cookies });
      assert.equal(response.statusCode, 404, `${url}: ${response.body}`);
      assert.doesNotMatch(response.body, /PRIVATE SOURCE|Client artwork|preview|result/);
    }
  }
  assert.equal(genericExecutions, 0);
  assert.equal(f.db.tables.aiBridgeAction.find(row => row.id === pending.action.id).status, 'PENDING_CONFIRMATION');
  assert.equal(f.db.tables.aiBridgeAction.find(row => row.id === completed.action.id).status, 'EXECUTED');
  assert.equal((await app.inject(`${sourceBase}/${completed.action.id}`)).statusCode, 409);
  await assert.rejects(f.tools.call(f.ctx, 'get_action', { actionId: completed.action.id }));
  f.profile.enabled = true;
  assert.equal((await app.inject(`${sourceBase}/${completed.action.id}`)).statusCode, 200);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: completed.action.id })).action.status, 'EXECUTED');
});

test('generic response and error projections fail closed for a source-bound action even if an executor returns one', async t => {
  const f = fixture(); const hidden = await f.prepare('hidden-error-projection', { title: 'PRIVATE SOURCE RECEIPT' });
  const ordinary = await f.executor.invoke(f.ctx, { tool: 'create_task', input: { projectId: 'project-a', title: 'Ordinary task' }, idempotencyKey: 'normal-error-projection', source: 'ai_bridge' });
  const app = Fastify(); await app.register(cookie); await app.register(rateLimit, { global: false });
  const authenticate = async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; r.apiKeyScopes = ['ai_bridge:actions']; };
  app.decorate('authenticate', authenticate); app.decorate('authenticateWithApiKey', authenticate);
  let errorMode = false;
  const executor = { ...f.executor, approve: async () => {
    if (errorMode) throw new ToolError('ACTION_UNAVAILABLE', 'Action unavailable', { statusCode: 409, action: hidden.action });
    return { action: hidden.action, idempotent: true };
  }, reject: async () => { throw new ToolError('ACTION_UNAVAILABLE', 'Action unavailable', { statusCode: 409, action: hidden.action }); } };
  await app.register(aiToolRoutes, { prefix: '/generic', toolExecutor: executor });
  await app.register(aiBridgeRoutes, { prefix: '/legacy', toolExecutor: executor }); t.after(() => app.close());
  const cookies = reauthCookies(f.ctx.user);
  for (const mode of [false, true]) {
    errorMode = mode;
    for (const [url, payload] of [[`/generic/approvals/${ordinary.action.id}/approve`, {}], [`/generic/approvals/${ordinary.action.id}/reject`, { reason: 'not_needed' }], [`/legacy/v1/actions/${ordinary.action.id}/confirm`, { confirm: true }]]) {
      const response = await app.inject({ method: 'POST', url, payload, cookies });
      assert.equal(response.statusCode, 404, response.body); assert.doesNotMatch(response.body, /PRIVATE SOURCE|preview|result/);
    }
  }
});

