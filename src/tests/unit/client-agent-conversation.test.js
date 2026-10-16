import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientAgentConversationService, createClientAgentConversation } from '../../services/client-agent-conversation.service.js';

const user = { id: 'staff-a', organizationId: 'org-a', role: 'TEAM', isActive: true };
const client = { id: 'client-a', organizationId: 'org-a', deletedAt: null };
const base = { id: 'conversation-a', organizationId: 'org-a', clientId: 'client-a', title: 'Shared account manager',
  createdById: 'someone-else', revision: 0, archivedAt: null, createdAt: new Date(), updatedAt: new Date() };
function matches(row, where = {}) {
  return row && Object.entries(where).every(([key, value]) => value && typeof value === 'object'
    ? ('gt' in value ? row[key] > value.gt : 'in' in value ? value.in.includes(row[key]) : matches(row[key], value)) : row[key] === value || (value === null && row[key] == null));
}
function fixture(options = {}) {
  const state = { actor: { ...user, ...options.actor }, client: { ...client, ...options.client },
    conversations: [structuredClone(base)], runs: [], audits: [] };
  const calls = [];
  const db = {
    user: { findFirst: async ({ where }) => { calls.push('actor'); return matches(state.actor, where) ? state.actor : null; } },
    client: { findFirst: async ({ where }) => { calls.push('client'); return matches(state.client, where) ? state.client : null; } },
    clientAgentConversation: {
      findFirst: async ({ where }) => structuredClone(state.conversations.find(row => matches(row, where)) ?? null),
      findMany: async ({ where, take }) => { calls.push({ where, take }); return state.conversations.filter(row => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take); },
      create: async ({ data }) => { const row = { ...base, ...data, id: 'conversation-new' }; state.conversations.push(row); return row; },
      updateMany: async ({ where, data }) => {
        const row = state.conversations.find(row => matches(row, where));
        if (!row || options.collision) return { count: 0 };
        Object.assign(row, data, { revision: row.revision + 1 }); return { count: 1 };
      },
    },
    clientAgentRun: { findMany: async ({ where, take, select }) => {
      calls.push({ where, take, select });
      // Return extra fields deliberately: public projection must still discard them.
      return state.runs.filter(row => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take);
    } },
    $transaction: async (fn, config) => {
      assert.equal(config.isolationLevel, 'Serializable');
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  const service = createClientAgentConversationService({ recordAudit: async (_db, event) => {
    if (options.auditFailure) return null;
    state.audits.push(event); return { id: 'audit-a' };
  } });
  return { db, state, calls, service };
}

test('all active staff share conversations rather than only the creator; reads never write', async () => {
  const { db, state, service } = fixture();
  assert.notEqual(base.createdById, user.id);
  const listed = await service.list(db, user, client.id);
  assert.equal(listed.scope, 'SHARED_STAFF'); assert.equal(listed.items[0].id, base.id);
  assert.equal((await service.read(db, user, client.id, base.id)).conversation.title, base.title);
  assert.equal(state.audits.length, 0); assert.equal(state.conversations.length, 1);
});

test('create trims title, fixes creator and scope, and records no transcript in audit', async () => {
  const { db, state, service } = fixture();
  const saved = await service.create(db, user, client.id, { title: '  Planning  ' });
  assert.equal(saved.title, 'Planning'); assert.equal(saved.revision, 0); assert.equal(saved.createdById, user.id);
  assert.equal(saved.organizationId, undefined); assert.equal(saved.scope, 'SHARED_STAFF');
  assert.deepEqual(state.audits[0].metadata, { clientId: client.id, revision: 0 });
  assert.doesNotMatch(JSON.stringify(state.audits), /Planning|title|prompt|response/);
});

test('detail and independently loaded active run preserve historical evidence with safe projections', async () => {
  const f = fixture();
  const contextObservedAt = new Date('2026-10-16T00:00:00.000Z');
  const memorySnapshot = { version: 1, turns: [], truncated: false };
  const contextSnapshot = { version: 1, snapshot: { client: { id: client.id, name: 'Historical', domain: null }, projects: [], truncated: false } };
  f.state.runs.push({ id: 'run-a', organizationId: user.organizationId, conversationId: base.id, status: 'RUNNING',
    contextObservedAt, contextSnapshot, memorySnapshot, claimToken: 'private', inputHash: 'private', instructions: 'private' });
  const detail = await f.service.read(f.db, user, client.id, base.id);
  for (const row of [detail.runs[0], detail.activeRun]) {
    assert.deepEqual(row.memorySnapshot, memorySnapshot); assert.deepEqual(row.contextSnapshot, contextSnapshot); assert.deepEqual(row.contextObservedAt, contextObservedAt);
    assert.doesNotMatch(JSON.stringify(row), /claimToken|inputHash|instructions|private/);
  }
});

for (const actor of [{ role: 'CLIENT' }, { role: 'BOT' }, { isActive: false }, { organizationId: 'org-b' }, { id: 'staff-b' }]) {
  test(`fresh stored authority blocks every operation ${JSON.stringify(actor)}`, async () => {
    const { db, service } = fixture({ actor });
    for (const operation of [() => service.list(db, user, client.id), () => service.read(db, user, client.id, base.id),
      () => service.create(db, user, client.id, { title: 'New' }), () => service.archive(db, user, client.id, base.id, { revision: 0 })]) {
      await assert.rejects(operation(), { code: 'ROLE_DENIED', statusCode: 403 });
    }
  });
}
for (const role of ['CLIENT', 'BOT', undefined]) {
  test(`invalid principal ${role} is rejected before database access`, async () => {
    const { db, calls, service } = fixture();
    await assert.rejects(service.list(db, { ...user, role }, client.id), { code: 'ROLE_DENIED' });
    assert.deepEqual(calls, []);
  });
}
for (const override of [{ organizationId: 'org-b' }, { id: 'client-b' }, { deletedAt: new Date() }]) {
  test(`foreign, missing or deleted client is uniformly unavailable ${JSON.stringify(override)}`, async () => {
    const { db, service } = fixture({ client: override });
    await assert.rejects(service.list(db, user, client.id), { code: 'RECORD_NOT_FOUND', statusCode: 404 });
    await assert.rejects(service.create(db, user, client.id, { title: 'New' }), { code: 'RECORD_NOT_FOUND' });
  });
}
test('foreign conversation and run data cannot cross organization or client boundaries', async () => {
  const { db, state, service } = fixture();
  state.conversations.push({ ...base, id: 'foreign', organizationId: 'org-b' }, { ...base, id: 'other-client', clientId: 'client-b' });
  assert.equal((await service.list(db, user, client.id)).items.length, 1);
  for (const id of ['foreign', 'other-client', 'missing']) await assert.rejects(service.read(db, user, client.id, id), { code: 'RECORD_NOT_FOUND' });
  state.runs.push({ id: 'run-a', organizationId: 'org-b', conversationId: base.id });
  assert.deepEqual((await service.read(db, user, client.id, base.id)).runs, []);
});

test('list and run pages use bounded ascending keyset pagination and safe projections', async () => {
  const { db, state, calls, service } = fixture();
  state.conversations.push({ ...base, id: 'conversation-b' }, { ...base, id: 'conversation-c' });
  const first = await service.list(db, user, client.id, { limit: 1 });
  assert.equal(first.items.length, 1); assert.equal(first.nextCursor, base.id);
  assert.equal((await service.list(db, user, client.id, { limit: 1, after: first.nextCursor })).items[0].id, 'conversation-b');
  state.runs = ['run-a', 'run-b', 'run-c'].map(id => ({ id, organizationId: 'org-a', conversationId: base.id,
    prompt: 'Question', response: 'Answer', claimToken: 'secret-token', inputHash: 'secret-hash', idempotencyKey: 'secret-key', deadlineAt: new Date() }));
  const result = await service.read(db, user, client.id, base.id, { limit: 2 });
  assert.equal(result.runs.length, 2); assert.equal(result.nextCursor, 'run-b');
  assert.equal(result.runs[0].prompt, 'Question'); assert.equal(result.runs[0].response, 'Answer');
  assert.doesNotMatch(JSON.stringify(result), /secret|claimToken|inputHash|idempotencyKey|deadlineAt|organizationId/);
  assert.ok(calls.filter(call => call.take).every(call => call.take <= 51));
});

test('active run remains visible beyond a bounded transcript page and independent of its cursor', async () => {
  const { db, state, calls, service } = fixture();
  state.runs = Array.from({ length: 60 }, (_, index) => ({ id: `run-${String(index).padStart(3, '0')}`,
    organizationId: user.organizationId, conversationId: base.id, status: 'SUCCEEDED', prompt: 'Question', response: 'Answer' }));
  state.runs.push({ id: 'run-999', organizationId: user.organizationId, conversationId: base.id,
    status: 'RUNNING', prompt: 'Current question', claimToken: 'secret-token', inputHash: 'secret-hash' });
  state.runs.push({ id: 'run-000-foreign', organizationId: 'foreign', conversationId: base.id, status: 'RUNNING' });
  const result = await service.read(db, user, client.id, base.id, { limit: 50, after: 'run-002' });
  assert.equal(result.runs.length, 50); assert.equal(result.nextCursor, 'run-052');
  assert.ok(!result.runs.some(run => run.id === 'run-999'));
  assert.equal(result.activeRun.id, 'run-999'); assert.equal(result.activeRun.prompt, 'Current question');
  assert.doesNotMatch(JSON.stringify(result.activeRun), /claimToken|inputHash|organizationId|secret/);
  const activeQuery = calls.find(call => call.where?.status?.in);
  assert.equal(activeQuery.take, 1); assert.equal(activeQuery.where.id, undefined);
  state.runs.find(run => run.id === 'run-999').status = 'SUCCEEDED';
  assert.equal((await service.read(db, user, client.id, base.id)).activeRun, null);
});

test('only creator or freshly authorized admin may archive, preserving creator and transcripts', async () => {
  const { db, state, service } = fixture();
  await assert.rejects(service.archive(db, user, client.id, base.id, { revision: 0 }), { code: 'ROLE_DENIED' });
  state.actor.role = 'ADMIN';
  const saved = await service.archive(db, user, client.id, base.id, { revision: 0 });
  assert.equal(saved.revision, 1); assert.ok(saved.archivedAt); assert.equal(saved.createdById, base.createdById);
  assert.equal(state.audits[0].action, 'client_agent_conversation.archived');
  assert.equal((await service.list(db, user, client.id)).items.length, 0);
  await assert.rejects(service.read(db, user, client.id, base.id), { code: 'RECORD_NOT_FOUND' });
  assert.equal((await service.read(db, user, client.id, base.id, { includeArchived: 'true' })).conversation.id, base.id);
  assert.equal((await service.list(db, user, client.id, { includeArchived: 'false' })).items.length, 0);
  await assert.rejects(service.archive(db, user, client.id, base.id, { revision: 1 }), { code: 'CONVERSATION_CONFLICT' });
});
test('creator TEAM may archive with observed revision', async () => {
  const { db, state, service } = fixture(); state.conversations[0].createdById = user.id;
  await assert.rejects(service.archive(db, user, client.id, base.id, { revision: 1 }), { code: 'CONVERSATION_CONFLICT' });
  assert.equal((await service.archive(db, user, client.id, base.id, { revision: 0 })).revision, 1);
});
test('concurrent archive loses safely without audit', async () => {
  const { db, state, service } = fixture({ collision: true, actor: { role: 'ADMIN' } });
  await assert.rejects(service.archive(db, user, client.id, base.id, { revision: 0 }), { code: 'CONVERSATION_CONFLICT', statusCode: 409 });
  assert.equal(state.conversations[0].revision, 0); assert.equal(state.audits.length, 0);
});
test('missing audit rolls back both create and archive', async () => {
  const { db, state, service } = fixture({ auditFailure: true, actor: { role: 'ADMIN' } });
  await assert.rejects(service.create(db, user, client.id, { title: 'New' }), { code: 'CONVERSATION_AUDIT_UNAVAILABLE', statusCode: 503 });
  assert.equal(state.conversations.length, 1);
  await assert.rejects(service.archive(db, user, client.id, base.id, { revision: 0 }), { code: 'CONVERSATION_AUDIT_UNAVAILABLE' });
  assert.equal(state.conversations[0].archivedAt, null); assert.equal(state.conversations[0].revision, 0);
});
test('default service uses central audit recorder and fails closed without audit evidence', async () => {
  const { db, state } = fixture();
  db.auditEvent = { create: async () => null };
  await assert.rejects(createClientAgentConversation(db, user, client.id, { title: 'New' }), { code: 'CONVERSATION_AUDIT_UNAVAILABLE' });
  assert.equal(state.conversations.length, 1);
});
test('strict input rejects scope injection, invalid bounds and revisions before queries', async () => {
  const { db, calls, service } = fixture();
  for (const input of [{ title: '' }, { title: 'a'.repeat(201) }, { title: 'New', createdById: 'foreign' }, { title: 'New', organizationId: 'org-b' }]) {
    await assert.rejects(service.create(db, user, client.id, input), { code: 'INVALID_INPUT' });
  }
  for (const input of [{ limit: 0 }, { limit: 51 }, { includeArchived: 'yes' }, { after: '' }, { clientId: 'foreign' }]) {
    await assert.rejects(service.list(db, user, client.id, input), { code: 'INVALID_INPUT' });
  }
  for (const revision of [-1, 0.1, 2147483647]) await assert.rejects(service.archive(db, user, client.id, base.id, { revision }), { code: 'INVALID_INPUT' });
  assert.deepEqual(calls, []);
});
test('unexpected failures redact database details and serializable conflicts become 409', async () => {
  const { db, service } = fixture();
  db.user.findFirst = async () => { throw new Error('database password secret'); };
  await assert.rejects(service.list(db, user, client.id), error => error.statusCode === 503 && !/password|secret/.test(error.message));
  db.$transaction = async () => { throw Object.assign(new Error('serialization secret'), { code: 'P2034' }); };
  await assert.rejects(service.list(db, user, client.id), { code: 'CONVERSATION_CONFLICT', statusCode: 409 });
});
