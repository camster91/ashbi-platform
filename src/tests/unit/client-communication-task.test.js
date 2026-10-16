import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import routes from '../../routes/client-communications.routes.js';
import aiToolRoutes from '../../routes/ai-tool.routes.js';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';
import { createWorkspaceTools, workspaceRegistry } from '../../integrations/workspace-tools.js';
import { createToolExecutor } from '../../ai/tools/executor.js';
import { createToolRegistry, ToolError } from '../../ai/tools/registry.js';
import { communicationTaskScope } from '../../services/client-communication-task.service.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { reauthCookies, withSession } from '../helpers/reauth.js';

const input = { clientId: 'client-a', source: 'inbox', messageId: 'message-a', projectId: 'project-a', title: 'Review supplied artwork', description: 'Review the client attachment', priority: 'HIGH', dueDate: '2026-10-20T12:00:00.000Z' };
function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(row => { row.isActive = true; });
  const state = { thread: { id: 'thread-a', clientId: 'client-a', projectId: null, assignedToId: 'team-a' }, message: { id: 'message-a', threadId: 'thread-a', subject: 'Client artwork', senderEmail: 'client@example.test', receivedAt: new Date('2026-10-15T10:00:00Z'), direction: 'INBOUND', bodyText: 'Please review the new artwork' } };
  db.message = { findFirst: async ({ where }) => {
    const thread = state.thread, client = db.tables.client.find(row => row.id === thread.clientId);
    if (!state.message || where.id !== state.message.id || thread.clientId !== where.thread.clientId || client?.organizationId !== where.thread.client.organizationId || client?.deletedAt != null || (where.thread.assignedToId && thread.assignedToId !== where.thread.assignedToId)) return null;
    return structuredClone({ ...state.message, thread: { ...thread, project: db.tables.project.find(row => row.id === thread.projectId) ?? null } });
  } };
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(row => row.id === 'team-a')), scopes: ['workspace:read', 'workspace:actions'] };
  const tools = createWorkspaceTools();
  const executor = createToolExecutor({ registry: workspaceRegistry, governance: { assertAllowed: async () => {} }, logger: { warn() {}, error() {} } });
  const prepare = (key = 'email-task-intent-1', override = {}) => tools.call(ctx, 'create_task_from_client_message', { input: { ...input, ...override }, idempotencyKey: key });
  return { db, ctx, tools, executor, state, prepare };
}

