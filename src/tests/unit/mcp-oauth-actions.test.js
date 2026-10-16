import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { assertMcpActionAuthority } from '../../auth/mcp-action-authority.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import clientTaskRoutes from '../../routes/client-agent-action.routes.js';
import { reauthCookies, withSession } from '../helpers/reauth.js';
const taskScope = 'workspace:client-tasks:write', reportScope = 'workspace:service-reports:publish';
const task = { clientId: 'client-a', projectId: 'project-a', title: 'Scoped OAuth task', priority: 'HIGH' };
const report = { clientId: 'client-a', mappingId: 'mapping-a', snapshot: { mappingRevision: 1, providerProjectIdMatch: 'source-a', outcome: 'OK', complete: true, reports: [{ providerReportId: 'new', title: 'Saved', summary: 'Private fixture text', sourceReportedAt: null }] } };
function fixture(scopes = [taskScope, reportScope]) {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(row => { row.isActive = true; row.sessionVersion = 1; });
  const profile = { id: 'profile-a', organizationId: 'org-a', clientId: 'client-a', revision: 1, enabled: true, pluginIds: ['client-work', 'client-task-actions'] };
  db.clientAgentProfile = { findFirst: async () => structuredClone(profile) };
  db.tables.clientServiceProject.push({ id: 'mapping-a', organizationId: 'org-a', clientId: 'client-a', provider: 'OPENSEO', providerProjectId: 'source-a', displayLabel: 'Brand A', enabled: true, revision: 1 });
  const key = { id: 'oauth-key-a', userId: 'admin-a', isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 3600000), scopes: ['workspace:read', ...scopes] };
  db.apiKey = { findUnique: async ({ where }) => where.id === key.id ? structuredClone(key) : null };
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(row => row.id === 'admin-a')), scopes: [...key.scopes],
    oauth: { keyId: key.id, clientId: 'https://chatgpt.com/oauth/client.json', sessionVersion: 1, scopes: [...key.scopes], expiresAt: Date.now() + 86400000 } };
  const tools = createWorkspaceTools();
  const prepare = (action = 'create_client_task', idempotencyKey = 'oauth-task-fixture') => tools.call(ctx, action, { input: action === 'create_client_task' ? task : report, idempotencyKey });
  return { db, key, ctx, tools, prepare, profile };
}

test('OAuth discovery and direct calls honor two narrow scopes; broad scope never substitutes', async () => {
  for (const [scopes, expected] of [[[], []], [[taskScope], ['create_client_task']], [[reportScope], ['publish_client_service_report_snapshot']], [[taskScope, reportScope], ['create_client_task', 'publish_client_service_report_snapshot']], [['workspace:actions'], []]]) {
    const f = fixture(scopes), names = f.tools.list(f.ctx).map(tool => tool.name);
    for (const action of ['create_client_task', 'publish_client_service_report_snapshot']) {
      assert.equal(names.includes(action), expected.includes(action));
      if (!expected.includes(action)) await assert.rejects(f.prepare(action), { code: 'TOOL_UNAVAILABLE' });
    }
    for (const legacy of ['create_task', 'create_calendar_event', 'create_invoice']) assert.equal(names.includes(legacy), false);
  }
});

test('scoped task prepare/confirm/recovery is grant-bound and records API confirmation honestly', async () => {
  const f = fixture([taskScope]), before = f.db.tables.task.length;
  const pending = await f.prepare();
  assert.equal(f.db.tables.task.length, before);
  assert.equal('authorizationBinding' in pending.action, false);
  const stored = f.db.tables.aiBridgeAction[0];
  assert.equal(stored.authorizationBinding.keyId, f.key.id);
  assert.equal(stored.authorizationBinding.requiredScope, taskScope);
  const done = await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id });
  assert.equal(done.action.status, 'EXECUTED');
  assert.equal(stored.approvalEvidence.method, 'oauth_confirm');
  assert.equal(stored.approvalEvidence.reauthenticated, false);
  assert.equal((await f.prepare()).idempotent, true);
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
  assert.equal(f.db.tables.task.length, before + 1);
});

test('controls derive scope from stored target, deny other grants, API keys and unlisted legacy receipts', async () => {
  const f = fixture(), p = await f.prepare();
  const contexts = [{ ...f.ctx, scopes: ['workspace:read', reportScope], oauth: { ...f.ctx.oauth, scopes: ['workspace:read', reportScope] } },
    { ...f.ctx, oauth: { ...f.ctx.oauth, keyId: 'another-key-same-owner' } }, { ...f.ctx, oauth: null, scopes: ['workspace:actions'] }];
  for (const ctx of contexts) for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(ctx, operation, { actionId: p.action.id }), { code: 'NOT_FOUND' });
  const unlisted = { ...structuredClone(f.db.tables.aiBridgeAction[0]), id: 'legacy', action: 'create_calendar_event', authorizationBinding: null };
  f.db.tables.aiBridgeAction.push(unlisted);
  for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: 'legacy' }), { code: 'NOT_FOUND' });
  const reportOnly = fixture([reportScope]);
  const q = await reportOnly.prepare('publish_client_service_report_snapshot', 'scoped-report-fixture');
  await reportOnly.tools.call(reportOnly.ctx, 'confirm_action', { actionId: q.action.id });
  assert.equal((await reportOnly.tools.call(reportOnly.ctx, 'get_action', { actionId: q.action.id })).action.status, 'EXECUTED');
  assert.equal((await reportOnly.prepare('publish_client_service_report_snapshot', 'scoped-report-fixture')).idempotent, true);
});

