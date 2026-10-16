import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_LINK_TOOLS } from '../../integrations/resource-link-tools.js';

test('resource tools expose read previews and only confirmed idempotent transactional writes', () => {
  assert.equal(RESOURCE_LINK_TOOLS.length, 12);
  for (const name of ['create_resource_link','update_resource_link','archive_resource_link','restore_resource_link','reorder_resource_links']) {
    const tool = RESOURCE_LINK_TOOLS.find(tool => tool.name === name);
    assert.ok(tool);
    assert.equal(tool.requiresConfirmation, true);
    assert.equal(tool.idempotency, 'required');
    assert.equal(tool.execution.mode, 'transaction');
    assert.equal(tool.execution.isolationLevel, 'Serializable');
    assert.deepEqual(tool.roles, ['ADMIN','TEAM']);
    assert.ok(RESOURCE_LINK_TOOLS.find(tool => tool.name === `preview_${name}`));
  }
});

import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';

test('current discovery and calls refuse revoked staff claims without exposing resource tools', async () => {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(user => { user.isActive = true; });
  const user = structuredClone(db.tables.user.find(user => user.id === 'team-a'));
  const ctx = { prisma: db, user, scopes: ['workspace:read', 'workspace:actions'] };
  const tools = createWorkspaceTools();
  assert.ok((await tools.listCurrent(ctx)).some(tool => tool.name === 'list_resource_links'));
  for (const change of [{ role: 'CLIENT' }, { role: 'TEAM', isActive: false }, { role: 'TEAM', isActive: true, organizationId: 'org-b' }]) {
    Object.assign(db.tables.user.find(row => row.id === user.id), change);
    assert.equal((await tools.listCurrent(ctx)).some(tool => RESOURCE_LINK_TOOLS.some(resource => resource.name === tool.name)), false);
    await assert.rejects(tools.call(ctx, 'list_resource_links', { entityType: 'PROJECT', entityId: 'project-a' }), { code: 'ROLE_DENIED' });
  }
  assert.equal(db.tables.aiBridgeAction.length, 0);
});

test('client claims and read-only API scopes cannot prepare resource writes', async () => {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(user => { user.isActive = true; });
  const user = structuredClone(db.tables.user.find(user => user.id === 'team-a'));
  const tools = createWorkspaceTools();
  const ctx = { prisma: db, user, scopes: ['workspace:read'] };
  assert.equal(tools.list(ctx).some(tool => tool.name === 'create_resource_link'), false);
  await assert.rejects(tools.call(ctx, 'create_resource_link', {}), { code: 'TOOL_UNAVAILABLE' });
  await assert.rejects(tools.call({ ...ctx, user: { ...user, role: 'CLIENT' } }, 'list_resource_links', {}), { code: 'TOOL_UNAVAILABLE' });
  assert.equal(db.tables.aiBridgeAction.length, 0);
});

import { randomUUID } from 'node:crypto';
import { createResourceLinkFakeDb } from '../helpers/resource-links-fake.js';

function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(user => { user.isActive = true; });
  const resource = createResourceLinkFakeDb({ users: db.tables.user, projects: db.tables.project, tasks: db.tables.task });
  const toolTransaction = db.$transaction;
  db.resourceLink = resource.resourceLink;
  db.$queryRaw = resource.$queryRaw;
  db.project = resource.project;
  db.task = resource.task;
  db.$transaction = (work, options) => toolTransaction(() => resource.$transaction(() => work(db)), options);
  const auditCreate = db.auditEvent.create;
  db.auditEvent.create = async args => {
    const result = await auditCreate(args);
    if (args.data.action.startsWith('resource_link.')) resource.state.audit.push(structuredClone(args.data));
    return result;
  };
  const user = structuredClone(db.tables.user.find(user => user.id === 'team-a'));
  const ctx = { prisma: db, user, scopes: ['workspace:read', 'workspace:actions'] };
  return { db, resource, ctx, tools: createWorkspaceTools() };
}
const source = { system: 'FluentBoards', recordId: '158', originalTitle: 'Drive references', originalUrl: 'https://example.test/design?x=1&x=2#source', originalCreatedAt: '2025-01-01 12:30:00', originalPosition: 0 };
const createInput = fields => ({ entityType: 'PROJECT', entityId: 'project-a', title: 'Drive references', url: source.originalUrl, source: structuredClone(source), createIntentId: randomUUID(), ...fields });
async function prepare(f, name, input, key = randomUUID()) {
  const preview = (await f.tools.call(f.ctx, `preview_${name}`, input)).output;
  const pending = await f.tools.call(f.ctx, name, { input: { ...input, fingerprint: preview.fingerprint }, idempotencyKey: key });
  return { ...pending, preview, input: { ...input, fingerprint: preview.fingerprint }, key };
}
async function confirm(f, pending) { return (await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).action.result; }