test('task intake previews exact stored provenance and writes only on confirmed Serializable execution', async () => {
  const f = fixture(); const before = f.db.tables.task.length;
  const original = f.db.$transaction; let transactions = 0;
  f.db.$transaction = (fn, options) => { transactions++; assert.equal(options.isolationLevel, 'Serializable'); return original(fn); };
  const pending = await f.prepare();
  assert.equal(f.db.tables.task.length, before); assert.equal(transactions, 0);
  assert.equal(pending.action.preview.source.subject, 'Client artwork');
  assert.equal(pending.action.preview.source.sender, 'client@example.test');
  assert.equal(pending.action.preview.destination.projectId, 'project-a');
  assert.equal(pending.action.preview.task.description, input.description);
  assert.match(pending.action.preview.sourceFingerprint, /^[a-f0-9]{64}$/);
  const completed = await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id });
  assert.equal(completed.action.status, 'EXECUTED'); assert.equal(transactions, 1);
  assert.equal(completed.action.result.task.sourceThreadId, 'thread-a');
  assert.equal(f.db.tables.task.length, before + 1);
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
  assert.equal((await f.prepare()).idempotent, true);
  assert.equal(f.db.tables.task.length, before + 1);
  await assert.rejects(f.prepare('email-task-intent-1', { title: 'Changed payload' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('caller cannot supply an observed fingerprint or a project-email source', async () => {
  const f = fixture();
  await assert.rejects(f.prepare('email-invalid-1', { sourceFingerprint: 'forged' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.prepare('email-invalid-2', { source: 'project' }), { code: 'INVALID_INPUT' });
  assert.equal(f.db.tables.aiBridgeAction.length, 0);
});

test('source body/identity/time/reassignment changes invalidate the frozen preview without a task', async () => {
  for (const change of [f => { f.state.message.bodyText += ' changed'; }, f => { f.state.message.subject = 'Changed'; }, f => { f.state.message.senderEmail = 'other@example.test'; }, f => { f.state.message.receivedAt = new Date(); }, f => { f.state.thread.assignedToId = 'team2-a'; f.ctx.user.role = 'ADMIN'; f.db.tables.user.find(row => row.id === 'team-a').role = 'ADMIN'; }]) {
    const f = fixture(); const pending = await f.prepare(); const before = f.db.tables.task.length; change(f);
    await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal(f.db.tables.task.length, before); assert.equal(f.db.tables.aiBridgeAction[0].status, 'FAILED');
  }
});

test('fresh authority denies revoked assignment/role, foreign or inactive destinations and deleted records', async () => {
  const changes = [f => { f.state.thread.assignedToId = 'team2-a'; }, f => { f.db.tables.user.find(row => row.id === 'team-a').role = 'CLIENT'; }, f => { f.db.tables.user.find(row => row.id === 'team-a').isActive = false; }, f => { f.db.tables.client[0].deletedAt = new Date(); }, f => { f.db.tables.project[0].deletedAt = new Date(); }, f => { f.db.tables.project[0].status = 'CANCELLED'; }, f => { f.db.tables.project[0].clientId = 'client-b'; }, f => { f.state.message = null; }];
  for (const change of changes) {
    const f = fixture(); const pending = await f.prepare(); const before = f.db.tables.task.length; change(f);
    await assert.rejects(f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id }));
    await assert.rejects(f.prepare());
    // Direct executor must still reauthorize inside its transaction even without the HTTP/MCP guard.
    await assert.rejects(f.executor.approve(f.ctx, pending.action.id, { method: 'api_key_confirm', ownerOnly: true }), { code: 'EXECUTION_FAILED' });
    assert.equal(f.db.tables.task.length, before);
  }
  const f = fixture();
  await assert.rejects(f.prepare('foreign-project-1', { projectId: 'project-b' }), { code: 'TARGET_UNAVAILABLE' });
  f.state.thread.projectId = 'project-a';
  f.db.tables.project.push({ ...f.db.tables.project[0], id: 'second-project' });
  await assert.rejects(f.prepare('mismatched-project-1', { projectId: 'second-project' }), { code: 'TARGET_UNAVAILABLE' });
});

test('expired previews and task persistence failures never leave a task with a successful receipt', async () => {
  const f = fixture(); const pending = await f.prepare(); const before = f.db.tables.task.length;
  f.db.tables.aiBridgeAction[0].expiresAt = new Date(0);
  await assert.rejects(f.executor.approve(f.ctx, pending.action.id), { code: 'ACTION_EXPIRED' });
  assert.equal(f.db.tables.task.length, before); assert.equal(f.db.tables.aiBridgeAction[0].status, 'EXPIRED');
  const g = fixture(); const next = await g.prepare();
  const original = g.db.task.create;
  g.db.task.create = async args => { await original(args); throw new Error('simulated persistence failure'); };
  await assert.rejects(g.executor.approve(g.ctx, next.action.id), { code: 'EXECUTION_FAILED' });
  assert.equal(g.db.tables.task.length, before); assert.equal(g.db.tables.aiBridgeAction[0].status, 'FAILED');
});

test('executor supplies the persisted server preview to transactional execution', async () => {
  const db = seedTwoOrganizations(createFakeToolDb()); let seen;
  const registry = createToolRegistry([{ name: 'preview_context_probe', description: 'Probe persisted preview', class: 'execute', roles: ['TEAM'], inputSchema: z.object({}).strict(), resolveScope: async () => ({ ids: {} }), preview: async () => ({ observed: 'server-only' }), rollback: 'Transaction rolls back.', execution: { mode: 'transaction', execute: async ({ preview }) => { seen = preview; return {}; } } }]);
  const executor = createToolExecutor({ registry, governance: { assertAllowed: async () => {} } });
  const ctx = { prisma: db, user: { id: 'team-a', organizationId: 'org-a', role: 'TEAM' } };
  const pending = await executor.invoke(ctx, { tool: 'preview_context_probe', input: {}, idempotencyKey: 'preview-context-1', source: 'ai_bridge' });
  await executor.approve(ctx, pending.action.id);
  assert.deepEqual(seen, { observed: 'server-only' });
});

test('HTTP task endpoints enforce identity bindings, immutable intent recovery and recent authentication', async t => {
  const f = fixture(); const app = Fastify(); await app.register(cookie);
  app.decorate('authenticate', async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; });
  await app.register(routes, { prefix: '/api/client-communications' }); t.after(() => app.close());
  const base = '/api/client-communications/client-a/inbox/message-a/task-actions';
  const { clientId: _client, source: _source, messageId: _message, ...form } = input;
  const payload = { input: form, idempotencyKey: 'http-email-task-1' };
  const prepared = await app.inject({ method: 'POST', url: base, payload });
  assert.equal(prepared.statusCode, 200, prepared.body); assert.equal(prepared.headers['cache-control'], 'no-store');
  const actionId = prepared.json().action.id;
  assert.equal((await app.inject(`${base}/by-intent/http-email-task-1`)).json().action.id, actionId);
  assert.equal((await app.inject(`${base}/by-intent/missing-intent-1`)).statusCode, 404);
  assert.equal((await app.inject(`${base}/${actionId}`)).statusCode, 200);
  assert.equal((await app.inject(`/api/client-communications/client-a/inbox/other/task-actions/${actionId}`)).statusCode, 404);
  const blocked = await app.inject({ method: 'POST', url: `${base}/${actionId}/confirm`, payload: { confirm: true } });
  assert.equal(blocked.statusCode, 403); assert.equal(blocked.json().code, 'REAUTH_REQUIRED');
  const confirm = await app.inject({ method: 'POST', url: `${base}/${actionId}/confirm`, payload: { confirm: true }, cookies: reauthCookies(f.ctx.user) });
  assert.equal(confirm.statusCode, 200, confirm.body); assert.equal(confirm.json().action.status, 'EXECUTED');
  f.state.thread.assignedToId = 'team2-a';
  assert.equal((await app.inject(`${base}/${actionId}`)).statusCode, 404);
  assert.equal((await app.inject(`${base}/by-intent/http-email-task-1`)).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: base, payload })).statusCode, 404);
});

