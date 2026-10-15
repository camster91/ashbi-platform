import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import routes from '../../routes/client-communications.routes.js';
import { listClientCommunications, readClientCommunication } from '../../services/client-communications.service.js';
import { ToolError } from '../../ai/tools/registry.js';
import { TenancyError } from '../../utils/prisma-tenant-proxy.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';

const actor = { id: 'u', organizationId: 'org', role: 'ADMIN', isActive: true };
const client = { id: 'c', organizationId: 'org', deletedAt: null };
const project = { id: 'p', clientId: 'c', organizationId: 'org', deletedAt: null, client: { ...client } };
const at = new Date('2026-10-14T12:00:00.000Z');
function matches(row, where = {}) {
  if (!row) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'AND') return (Array.isArray(expected) ? expected : [expected]).every(value => matches(row, value));
    if (key === 'OR') return expected.some(value => matches(row, value));
    if (expected instanceof Date) return +row[key] === +expected;
    if (expected && typeof expected === 'object') {
      if ('lt' in expected) return row[key] < expected.lt;
      return matches(row[key], expected);
    }
    return row[key] === expected || (expected === null && row[key] == null);
  });
}
function fixture() {
  const state = { actor: { ...actor }, client: { ...client }, inbox: [], project: [] };
  const reads = [];
  const db = {
    user: { findFirst: async ({ where }) => matches(state.actor, where) ? state.actor : null },
    client: { findFirst: async ({ where }) => matches(state.client, where) ? state.client : null },
  };
  for (const [delegate, source] of [['message', 'inbox'], ['projectCommunication', 'project']]) {
    db[delegate] = {
      findMany: async args => {
        reads.push({ delegate, args });
        const rows = state[source].filter(row => matches(row, args.where));
        rows.sort((a, b) => +b.receivedAt - +a.receivedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        return rows.slice(0, args.take);
      },
      findFirst: async args => { reads.push({ delegate, args }); return state[source].find(row => matches(row, args.where)) ?? null; },
    };
  }
  function inbox(id, overrides = {}) {
    const row = { id, subject: 'Inbox subject', senderEmail: 'client@example.test', direction: 'INBOUND', bodyText: 'Stored plain message', bodyHtml: 'PRIVATE HTML', headers: 'PRIVATE HEADER', aiExtracted: 'PRIVATE AI', receivedAt: at, threadId: `t-${id}`, thread: { id: `t-${id}`, clientId: 'c', client: { ...client }, projectId: null, project: null, assignedToId: 'u' }, ...overrides };
    state.inbox.push(row); return row;
  }
  function email(id, overrides = {}) {
    const row = { id, subject: 'Project subject', from: 'client@example.test', to: 'PRIVATE RECIPIENT', account: 'PRIVATE ACCOUNT', direction: 'OUTBOUND', bodySnippet: 'Stored snippet', fullBody: 'Stored full project message', receivedAt: at, projectId: 'p', project: { ...project }, ...overrides };
    state.project.push(row); return row;
  }
  return { db, state, reads, inbox, email };
}
test('merges both stored sources with safe bounded projections and no writes/provider calls', async () => {
  const f = fixture(); f.inbox('i'); f.email('e');
  const result = await listClientCommunications(f.db, actor, 'c');
  assert.deepEqual(result.items.map(item => item.source), ['inbox', 'project']);
  assert.equal(result.coverage.kind, 'stored-history'); assert.equal(result.coverage.complete, false); assert.equal(result.coverage.exclusions.length, 1);
  assert.deepEqual(result.warnings, []); assert.equal(result.nextCursor, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|fullBody|bodyText|aiExtracted|bodyHtml|account/);
  assert.ok(f.reads.every(read => read.args.take === 21));
  assert.ok(!f.reads[1].args.select.fullBody);
});
test('stable equal-date cursor traverses both sources exactly once including colliding IDs', async () => {
  const f = fixture(); ['z', 'm', 'a'].forEach(id => { f.inbox(id); f.email(id); });
  const observed = []; let after;
  do { const page = await listClientCommunications(f.db, actor, 'c', { limit: 2, ...(after ? { after } : {}) }); observed.push(...page.items.map(row => `${row.source}:${row.id}`)); after = page.nextCursor; } while (after);
  assert.deepEqual(observed, ['inbox:z', 'inbox:m', 'inbox:a', 'project:z', 'project:m', 'project:a']);
});
test('TEAM inbox list and detail are assignment restricted while canonical project history remains shared', async () => {
  const f = fixture(); f.state.actor.role = 'TEAM'; f.inbox('assigned'); const other = f.inbox('other'); other.thread.assignedToId = 'another'; f.email('p');
  const result = await listClientCommunications(f.db, { ...actor, role: 'TEAM' }, 'c');
  assert.deepEqual(result.items.map(row => row.id), ['assigned', 'p']);
  await assert.rejects(readClientCommunication(f.db, { ...actor, role: 'TEAM' }, 'c', 'inbox', 'other'), { code: 'RECORD_NOT_FOUND' });
});
test('project-only inbox coverage is explicitly excluded; conflicting and reassigned links excluded', async () => {
  const f = fixture();
  const only = f.inbox('only'); Object.assign(only.thread, { clientId: null, client: null, projectId: 'p', project: { ...project } });
  const conflict = f.inbox('conflict'); Object.assign(conflict.thread, { clientId: 'other', client: { ...client, id: 'other' }, projectId: 'p', project: { ...project } });
  const moved = f.inbox('moved'); Object.assign(moved.thread, { projectId: 'p', project: { ...project, clientId: 'other' } });
  f.email('old-project', { project: { ...project, clientId: 'other' } });
  const result = await listClientCommunications(f.db, actor, 'c');
  assert.deepEqual(result.items, []); assert.match(result.coverage.exclusions[0], /Project-only inbox/);
  await assert.rejects(readClientCommunication(f.db, actor, 'c', 'inbox', 'only'), { code: 'RECORD_NOT_FOUND' });
});
test('fresh stored roles, organization and deleted canonical client deny before sources', async () => {
  for (const change of [{ role: 'CLIENT' }, { role: 'BOT' }, { organizationId: 'other' }, { isActive: false }]) {
    const f = fixture(); Object.assign(f.state.actor, change);
    await assert.rejects(listClientCommunications(f.db, actor, 'c'), { code: 'ROLE_DENIED' }); assert.equal(f.reads.length, 0);
  }
  for (const change of [{ organizationId: 'other' }, { deletedAt: new Date() }]) {
    const f = fixture(); Object.assign(f.state.client, change);
    await assert.rejects(listClientCommunications(f.db, actor, 'c'), { code: 'RECORD_NOT_FOUND' }); assert.equal(f.reads.length, 0);
  }
});
test('single operational source failure returns honest partial history without advancing cursor', async () => {
  const f = fixture(); ['a', 'b'].forEach(id => f.email(id));
  f.db.message.findMany = async () => { throw Error('password=private provider error'); };
  const result = await listClientCommunications(f.db, actor, 'c', { limit: 1 });
  assert.equal(result.items.length, 1); assert.equal(result.nextCursor, null); assert.equal(result.warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /password|private provider/);
  f.db.projectCommunication.findMany = async () => { throw Error('down'); };
  await assert.rejects(listClientCommunications(f.db, actor, 'c'), { code: 'COMMUNICATIONS_UNAVAILABLE' });
});
test('authorization, tenancy failures and corrupt out-of-scope query rows cannot become partial success', async () => {
  for (const error of [new ToolError('ROLE_DENIED', 'safe', { statusCode: 403 }), new TenancyError('private tenant guard'), Object.assign(Error('private authorization'), { statusCode: 403 })]) {
    const f = fixture(); f.email('e'); f.db.message.findMany = async () => { throw error; };
    await assert.rejects(listClientCommunications(f.db, actor, 'c'), actual => actual === error);
  }
  const f = fixture(); const row = f.inbox('foreign'); row.thread.client.organizationId = 'other';
  f.db.message.findMany = async () => [row];
  await assert.rejects(listClientCommunications(f.db, actor, 'c'), { code: 'COMMUNICATION_SCOPE_INVALID' });
});
test('detail alone returns plain body and explicit truncation; no provider metadata', async () => {
  const f = fixture(); f.email('e', { fullBody: 'x'.repeat(50001) }); f.inbox('i');
  const detail = await readClientCommunication(f.db, actor, 'c', 'project', 'e');
  assert.equal(detail.bodyText.length, 50000); assert.equal(detail.bodyTruncated, true);
  assert.equal((await readClientCommunication(f.db, actor, 'c', 'inbox', 'i')).bodyTruncated, false);
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE|account|fullBody|aiExtracted/);
  await assert.rejects(readClientCommunication(f.db, actor, 'c', 'project', 'missing'), { statusCode: 404 });
});
test('strict bounded list, detail and cursor inputs rejected before source queries', async () => {
  const f = fixture();
  for (const input of [{ limit: 0 }, { limit: 51 }, { after: 'invalid' }, { after: Buffer.from(JSON.stringify({ v: 1, t: at.toISOString(), s: 'foreign', i: 'a' })).toString('base64url') }, { full: true }]) await assert.rejects(listClientCommunications(f.db, actor, 'c', input), { code: 'INVALID_INPUT' });
  await assert.rejects(readClientCommunication(f.db, actor, 'c', 'other', 'a'), { code: 'INVALID_INPUT' });
  assert.equal(f.reads.length, 0);
});
test('HTTP routes are GET-only, validate query and redact database failures', async t => {
  const f = fixture(); const app = Fastify();
  app.decorate('authenticate', async r => { r.user = actor; r.prisma = f.db; });
  await app.register(routes, { prefix: '/api/client-communications' }); await app.ready(); t.after(() => app.close());
  assert.equal((await app.inject('/api/client-communications/c?limit=51')).statusCode, 400);
  assert.equal((await app.inject('/api/client-communications/c/project/a?full=true')).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/client-communications/c', payload: {} })).statusCode, 404);
  f.db.client.findFirst = async () => { throw Error('password=private'); };
  const failure = await app.inject('/api/client-communications/c'); assert.equal(failure.statusCode, 503); assert.doesNotMatch(failure.body, /password|private/);
});

test('real MCP discovery and detail reads use the same stored communication boundary', async () => {
  const f = fixture(); f.inbox('mcp-record');
  const tools = createWorkspaceTools();
  const ctx = { user: actor, prisma: f.db, scopes: ['workspace:read'], oauthEnabled: true };
  const server = createWorkspaceMcp(tools, ctx);
  const clientSdk = new Client({ name: 'communication-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await clientSdk.connect(clientTransport);
  try {
    const catalog = await clientSdk.listTools();
    assert.equal(catalog.tools.find(t => t.name === 'list_client_communications').annotations.readOnlyHint, true);
    const list = await clientSdk.callTool({ name: 'list_client_communications', arguments: { clientId: 'c' } });
    assert.equal(list.structuredContent.output.items[0].id, 'mcp-record');
    assert.equal(list.structuredContent.output.coverage.complete, false);
    const detail = await clientSdk.callTool({ name: 'get_client_communication', arguments: { clientId: 'c', source: 'inbox', messageId: 'mcp-record' } });
    assert.equal(detail.structuredContent.output.bodyText, 'Stored plain message');
    assert.equal(tools.list({ ...ctx, scopes: ['workspace:actions'] }).some(t => t.name === 'list_client_communications'), false);
    f.state.actor.role = 'CLIENT';
    const denied = await clientSdk.callTool({ name: 'list_client_communications', arguments: { clientId: 'c' } });
    assert.equal(denied.isError, true);
    assert.doesNotMatch(JSON.stringify(denied), /Stored plain message/);
  } finally { await clientSdk.close(); await server.close(); }
});