test('resource preview, confirmation, receipt recovery, duplicate URLs and source identity require zero outbound calls', async t => {
  const f = fixture(); let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => { fetches++; throw new Error('Unexpected outbound fetch'); });
  const input = createInput();
  const pending = await prepare(f, 'create_resource_link', input);
  assert.equal(pending.preview.url, input.url);
  assert.deepEqual(pending.preview.source, source);
  assert.equal(f.resource.state.rows.length, 0);
  const first = await confirm(f, pending);
  assert.equal(first.clientVisible, false); assert.equal(first.url, input.url); assert.deepEqual(first.source, source);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id })).action.status, 'EXECUTED');
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
  assert.equal((await f.tools.call(f.ctx, 'create_resource_link', { input: pending.input, idempotencyKey: pending.key })).idempotent, true);
  assert.equal(f.resource.state.rows.length, 1);
  assert.equal(f.resource.state.audit.length, 1);
  const second = await confirm(f, await prepare(f, 'create_resource_link', createInput({ source: { ...source, recordId: '159' } })));
  assert.notEqual(first.id, second.id); assert.equal(first.url, second.url);
  assert.equal((await f.tools.call(f.ctx, 'list_resource_links', { entityType: 'PROJECT', entityId: 'project-a', limit: 1 })).output.items.length, 1);
  assert.deepEqual((await f.tools.call(f.ctx, 'get_resource_link', { id: first.id })).output.source, source);
  await assert.rejects(prepare(f, 'update_resource_link', { id: first.id, expectedRevision: 1, source: { ...source, recordId: 'evil' } }), { code: 'INVALID_INPUT' });
  assert.equal(fetches, 0);
});

test('missing or wrong fingerprint and missing idempotency refuse preparation without a domain write', async () => {
  const f = fixture(), input = createInput();
  await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input, idempotencyKey: 'missing-fingerprint' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input: { ...input, fingerprint: '0'.repeat(64) }, idempotencyKey: 'wrong-fingerprint' }), { code: 'TARGET_UNAVAILABLE' });
  await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input: { ...input, fingerprint: '0'.repeat(64) } }), { code: 'INVALID_INPUT' });
  assert.equal(f.resource.state.rows.length, 0); assert.equal(f.db.tables.aiBridgeAction.length, 0);
});

test('current role, foreign parent, creator ownership and receipt ownership prevent resource access', async () => {
  const f = fixture();
  await assert.rejects(prepare(f, 'create_resource_link', createInput({ entityId: 'project-b' })), { code: 'RECORD_NOT_FOUND' });
  await assert.rejects(prepare(f, 'create_resource_link', createInput({ entityType: 'TASK', entityId: 'task-b' })), { code: 'RECORD_NOT_FOUND' });
  const pending = await prepare(f, 'create_resource_link', createInput()); const first = await confirm(f, pending);
  const other = { ...f.ctx, user: { ...f.ctx.user, id: 'team2-a' } };
  await assert.rejects(f.tools.call(other, 'preview_update_resource_link', { id: first.id, expectedRevision: 1, title: 'Other edit' }), { code: 'ROLE_DENIED' });
  await assert.rejects(f.tools.call(other, 'get_action', { actionId: pending.action.id }), { code: 'NOT_FOUND' });
  const foreign = { ...f.ctx, user: { ...f.ctx.user, id: 'team-b', organizationId: 'org-b' } };
  await assert.rejects(f.tools.call(foreign, 'get_resource_link', { id: first.id }), { code: 'RECORD_NOT_FOUND' });
  f.db.tables.user.find(user => user.id === f.ctx.user.id).isActive = false;
  for (const name of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, name, { actionId: pending.action.id }), { code: 'ROLE_DENIED' });
});