test('HTTP refuses stale actor roles, foreign action owners, malformed input and unsafe database errors', async t => {
  const f = fixture(); const app = Fastify(); await app.register(cookie);
  app.decorate('authenticate', async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; });
  await app.register(routes, { prefix: '/api/client-communications' }); t.after(() => app.close());
  const base = '/api/client-communications/client-a/inbox/message-a/task-actions';
  assert.equal((await app.inject({ method: 'POST', url: base, payload: { input, idempotencyKey: 'intent-1' } })).statusCode, 400);
  const pending = await f.prepare(); f.db.tables.aiBridgeAction[0].userId = 'team2-a';
  assert.equal((await app.inject(`${base}/${pending.action.id}`)).statusCode, 404);
  f.db.tables.user.find(row => row.id === 'team-a').role = 'CLIENT';
  assert.equal((await app.inject(`${base}/by-intent/email-task-intent-1`)).statusCode, 403);
  f.db.user.findFirst = async () => { throw new Error('password=private-value'); };
  const error = await app.inject(`${base}/by-intent/email-task-intent-1`);
  assert.equal(error.statusCode, 503); assert.doesNotMatch(error.body, /password|private-value/);
});

test('projectless source accepts working phases while linked source cannot change canonical project', async () => {
  const f = fixture();
  for (const status of ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'ACTIVE']) {
    f.db.tables.project[0].status = status;
    assert.equal((await communicationTaskScope({ ...f.ctx, input })).ids.projectId, 'project-a');
  }
  for (const status of ['DRAFT', 'PAUSED', 'ON_HOLD', 'LAUNCHED', 'CANCELLED']) {
    f.db.tables.project[0].status = status;
    await assert.rejects(communicationTaskScope({ ...f.ctx, input }), { code: 'TARGET_UNAVAILABLE' });
  }
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
  await app.register(routes, { prefix: '/api/client-communications' });
  t.after(() => app.close());
  const sourceBase = '/api/client-communications/client-a/inbox/message-a/task-actions';
  // The authorized source-specific surface remains available before reassignment.
  assert.equal((await app.inject(`${sourceBase}/${pending.action.id}`)).statusCode, 200);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id })).action.id, pending.action.id);
  f.state.thread.assignedToId = 'team2-a';
  for (const url of ['/generic/approvals', '/generic/receipts', '/generic/receipts?tool=create_task_from_client_message', '/generic/receipts?status=EXECUTED&source=ai_bridge']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, response.body);
    assert.doesNotMatch(response.body, /PRIVATE SOURCE|create_task_from_client_message|Client artwork|client@example.test/);
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
  assert.equal((await app.inject(`${sourceBase}/${completed.action.id}`)).statusCode, 404);
  await assert.rejects(f.tools.call(f.ctx, 'get_action', { actionId: completed.action.id }));
  f.state.thread.assignedToId = 'team-a';
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

