import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readClientAccountManagerBrief } from '../../services/client-account-manager.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';
import clientAssistantRoutes from '../../routes/client-assistant.routes.js';

const user = { id: 'staff-a', organizationId: 'org-a', role: 'ADMIN' };
const client = { id: 'client-a', name: 'Example', domain: 'example.test', organizationId: 'org-a', deletedAt: null };
const project = { id: 'p-a', name: 'Launch', status: 'ACTIVE', startDate: null, endDate: null,
  organizationId: 'org-a', clientId: 'client-a', deletedAt: null, client: { id: 'client-a', name: 'Example' } };
function fixture({ actor = { ...user, isActive: true }, clientResult = client, tasks = [], failTasks = false } = {}) {
  const reads = [];
  const findMany = model => async args => { reads.push([model, args]); return []; };
  const prisma = {
    clientAgentProfile: { findFirst: async () => null },
    user: { findFirst: async args => { reads.push(['actor', args]); return actor; }, findMany: findMany('users') },
    client: { findFirst: async args => { reads.push(['client', args]); return clientResult; } },
    project: { findMany: async args => { reads.push(['projects', args]); return [project]; } },
    task: { findMany: async args => { reads.push(['tasks', args]); if (failTasks) throw new Error('private provider body'); return tasks; } },
    approval: { findMany: findMany('approvals') }, reviewSession: { findMany: findMany('reviews') },
    proposal: { findMany: findMany('proposals') }, contract: { findMany: findMany('contracts') }, invoice: { findMany: findMany('invoices') },
  };
  return { prisma, reads };
}
const task = (id = 't-a', overrides = {}) => ({ id, title: 'Review design', status: 'BLOCKED', blockedBy: 'Awaiting assets',
  dueDate: null, createdAt: new Date(), assigneeId: user.id, assignee: { id: user.id, name: 'Cameron' }, project, ...overrides });

test('brief is bounded, links source records and selects no private project context', async () => {
  const { prisma, reads } = fixture({ tasks: [task(), task('t-b')] });
  const result = await readClientAccountManagerBrief(prisma, user, { clientId: client.id, limit: 1 });
  assert.equal(result.mode, 'STAFF_READ_ONLY'); assert.equal(result.owner, 'everyone');
  assert.equal(result.total, 2); assert.equal(result.rows.length, 1); assert.equal(result.hasMore, true);
  assert.equal(result.counts.at_risk, 2); assert.equal(result.rows[0].sourceUrl, '/task/t-a');
  assert.equal(result.partial, false); assert.equal(result.scopeMismatch, false);
  assert.deepEqual(result.context.client, { id: client.id, name: client.name, domain: client.domain });
  assert.deepEqual(result.plugins.map(p => p.id), ['client-work', 'client-task-actions']);
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  assert.deepEqual(reads.find(([key]) => key === 'actor')[1].where, { id: user.id, organizationId: user.organizationId, isActive: true });
  const query = reads.find(([key]) => key === 'tasks')[1];
  assert.equal(query.where.AND[0].project.clientId, client.id);
  assert.match(JSON.stringify(query.where.AND[1]), /"organizationId":"org-a"/);
  assert.equal(query.take, 101);
});

for (const role of ['CLIENT', 'BOT', 'STAFF', undefined]) {
  test(`brief refuses ${role} before any query`, async () => {
    const { prisma, reads } = fixture();
    await assert.rejects(readClientAccountManagerBrief(prisma, { ...user, role }, { clientId: client.id }), { code: 'ROLE_DENIED' });
    assert.equal(reads.length, 0);
  });
}
for (const actor of [null, { ...user, isActive: false }, { ...user, role: 'CLIENT', isActive: true }, { ...user, organizationId: 'org-b', isActive: true }]) {
  test(`brief rechecks stored staff authority ${JSON.stringify(actor)}`, async () => {
    const { prisma, reads } = fixture({ actor });
    await assert.rejects(readClientAccountManagerBrief(prisma, user, { clientId: client.id }), { code: 'ROLE_DENIED' });
    assert.deepEqual(reads.map(([key]) => key), ['actor']);
  });
}
for (const clientResult of [null, { ...client, organizationId: 'org-b' }, { ...client, deletedAt: new Date() }, { ...client, id: 'client-b' }]) {
  test(`unavailable client fails before queue reads ${JSON.stringify(clientResult)}`, async () => {
    const { prisma, reads } = fixture({ clientResult });
    await assert.rejects(readClientAccountManagerBrief(prisma, user, { clientId: client.id }), { code: 'RECORD_NOT_FOUND' });
    assert.deepEqual(reads.map(([key]) => key), ['actor', 'client']);
  });
}

test('stored TEAM role overrides stale ADMIN claims and omits approval/financial sources', async () => {
  const { prisma, reads } = fixture({ actor: { ...user, role: 'TEAM', isActive: true } });
  const result = await readClientAccountManagerBrief(prisma, user, { clientId: client.id });
  assert.equal(result.owner, 'me'); assert.deepEqual(result.sources, ['tasks', 'reviews']);
  assert.equal(reads.find(([key]) => key === 'tasks')[1].where.AND[0].assigneeId, user.id);
  assert.equal(reads.find(([key]) => key === 'reviews')[1].where.createdById, user.id);
  assert.ok(!reads.some(([key]) => ['approvals', 'invoices', 'contracts', 'proposals'].includes(key)));
});