test('resource updates, archive and restore preserve immutable provenance and require current CAS', async () => {
  const f = fixture(); let row = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  row = await confirm(f, await prepare(f, 'update_resource_link', { id: row.id, expectedRevision: 1, title: 'New title', clientVisible: true }));
  assert.equal(row.title, 'New title'); assert.equal(row.clientVisible, true); assert.deepEqual(row.source, source);
  await assert.rejects(prepare(f, 'update_resource_link', { id: row.id, expectedRevision: 1, title: 'Stale' }), { code: 'TARGET_UNAVAILABLE' });
  row = await confirm(f, await prepare(f, 'archive_resource_link', { id: row.id, expectedRevision: 2 }));
  assert.ok(row.archivedAt);
  assert.equal((await f.tools.call(f.ctx, 'list_resource_links', { entityType: 'PROJECT', entityId: 'project-a' })).output.items.length, 0);
  assert.equal((await f.tools.call(f.ctx, 'list_resource_links', { entityType: 'PROJECT', entityId: 'project-a', includeArchived: true })).output.items.length, 1);
  row = await confirm(f, await prepare(f, 'restore_resource_link', { id: row.id, expectedRevision: 3 }));
  assert.equal(row.archivedAt, null); assert.equal(row.revision, 4); assert.deepEqual(row.source, source);
});

test('reorder previews bind full membership and reject an intervening addition or revision change', async () => {
  const f = fixture();
  const a = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  const b = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  const input = { entityType: 'PROJECT', entityId: 'project-a', ordered: [{ id: b.id, expectedRevision: 1 }, { id: a.id, expectedRevision: 1 }] };
  await assert.rejects(prepare(f, 'reorder_resource_links', { ...input, ordered: input.ordered.slice(0, 1) }), { code: 'TARGET_UNAVAILABLE' });
  const reorder = await prepare(f, 'reorder_resource_links', input);
  await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  await assert.rejects(confirm(f, reorder), { code: 'EXECUTION_FAILED', statusCode: 409 });
  assert.deepEqual(f.resource.state.rows.map(row => row.position), [0, 1, 2]);
  const current = f.resource.state.rows.map(row => ({ id: row.id, expectedRevision: row.revision }));
  const valid = await prepare(f, 'reorder_resource_links', { ...input, ordered: [...current].reverse() });
  const result = await confirm(f, valid);
  assert.deepEqual(result.items.map(row => row.id), current.map(row => row.id).reverse());
});

test('transaction rechecks staff role and parent, while rejected actions never write', async () => {
  for (const change of ['role', 'parent']) {
    const f = fixture(), pending = await prepare(f, 'create_resource_link', createInput());
    if (change === 'role') {
      const original = f.db.$transaction;
      f.db.$transaction = (work, options) => { f.db.tables.user.find(user => user.id === f.ctx.user.id).role = 'CLIENT'; return original(work, options); };
    } else f.resource.state.projects.find(project => project.id === 'project-a').deletedAt = new Date();
    await assert.rejects(confirm(f, pending), error => error.code === 'EXECUTION_FAILED' && !error.action);
    assert.equal(f.resource.state.rows.length, 0);
  }
  const f = fixture(), pending = await prepare(f, 'create_resource_link', createInput());
  assert.equal((await f.tools.call(f.ctx, 'reject_action', { actionId: pending.action.id })).action.status, 'REJECTED');
  await assert.rejects(confirm(f, pending), { code: 'ACTION_UNAVAILABLE' });
  assert.equal(f.resource.state.rows.length, 0);
});

function oauthFixture(scopes = ['workspace:resource-links:write']) {
  const f = fixture();
  f.db.tables.user.forEach(user => { user.sessionVersion = 1; });
  f.ctx.user = structuredClone(f.db.tables.user.find(user => user.id === 'admin-a'));
  f.key = { id: 'resource-oauth-key', userId: 'admin-a', isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 3600000), scopes: ['workspace:read', ...scopes] };
  f.db.apiKey = { findUnique: async ({ where }) => where.id === f.key.id ? structuredClone(f.key) : null };
  f.ctx.scopes = [...f.key.scopes];
  f.ctx.oauth = { keyId: f.key.id, clientId: 'https://chatgpt.com/oauth/client.json', sessionVersion: 1, scopes: [...f.key.scopes], expiresAt: Date.now() + 3600000 };
  return f;
}