test('revocation, scope changes, demotion, sessions, organization and expiry block every receipt and replay surface', async () => {
  const changes = [f => { f.key.revokedAt = new Date(); }, f => { f.key.isActive = false; }, f => { f.key.scopes = ['workspace:read']; },
    f => { f.db.tables.user.find(row => row.id === 'admin-a').role = 'TEAM'; }, f => { f.db.tables.user.find(row => row.id === 'admin-a').sessionVersion++; },
    f => { f.db.tables.user.find(row => row.id === 'admin-a').organizationId = 'org-b'; }, f => { f.key.expiresAt = new Date(0); }, f => { f.ctx.oauth.expiresAt = 0; }];
  for (const completed of [false, true]) for (const change of changes) {
    const f = fixture(), p = await f.prepare();
    if (completed) await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id });
    change(f);
    for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: p.action.id }));
    await assert.rejects(f.prepare());
  }
});

test('current client/project/profile binding checks survive OAuth transport', async () => {
  for (const change of [f => { f.profile.enabled = false; }, f => { f.profile.revision++; }, f => { f.db.tables.project[0].clientId = 'client-b'; }, f => { f.db.tables.client[0].deletedAt = new Date(); }]) {
    const f = fixture(), p = await f.prepare(); change(f);
    for (const operation of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, operation, { actionId: p.action.id }));
    await assert.rejects(f.prepare());
  }
});

test('revocation inside Serializable claim aborts publication/task/rejection without any approval or receipt mutation', async () => {
  for (const operation of ['confirm_action', 'reject_action']) for (const action of ['create_client_task', 'publish_client_service_report_snapshot']) {
    const f = fixture(), p = await f.prepare(action), before = structuredClone(f.db.tables.aiBridgeAction[0]);
    const taskCount = f.db.tables.task.length, transaction = f.db.$transaction;
    f.db.$transaction = (callback, options) => { assert.equal(options?.isolationLevel, 'Serializable'); return transaction(async tx => { f.key.isActive = false; return callback(tx); }); };
    await assert.rejects(f.tools.call(f.ctx, operation, { actionId: p.action.id }));
    assert.deepEqual(f.db.tables.aiBridgeAction[0], before);
    assert.equal(f.db.tables.task.length, taskCount);
    assert.equal(f.db.tables.clientServiceProject[0].revision, 1);
  }
});

test('revocation inside prepare transaction cannot persist a bound proposal', async () => {
  const f = fixture(), transaction = f.db.$transaction;
  f.db.$transaction = (callback, options) => { assert.equal(options?.isolationLevel, 'Serializable'); return transaction(async tx => { f.key.isActive = false; return callback(tx); }); };
  await assert.rejects(f.prepare());assert.equal(f.db.tables.aiBridgeAction.length, 0);
});

test('unbound existing API-key receipts stay compatible while OAuth cannot adopt them', async () => {
  const f = fixture(), api = { ...f.ctx, oauth: null, scopes: ['workspace:actions'] };
  const pending = await f.tools.call(api, 'create_client_task', { input: task, idempotencyKey: 'old-api-key-task' });
  await assert.rejects(f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id }), { code: 'NOT_FOUND' });
  assert.equal((await f.tools.call(api, 'confirm_action', { actionId: pending.action.id })).action.status, 'EXECUTED');
  await assert.rejects(assertMcpActionAuthority(f.db, f.ctx, 'create_calendar_event'));
});

test('actual SDK discovery advertises narrow scopes and alternative control schemes consistently', async () => {
  for (const scopes of [[], [taskScope], [reportScope], [taskScope, reportScope]]) {
    const f = fixture(scopes);
    const server = createWorkspaceMcp(f.tools, { ...f.ctx, oauthEnabled: true });
    const client = new Client({ name: 'scope-metadata-qa', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const wireMessages = [], send = serverTransport.send.bind(serverTransport);
    serverTransport.send = async message => { wireMessages.push(message); return send(message); };
    await server.connect(serverTransport);await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const expected = ['get_action', 'confirm_action', 'reject_action'].includes(tool.name) ? [taskScope, reportScope]
          : tool.name === 'create_client_task' ? [taskScope] : tool.name === 'publish_client_service_report_snapshot' ? [reportScope] : ['workspace:read'];
        const schemes = expected.map(scope => ({ type: 'oauth2', scopes: [scope] }));
        assert.deepEqual(tool._meta.securitySchemes, schemes);
        const wireTool = wireMessages.find(message => message.result?.tools)?.result.tools.find(row => row.name === tool.name);
        assert.deepEqual(wireTool.securitySchemes, schemes);
      }
      if (!scopes.length) assert.equal(tools.some(tool => tool.name === 'confirm_action'), false);
    } finally { await client.close();await server.close(); }
  }
});

test('JWT client-task ID/intent reads and terminal discard cannot adopt OAuth-bound receipts', async t => {
  const f = fixture(), p = await f.prepare();
  const app = Fastify();await app.register(cookie);
  app.decorate('authenticate', async request => { request.user = withSession(f.ctx.user);request.prisma = f.db; });
  await app.register(clientTaskRoutes, { prefix: '/api/clients' });t.after(() => app.close());
  const base = '/api/clients/client-a/assistant/task-actions';
  for (const completed of [false, true]) {
    if (completed) await f.tools.call(f.ctx, 'confirm_action', { actionId: p.action.id });
    for (const suffix of [p.action.id, 'by-intent/oauth-task-fixture']) {
      const get = await app.inject(`${base}/${suffix}`);assert.equal(get.statusCode, 404);assert.doesNotMatch(get.body, /Scoped OAuth task/);
      const reject = await app.inject({ method: 'POST', url: `${base}/${suffix}/reject`, cookies: reauthCookies(f.ctx.user), payload: {} });
      assert.equal(reject.statusCode, 404, reject.body);
    }
  }
});
