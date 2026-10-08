import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';
import workspaceApiRoutes from '../../routes/workspace-api.routes.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';

const ctx = (scopes = ['workspace:read']) => ({
  user: { id: 'user-1', role: 'TEAM', organizationId: 'org-1' }, scopes,
  prisma: { project: { findMany: async () => [] } },
});

test('workspace catalog grants no implicit access to legacy keys or clients', () => {
  const service = createWorkspaceTools();
  assert.equal(service.list(ctx(['ai_bridge:read', 'ai_bridge:actions'])).length, 0);
  assert.equal(service.list({ ...ctx(), user: { role: 'CLIENT', organizationId: 'org-1' } }).length, 0);
  assert.equal(service.list({ ...ctx(), user: { role: 'TEAM' } }).length, 0);
  const reads = service.list(ctx());
  assert.ok(reads.length >= 5);
  assert.ok(reads.every(tool => tool.annotations.readOnlyHint));
  assert.ok(reads.every(tool => tool.inputSchema.type === 'object'));
  assert.ok(!reads.some(tool => tool.name === 'get_ai_usage_summary'));
});

test('paginated reads explicitly scope tenant, bound page and redact secrets without model inference', async () => {
  const previous = process.env.AI_DISABLED;
  process.env.AI_DISABLED = 'true';
  try {
    const context = ctx();
    let query;
    context.prisma.project.findMany = async args => { query = args; return [
      { id: 'b', name: 'Project', apiKey: 'hidden' }, { id: 'c', name: 'Next' },
    ]; };
    const result = await createWorkspaceTools().call(context, 'list_projects', { limit: 1, after: 'a' });
    assert.deepEqual(query.where, { organizationId: 'org-1', id: { gt: 'a' } });
    assert.equal(query.take, 2);
    assert.deepEqual(query.orderBy, { id: 'asc' });
    assert.deepEqual(result.output, { items: [{ id: 'b', name: 'Project' }], nextCursor: 'b' });
    await assert.rejects(createWorkspaceTools().call(context, 'list_projects', { limit: 51 }), { code: 'INVALID_INPUT' });
  } finally {
    if (previous === undefined) delete process.env.AI_DISABLED; else process.env.AI_DISABLED = previous;
  }
});

test('action inputs need explicit scope, strict envelope and idempotency', async () => {
  const service = createWorkspaceTools();
  await assert.rejects(service.call(ctx(), 'create_task', {}), { code: 'TOOL_UNAVAILABLE' });
  await assert.rejects(service.call(ctx(['workspace:actions']), 'create_task', { input: {} }), { code: 'INVALID_INPUT' });
  await assert.rejects(service.call(ctx(['workspace:actions']), 'create_task', { input: {}, idempotencyKey: 'valid-key', extra: true }), { code: 'INVALID_INPUT' });
  assert.ok(!service.list(ctx(['workspace:actions'])).some(tool => tool.name === 'list_clients'));
  assert.ok(!service.list(ctx(['workspace:actions'])).some(tool => tool.name === 'send_slack_message'));
});

test('confirm enforces action ownership and keeps receipt inputs private', async () => {
  const context = ctx(['workspace:actions']);
  let lookup;
  let approval;
  const action = { id: 'action-1', action: 'create_task', source: 'ai_bridge', status: 'EXECUTED',
    input: { private: 'never returned' }, preview: { title: 'Safe', secret: 'hidden' }, result: { taskId: 'task-1' } };
  context.prisma.aiBridgeAction = { findFirst: async args => { lookup = args; return action; } };
  const service = createWorkspaceTools({ executor: {
    approve: async (_ctx, _id, options) => { approval = options; return { action, idempotent: true }; },
  } });
  const result = await service.call(context, 'confirm_action', { actionId: 'action-1' });
  assert.deepEqual(lookup.where, { id: 'action-1', userId: 'user-1', organizationId: 'org-1' });
  assert.deepEqual(approval, { method: 'api_key_confirm', ownerOnly: true });
  assert.equal(result.action.input, undefined);
  assert.equal(result.action.preview.secret, undefined);
  assert.equal(result.idempotent, true);
  context.prisma.aiBridgeAction.findFirst = async () => null;
  await assert.rejects(service.call(context, 'confirm_action', { actionId: 'foreign' }), { code: 'NOT_FOUND' });
  context.prisma.aiBridgeAction.findFirst = async () => ({ ...action, source: 'assistant' });
  await assert.rejects(service.call(context, 'confirm_action', { actionId: 'assistant' }), { code: 'NOT_FOUND' });
});

test('real SDK handshake, discovery, structured results and tool errors', async () => {
  const context = ctx();
  const service = createWorkspaceTools();
  const server = createWorkspaceMcp(service, context);
  const client = new Client({ name: 'test-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools, service.list(context));
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(result.structuredContent.kind, 'result');
    assert.deepEqual(result.structuredContent.output, { items: [], nextCursor: null });
    const refused = await client.callTool({ name: 'create_task', arguments: {} });
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.error.code, 'TOOL_UNAVAILABLE');
  } finally { await client.close(); await server.close(); }
});