test('OAuth resource writes require the new opt-in scope and still wait for explicit confirmation', async () => {
  for (const scopes of [[], ['workspace:client-tasks:write'], ['workspace:service-reports:publish']]) {
    const f = oauthFixture(scopes);
    assert.equal((await f.tools.listCurrent(f.ctx)).some(tool => tool.name === 'create_resource_link'), false);
    assert.ok((await f.tools.listCurrent(f.ctx)).some(tool => tool.name === 'preview_create_resource_link'));
    await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input: createInput(), idempotencyKey: 'read-only-resource' }), { code: 'TOOL_UNAVAILABLE' });
  }
  const f = oauthFixture();
  assert.ok((await f.tools.listCurrent(f.ctx)).some(tool => tool.name === 'create_resource_link'));
  const pending = await prepare(f, 'create_resource_link', createInput());
  assert.equal(f.resource.state.rows.length, 0);
  const row = await confirm(f, pending);
  assert.equal(row.url, source.originalUrl);
  assert.equal(f.db.tables.aiBridgeAction[0].approvalEvidence.method, 'oauth_confirm');
  assert.equal(f.db.tables.aiBridgeAction[0].approvalEvidence.reauthenticated, false);
  assert.equal(f.db.tables.aiBridgeAction[0].authorizationBinding.requiredScope, 'workspace:resource-links:write');
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: pending.action.id })).idempotent, true);
});

test('OAuth revoked grant, scope reduction, role demotion and session changes deny pending and executed receipts', async () => {
  const changes = [f => { f.key.isActive = false; }, f => { f.key.scopes = ['workspace:read']; }, f => { f.key.revokedAt = new Date(); },
    f => { f.db.tables.user.find(user => user.id === f.ctx.user.id).role = 'TEAM'; }, f => { f.db.tables.user.find(user => user.id === f.ctx.user.id).sessionVersion++; }];
  for (const completed of [false, true]) for (const change of changes) {
    const f = oauthFixture(), pending = await prepare(f, 'create_resource_link', createInput());
    if (completed) await confirm(f, pending);
    change(f);
    assert.equal((await f.tools.listCurrent(f.ctx)).some(tool => tool.name === 'create_resource_link'), false);
    for (const name of ['get_action', 'confirm_action', 'reject_action']) await assert.rejects(f.tools.call(f.ctx, name, { actionId: pending.action.id }));
    await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input: pending.input, idempotencyKey: pending.key }));
    assert.equal(f.resource.state.rows.length, completed ? 1 : 0);
  }
});

test('OAuth grant revocation inside transaction rolls back execution and keeps the proposal pending', async () => {
  const f = oauthFixture(), pending = await prepare(f, 'create_resource_link', createInput());
  const before = structuredClone(f.db.tables.aiBridgeAction[0]), original = f.db.$transaction;
  f.db.$transaction = (work, options) => { f.key.isActive = false; return original(work, options); };
  await assert.rejects(confirm(f, pending), { code: 'NOT_FOUND' });
  assert.deepEqual(f.db.tables.aiBridgeAction[0], before);
  assert.equal(f.resource.state.rows.length, 0);
});

test('required audit failure rolls back reference write and leaves a failed execution receipt', async () => {
  const f = fixture(), pending = await prepare(f, 'create_resource_link', createInput());
  const original = f.db.auditEvent.create;
  f.db.auditEvent.create = args => args.data.action === 'resource_link.create' ? Promise.reject(new Error('Required audit unavailable')) : original(args);
  await assert.rejects(confirm(f, pending), { code: 'EXECUTION_FAILED' });
  assert.equal(f.resource.state.rows.length, 0);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: pending.action.id })).action.status, 'FAILED');
  assert.equal((await f.tools.call(f.ctx, 'create_resource_link', { input: pending.input, idempotencyKey: pending.key })).idempotent, true);
  assert.equal(f.resource.state.rows.length, 0);
});