test('failed and capped sources remain explicit; row limit never means complete coverage', async () => {
  const failed = fixture({ failTasks: true });
  const result = await readClientAccountManagerBrief(failed.prisma, user, { clientId: client.id });
  assert.equal(result.partial, true); assert.deepEqual(result.failedSources, ['tasks']);
  assert.doesNotMatch(JSON.stringify(result), /private provider/);
  const capped = fixture({ tasks: Array.from({ length: 101 }, (_, i) => task(`t-${i}`)) });
  const truncated = await readClientAccountManagerBrief(capped.prisma, user, { clientId: client.id });
  assert.deepEqual(truncated.truncatedSources, ['tasks']); assert.equal(truncated.total, 100);
  assert.equal(truncated.rows.length, 8); assert.equal(truncated.hasMore, true);
});

test('mismapped source rows cannot leak through the brief or its counts', async () => {
  const { prisma } = fixture({ tasks: [task(), task('foreign', { project: { ...project, client: { id: 'client-b', name: 'Private' } } })] });
  const result = await readClientAccountManagerBrief(prisma, user, { clientId: client.id });
  assert.equal(result.scopeMismatch, true); assert.equal(result.partial, true);
  assert.equal(result.total, 1); assert.equal(result.counts.at_risk, 1);
  assert.doesNotMatch(JSON.stringify(result), /Private|foreign/);
});

test('strict schemas refuse injected scope and invalid bounds without reads', async () => {
  for (const input of [{ clientId: client.id, organizationId: 'org-b' }, { clientId: client.id, limit: 51 }, { clientId: client.id, limit: 0 }, { clientId: '' }]) {
    const { prisma, reads } = fixture();
    await assert.rejects(readClientAccountManagerBrief(prisma, user, input), { code: 'INVALID_INPUT' });
    assert.equal(reads.length, 0);
  }
});

test('real MCP SDK discovers curated read tools and returns a scoped brief without inference', async () => {
  const { prisma } = fixture({ tasks: [task()] });
  const service = createWorkspaceTools();
  const ctx = { user, prisma, scopes: ['workspace:read'], oauthEnabled: true };
  const server = createWorkspaceMcp(service, ctx);
  const clientSdk = new Client({ name: 'account-manager-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await clientSdk.connect(clientTransport);
  try {
    const { tools } = await clientSdk.listTools();
    const briefTool = tools.find(t => t.name === 'get_client_account_manager_brief');
    assert.equal(briefTool.annotations.readOnlyHint, true);
    assert.equal(briefTool.inputSchema.properties.clientId.type, 'string');
    const result = await clientSdk.callTool({ name: briefTool.name, arguments: { clientId: client.id } });
    assert.equal(result.isError, undefined); assert.equal(result.structuredContent.output.total, 1);
    const plugins = await clientSdk.callTool({ name: 'list_account_manager_plugins', arguments: {} });
    assert.equal(plugins.structuredContent.output.plugins[0].id, 'client-work');
    const profile = await clientSdk.callTool({ name: 'get_client_agent_profile', arguments: { clientId: client.id } });
    assert.equal(profile.structuredContent.output.revision, 0);
    assert.equal(profile.structuredContent.output.portalEnabled, false);
    assert.equal(service.list({ ...ctx, scopes: ['workspace:actions'] }).some(t => t.name === briefTool.name), false);
    assert.equal(service.list({ ...ctx, user: { ...user, role: 'BOT' } }).length, 0);
  } finally { await clientSdk.close(); await server.close(); }
});

test('HTTP brief shares the same service contract and rejects unknown query fields', async t => {
  const { prisma } = fixture({ tasks: [task()] });
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = user; request.prisma = prisma; });
  await app.register(clientAssistantRoutes, { prefix: '/api/client-assistants', chat: () => { throw new Error('Unexpected model call'); } });
  t.after(() => app.close());
  const response = await app.inject('/api/client-assistants/client-a/brief?limit=1');
  assert.equal(response.statusCode, 200); assert.equal(response.json().total, 1);
  assert.equal(response.json().context.client.id, client.id);
  assert.equal((await app.inject('/api/client-assistants/client-a/brief?organizationId=org-b')).statusCode, 400);
  assert.equal((await app.inject('/api/client-assistants/client-a/brief?limit=51')).statusCode, 400);
});

test('HTTP brief refuses client and bot principals before querying', async t => {
  for (const role of ['CLIENT', 'BOT']) {
    const { prisma, reads } = fixture();
    const app = Fastify();
    app.decorate('authenticate', async request => { request.user = { ...user, role }; request.prisma = prisma; });
    await app.register(clientAssistantRoutes, { prefix: '/api/client-assistants' });
    t.after(() => app.close());
    assert.equal((await app.inject('/api/client-assistants/client-a/brief')).statusCode, 403);
    assert.equal(reads.length, 0);
  }
});