test('real executor prepares without mutation, confirms once, audits and refuses foreign records', async () => {
  const db = seedTwoOrganizations(createFakeToolDb());
  const context = { ...ctx(['workspace:read', 'workspace:actions']), prisma: db,
    user: { id: 'team-a', role: 'TEAM', organizationId: 'org-a' } };
  const service = createWorkspaceTools();
  const args = { input: { projectId: 'project-a', title: 'Review homepage' }, idempotencyKey: 'homepage-review-1' };
  const prepared = await service.call(context, 'create_task', args);
  assert.equal(prepared.kind, 'pending');
  assert.equal(prepared.action.status, 'PENDING_CONFIRMATION');
  assert.equal(db.tables.task.length, 2);
  assert.equal((await service.call(context, 'create_task', args)).action.id, prepared.action.id);
  const actionId = prepared.action.id;
  const completed = await service.call(context, 'confirm_action', { actionId });
  assert.equal(completed.action.status, 'EXECUTED');
  assert.equal(db.tables.task.length, 3);
  assert.equal((await service.call(context, 'confirm_action', { actionId })).idempotent, true);
  assert.equal(db.tables.task.length, 3);
  assert.ok(db.tables.auditEvent.some(event => event.action === 'ai.tool_executed'));
  await assert.rejects(service.call(context, 'create_task', { ...args, input: { ...args.input, title: 'Different' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.call(context, 'create_task', { input: { projectId: 'project-b', title: 'Foreign' }, idempotencyKey: 'foreign-project-1' }), { code: 'RECORD_NOT_FOUND' });
  const outsider = { ...context, user: { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b' } };
  await assert.rejects(service.call(outsider, 'get_action', { actionId }), { code: 'NOT_FOUND' });
});

test('rejection uses API-key audit evidence and never creates an event', async () => {
  const db = seedTwoOrganizations(createFakeToolDb());
  const context = { ...ctx(['workspace:actions']), prisma: db,
    user: { id: 'team-a', role: 'TEAM', organizationId: 'org-a' } };
  const service = createWorkspaceTools();
  const prepared = await service.call(context, 'create_calendar_event', {
    input: { projectId: 'project-a', title: 'Kickoff', startTime: '2026-10-12T10:00:00Z', endTime: '2026-10-12T11:00:00Z' },
    idempotencyKey: 'calendar-kickoff-1',
  });
  const result = await service.call(context, 'reject_action', { actionId: prepared.action.id });
  assert.equal(result.action.status, 'REJECTED');
  assert.equal(db.tables.calendarEvent.length, 0);
  assert.equal(db.tables.aiBridgeAction[0].approvalEvidence.method, 'api_key_confirm');
  await assert.rejects(service.call(context, 'confirm_action', { actionId: prepared.action.id }), { code: 'ACTION_UNAVAILABLE' });
});

test('HTTP API and stateless MCP share tools and reject anonymous or cross-origin access', async () => {
  const app = Fastify();
  const context = ctx();
  app.decorate('authenticateWithApiKey', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer test-key') return reply.code(401).send({ error: 'Unauthorized' });
    request.user = context.user; request.prisma = context.prisma; request.apiKeyScopes = context.scopes;
  });
  await app.register(workspaceApiRoutes, { prefix: '/api' });
  const headers = { authorization: 'Bearer test-key', accept: 'application/json, text/event-stream' };
  try {
    assert.equal((await app.inject('/api/agent/tools')).statusCode, 401);
    const catalog = await app.inject({ url: '/api/agent/tools', headers });
    assert.equal(catalog.statusCode, 200);
    assert.ok(catalog.json().tools.some(tool => tool.name === 'list_projects'));
    const read = await app.inject({ method: 'POST', url: '/api/agent/tools/list_projects', headers, payload: {} });
    assert.equal(read.json().data.kind, 'result');
    const rpc = await app.inject({ method: 'POST', url: '/api/mcp', headers, payload: {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    } });
    assert.equal(rpc.statusCode, 200, rpc.body);
    assert.equal(rpc.json().result.serverInfo.name, 'ashbi-workspace');
    const tools = await app.inject({ method: 'POST', url: '/api/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    assert.deepEqual(tools.json().result.tools, catalog.json().tools);
    assert.equal((await app.inject({ method: 'GET', url: '/api/mcp', headers })).statusCode, 405);
    assert.equal((await app.inject({ method: 'POST', url: '/api/mcp', headers: { ...headers, origin: 'https://untrusted.invalid' }, payload: {} })).statusCode, 403);
  } finally { await app.close(); }
});

test('stdio adapter connects to authenticated stateless HTTP and forwards tool calls', async () => {
  const app = Fastify();
  const context = ctx();
  const apiKey = 'ashbi_unit_test_only';
  app.decorate('authenticateWithApiKey', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${apiKey}`) return reply.code(401).send({ error: 'Unauthorized' });
    request.user = context.user; request.prisma = context.prisma; request.apiKeyScopes = context.scopes;
  });
  await app.register(workspaceApiRoutes, { prefix: '/api' });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../../../scripts/workspace-mcp.mjs', import.meta.url))],
    env: { ASHBI_MCP_URL: `${address}/api/mcp`, ASHBI_API_KEY: apiKey }, stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'list_projects'));
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.deepEqual(result.structuredContent.output, { items: [], nextCursor: null });
  } finally { await client.close(); await app.close(); }
});