test('changed payload cannot reuse the execution key or a stable create intent', async () => {
  const f = fixture(), input = createInput(), pending = await prepare(f, 'create_resource_link', input);
  await confirm(f, pending);
  await assert.rejects(f.tools.call(f.ctx, 'create_resource_link', { input: { ...pending.input, title: 'Changed' }, idempotencyKey: pending.key }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(prepare(f, 'create_resource_link', { ...input, title: 'Changed' }), { code: 'TARGET_UNAVAILABLE' });
  const replay = await confirm(f, await prepare(f, 'create_resource_link', input));
  assert.equal(replay.id, f.resource.state.rows[0].id);
  assert.equal(f.resource.state.rows.length, 1); assert.equal(f.resource.state.audit.length, 1);
});

test('stale update and reorder revisions are refused during confirmed execution', async () => {
  for (const action of ['update_resource_link', 'reorder_resource_links']) {
    const f = fixture(), row = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
    const input = action === 'update_resource_link' ? { id: row.id, expectedRevision: 1, title: 'Reviewed' }
      : { entityType: 'PROJECT', entityId: 'project-a', ordered: [{ id: row.id, expectedRevision: 1 }] };
    const pending = await prepare(f, action, input);
    f.resource.state.rows[0].revision++;
    await assert.rejects(confirm(f, pending), { code: 'EXECUTION_FAILED', statusCode: 409 });
    assert.equal(f.resource.state.rows[0].title, 'Drive references');
    assert.equal(f.resource.state.rows[0].revision, 2);
  }
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkspaceMcp } from '../../integrations/workspace-mcp.js';

test('real MCP SDK advertises the narrow resource scope and prepares without executing', async () => {
  const f = oauthFixture();
  const server = createWorkspaceMcp(f.tools, { ...f.ctx, oauthEnabled: true });
  const client = new Client({ name: 'resource-mcp-qa', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const catalog = await client.listTools();
    const tool = catalog.tools.find(row => row.name === 'create_resource_link');
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['workspace:resource-links:write'] }]);
    const input = createInput();
    const preview = await client.callTool({ name: 'preview_create_resource_link', arguments: input });
    const pending = await client.callTool({ name: 'create_resource_link', arguments: { input: { ...input, fingerprint: preview.structuredContent.output.fingerprint }, idempotencyKey: randomUUID() } });
    assert.equal(pending.structuredContent.action.status, 'PENDING_CONFIRMATION');
    assert.equal(f.resource.state.rows.length, 0);
    const result = await client.callTool({ name: 'confirm_action', arguments: { actionId: pending.structuredContent.action.id } });
    assert.equal(result.structuredContent.action.status, 'EXECUTED');
    assert.equal(f.resource.state.rows.length, 1);
    f.key.revokedAt = new Date();
    assert.equal((await client.listTools()).tools.some(row => row.name === 'create_resource_link'), false);
    const blocked = await client.callTool({ name: 'get_action', arguments: { actionId: pending.structuredContent.action.id } });
    assert.equal(blocked.isError, true);
    assert.equal(blocked.structuredContent.error.code, 'NOT_FOUND');
  } finally { await client.close(); await server.close(); }
});

test('organization staff may reorder other creators links while creator/admin edit permissions remain distinct', async () => {
  const f = fixture();
  const a = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  const b = await confirm(f, await prepare(f, 'create_resource_link', createInput()));
  const other = { ...f, ctx: { ...f.ctx, user: { ...f.ctx.user, id: 'team2-a' } } };
  const reordered = await confirm(other, await prepare(other, 'reorder_resource_links', { entityType: 'PROJECT', entityId: 'project-a', ordered: [{ id: b.id, expectedRevision: 1 }, { id: a.id, expectedRevision: 1 }] }));
  assert.deepEqual(reordered.items.map(row => row.id), [b.id, a.id]);
  assert.ok(reordered.items.every(row => row.canEdit === false));
  const admin = { ...f, ctx: { ...f.ctx, user: { ...f.ctx.user, id: 'admin-a', role: 'ADMIN' } } };
  const edited = await confirm(admin, await prepare(admin, 'update_resource_link', { id: a.id, expectedRevision: 2, title: 'Admin title' }));
  assert.equal(edited.title, 'Admin title');
  assert.deepEqual(edited.source, source);
});

test('the actual executor can preview and confirm the complete 500-link reorder', async () => {
  const f = fixture();
  for (let index = 0; index < 500; index++) f.resource.state.rows.push({
    id: `resource-${String(index).padStart(16, '0')}`, organizationId: 'org-a', projectId: 'project-a', taskId: null,
    createdById: 'team-a', title: `Link ${index}`, url: source.originalUrl, position: index, revision: 1,
    clientVisible: false, archivedAt: null, source: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const ordered = [...f.resource.state.rows].reverse().map(row => ({ id: row.id, expectedRevision: row.revision }));
  const input = { entityType: 'PROJECT', entityId: 'project-a', ordered };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 16 * 1024);
  const pending = await prepare(f, 'reorder_resource_links', input);
  assert.equal(f.resource.state.rows[0].position, 0);
  const result = await confirm(f, pending);
  assert.equal(result.items.length, 500);
  assert.deepEqual(result.items.map(row => row.id), ordered.map(row => row.id));
  assert.ok(result.items.every((row, index) => row.position === index && row.revision === 2));
});

test('the actual executor preserves maximum-length exact Unicode URLs and source provenance', async () => {
  const f = fixture(), prefix = 'https://example.test/';
  const longUrl = prefix + '界'.repeat(8192 - prefix.length);
  const input = createInput({ title: '界'.repeat(500), url: longUrl, source: { system: '界'.repeat(100), recordId: '界'.repeat(500), originalTitle: '界'.repeat(500), originalUrl: longUrl, originalCreatedAt: '界'.repeat(200), originalPosition: 2147483646 } });
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 16 * 1024);
  const pending = await prepare(f, 'create_resource_link', input);
  const result = await confirm(f, pending);
  assert.equal(result.url, longUrl); assert.deepEqual(result.source, input.source);
  const update = { id: result.id, expectedRevision: 1, url: longUrl + '#fragment' };
  // Keep the second URL inside the same 8192-character domain maximum.
  update.url = longUrl.slice(0, -9) + '#fragment';
  const edited = await confirm(f, await prepare(f, 'update_resource_link', update));
  assert.equal(edited.url, update.url); assert.deepEqual(edited.source, input.source);
});

import { MAX_TOOL_INPUT_BYTES, MAX_RESOURCE_LINK_INPUT_BYTES, toolInputByteLimit } from '../../ai/tools/input-budgets.js';

test('expanded resource input budget stays closed, bounded and independent of caller limits', async () => {
  const f = fixture();
  assert.equal(MAX_TOOL_INPUT_BYTES, 16 * 1024);
  assert.equal(MAX_RESOURCE_LINK_INPUT_BYTES, 512 * 1024);
  for (const name of ['create_resource_link', 'preview_create_resource_link', 'update_resource_link', 'preview_update_resource_link', 'reorder_resource_links', 'preview_reorder_resource_links']) {
    assert.equal(toolInputByteLimit(name), MAX_RESOURCE_LINK_INPUT_BYTES);
    const args = { payload: 'x'.repeat(MAX_RESOURCE_LINK_INPUT_BYTES), maxInputBytes: Number.MAX_SAFE_INTEGER };
    await assert.rejects(f.tools.call(f.ctx, name, name.startsWith('preview_') ? args : { input: args, idempotencyKey: randomUUID() }), { code: 'INPUT_TOO_LARGE' });
  }
  for (const name of ['archive_resource_link', 'restore_resource_link', 'get_resource_link', 'list_resource_links', 'get_team_workload', 'create_workspace_record', 'reorder_resource_links_other']) assert.equal(toolInputByteLimit(name), MAX_TOOL_INPUT_BYTES);
  assert.equal(toolInputByteLimit({ name: 'reorder_resource_links', maxInputBytes: Number.MAX_SAFE_INTEGER }), MAX_TOOL_INPUT_BYTES);
  await assert.rejects(f.tools.call(f.ctx, 'get_team_workload', { payload: 'x'.repeat(MAX_TOOL_INPUT_BYTES), maxInputBytes: Number.MAX_SAFE_INTEGER }), { code: 'INPUT_TOO_LARGE' });
  assert.equal(f.resource.state.rows.length, 0); assert.equal(f.db.tables.aiBridgeAction.length, 0);
});