test('dedicated confirmation refusals omit private receipts and raw messages after transactional access revocation', async t => {
  const f = fixture(); const pending = await f.prepare('dedicated-private-refusal', { title: 'PRIVATE SOURCE PREVIEW' });
  const app = Fastify(); await app.register(cookie);
  app.decorate('authenticate', async r => { r.user = withSession(f.ctx.user); r.prisma = f.db; });
  let refusal = 'EXECUTION_FAILED'; let attempted = 0;
  const executor = { ...f.executor, approve: async () => {
    attempted++;
    // Authorization passed in the route, then changed during execution.
    f.state.thread.assignedToId = 'team2-a';
    throw new ToolError(refusal, 'PRIVATE RAW MESSAGE password=private-value', { statusCode: refusal === 'ROLE_DENIED' ? 403 : 409, action: pending.action });
  } };
  await app.register(routes, { prefix: '/api/client-communications', toolExecutor: executor }); t.after(() => app.close());
  const base = '/api/client-communications/client-a/inbox/message-a/task-actions';
  for (const code of ['EXECUTION_FAILED', 'ROLE_DENIED']) {
    refusal = code; f.state.thread.assignedToId = 'team-a';
    assert.equal((await app.inject(`${base}/${pending.action.id}`)).statusCode, 200);
    const response = await app.inject({ method: 'POST', url: `${base}/${pending.action.id}/confirm`, payload: { confirm: true }, cookies: reauthCookies(f.ctx.user) });
    assert.equal(response.statusCode, code === 'ROLE_DENIED' ? 403 : 409);
    assert.deepEqual(response.json(), { code, error: code === 'ROLE_DENIED' ? 'Staff access required' : 'Task action unavailable' });
    assert.doesNotMatch(response.body, /PRIVATE|password|preview|"action"|private-value/);
    assert.equal((await app.inject(`${base}/${pending.action.id}`)).statusCode, 404);
    assert.equal((await app.inject(`${base}/by-intent/dedicated-private-refusal`)).statusCode, 404);
  }
  assert.equal(attempted, 2);
});
