import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientAgentRunService } from '../../services/client-agent-run.service.js';

const user = { id: 'staff-a', organizationId: 'org-a', role: 'TEAM', isActive: true };
const client = { id: 'client-a', organizationId: 'org-a', deletedAt: null };
const conversation = { id: 'conversation-a', organizationId: 'org-a', clientId: client.id, archivedAt: null };
const input = { question: '  What needs attention?  ', idempotencyKey: '332fc99e-738c-4403-a319-2c7fb69024cf' };
const secondKey = 'f1a458b2-1293-41af-bf7a-f8d9efa02911';
function matches(row, where = {}) {
  return row && Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => matches(row, part))
    : value && typeof value === 'object' ? ('in' in value ? value.in.includes(row[key]) : matches(row[key], value))
      : row[key] === value || (value === null && row[key] == null));
}
function fixture(options = {}) {
  const state = { actor: { ...user, ...options.actor }, client: { ...client, ...options.client },
    conversation: { ...conversation, ...options.conversation }, runs: [], events: [], audits: [],
    profile: { clientId: client.id, enabled: true, pluginIds: ['client-work'], revision: 7, ...options.profile } };
  const calls = [];
  const db = {
    user: { findFirst: async ({ where }) => { calls.push('actor'); return matches(state.actor, where) ? state.actor : null; } },
    client: { findFirst: async ({ where }) => { calls.push('client'); return matches(state.client, where) ? state.client : null; } },
    clientAgentConversation: { findFirst: async ({ where }) => matches(state.conversation, where) ? state.conversation : null },
    clientAgentProfile: { findFirst: async () => null },
    clientAgentRun: {
      findFirst: async ({ where }) => structuredClone(state.runs.find(row => matches(row, where)) ?? null),
      create: async ({ data }) => {
        if (options.createCollision) throw Object.assign(new Error('database constraint private'), { code: 'P2002' });
        const row = { id: `run-${state.runs.length + 1}`, response: null, claimToken: 'private-token', createdAt: new Date(), ...data };
        state.runs.push(row); return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const row = state.runs.find(run => matches(run, where));
        if (!row || options.cancelCollision) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    $transaction: async (fn, config) => {
      assert.equal(config.isolationLevel, 'Serializable'); const before = structuredClone(state);
      try { return await fn(db); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  const dependencies = {
    recordAudit: async (_db, event) => { if (options.auditFailure) return null; state.audits.push(event); return { id: 'audit-a' }; },
    recordEvent: async (_db, event) => {
      if (options.eventFailure) throw new Error('private outbox error');
      if (options.eventMissing) return null;
      state.events.push(event); return { event: { id: 'event-a' }, duplicate: false };
    },
    ...(options.actualProfile ? {} : { readProfile: async () => { calls.push('profile'); return state.profile; } }),
  };
  const service = createClientAgentRunService(dependencies);
  const start = patch => service.start(db, user, client.id, conversation.id, { ...input, ...patch });
  return { db, state, calls, service, start };
}

test('producer atomically stores one queued run, ID-only event and audit, without dispatching inference', async () => {
  const { start, state } = fixture(); const saved = await start();
  assert.equal(saved.status, 'QUEUED'); assert.equal(saved.prompt, 'What needs attention?'); assert.equal(saved.profileRevision, 7);
  assert.equal(saved.scope, 'SHARED_STAFF'); assert.equal(state.runs.length, 1); assert.equal(state.events.length, 1); assert.equal(state.audits.length, 1);
  assert.deepEqual(state.events[0].payload, { clientId: client.id, conversationId: conversation.id, runId: saved.id, requestedById: user.id });
  assert.equal(state.events[0].type, 'client_agent.run_requested'); assert.equal(state.events[0].aggregateId, saved.id);
  assert.equal(state.audits[0].action, 'client_agent_run.requested');
  assert.doesNotMatch(JSON.stringify([...state.audits, ...state.events]), /What needs|prompt|response|private-token/);
  assert.doesNotMatch(JSON.stringify(saved), /inputHash|claimToken|idempotencyKey|organizationId|private-token/);
});
test('same requester/key returns original queued or terminal run before active-run and profile checks', async () => {
  const { start, state, calls } = fixture(); const saved = await start();
  const firstProfileChecks = calls.filter(value => value === 'profile').length;
  assert.equal((await start({ question: 'What needs attention?' })).id, saved.id);
  state.runs[0].status = 'SUCCEEDED'; state.runs[0].response = 'Stored answer'; state.profile.enabled = false;
  const replay = await start(); assert.equal(replay.status, 'SUCCEEDED'); assert.equal(replay.response, 'Stored answer');
  assert.equal(calls.filter(value => value === 'profile').length, firstProfileChecks);
  assert.equal(state.events.length, 1); assert.equal(state.audits.length, 1); assert.equal(state.runs.length, 1);
});
test('same key with changed question or canonical conversation conflicts without another write', async () => {
  const { start, state, service, db } = fixture(); await start();
  await assert.rejects(start({ question: 'Changed question' }), { code: 'RUN_IDEMPOTENCY_CONFLICT', statusCode: 409 });
  state.conversation.id = 'conversation-b';
  await assert.rejects(service.start(db, user, client.id, 'conversation-b', input), { code: 'RUN_IDEMPOTENCY_CONFLICT' });
  assert.equal(state.runs.length, 1); assert.equal(state.events.length, 1);
});
test('another pending run blocks new keys, terminal runs permit the next turn', async () => {
  const { start, state } = fixture(); await start();
  for (const status of ['QUEUED', 'RUNNING']) {
    state.runs[0].status = status;
    await assert.rejects(start({ idempotencyKey: secondKey }), { code: 'RUN_IN_PROGRESS', statusCode: 409 });
  }
  state.runs[0].status = 'UNKNOWN';
  assert.equal((await start({ idempotencyKey: secondKey })).status, 'QUEUED'); assert.equal(state.runs.length, 2);
});
test('idempotency keys are requester-scoped while transcript reads are shared staff', async () => {
  const { start, state, service, db } = fixture(); const saved = await start();
  state.actor.id = 'staff-b'; const colleague = { ...user, id: 'staff-b' };
  assert.equal((await service.read(db, colleague, client.id, conversation.id, saved.id)).id, saved.id);
  state.runs[0].status = 'SUCCEEDED';
  assert.notEqual((await service.start(db, colleague, client.id, conversation.id, input)).id, saved.id);
});
test('intent receipt is actor-scoped, read-only and safe after reload or archival', async () => {
  const { start, state, service, db } = fixture(); const saved = await start();
  assert.equal((await service.byIntent(db, user, client.id, conversation.id, input.idempotencyKey.toUpperCase())).id, saved.id);
  state.conversation.archivedAt = new Date();
  assert.equal((await service.byIntent(db, user, client.id, conversation.id, input.idempotencyKey)).id, saved.id);
  assert.equal(state.audits.length, 1); assert.equal(state.events.length, 1);
  state.actor.id = 'staff-b'; const colleague = { ...user, id: 'staff-b' };
  await assert.rejects(service.byIntent(db, colleague, client.id, conversation.id, input.idempotencyKey), { code: 'RECORD_NOT_FOUND', statusCode: 404 });
  // Shared direct run reads do not make another staff member's opaque intent discoverable.
  assert.equal((await service.read(db, colleague, client.id, conversation.id, saved.id)).id, saved.id);
});
test('intent receipt rechecks role/client/conversation and rejects invalid or absent keys', async () => {
  const { start, state, service, db } = fixture(); await start();
  await assert.rejects(service.byIntent(db, user, client.id, conversation.id, secondKey), { code: 'RECORD_NOT_FOUND' });
  await assert.rejects(service.byIntent(db, user, client.id, conversation.id, 'invalid'), { code: 'INVALID_INPUT' });
  state.actor.isActive = false;
  await assert.rejects(service.byIntent(db, user, client.id, conversation.id, input.idempotencyKey), { code: 'ROLE_DENIED' });
  state.actor.isActive = true; state.client.organizationId = 'foreign';
  await assert.rejects(service.byIntent(db, user, client.id, conversation.id, input.idempotencyKey), { code: 'RECORD_NOT_FOUND' });
  state.client.organizationId = user.organizationId; state.conversation.clientId = 'another';
  await assert.rejects(service.byIntent(db, user, client.id, conversation.id, input.idempotencyKey), { code: 'RECORD_NOT_FOUND' });
});
for (const actor of [{ role: 'CLIENT' }, { role: 'BOT' }, { isActive: false }, { organizationId: 'foreign' }, { id: 'other' }]) {
  test(`fresh stored actor denied for start/read/cancel ${JSON.stringify(actor)}`, async () => {
    const { db, service, start } = fixture({ actor });
    await assert.rejects(start(), { code: 'ROLE_DENIED', statusCode: 403 });
    await assert.rejects(service.read(db, user, client.id, conversation.id, 'run-a'), { code: 'ROLE_DENIED' });
    await assert.rejects(service.cancel(db, user, client.id, conversation.id, 'run-a'), { code: 'ROLE_DENIED' });
  });
}
test('revoked staff cannot replay an existing idempotent request', async () => {
  const { start, state } = fixture(); await start(); state.actor.role = 'CLIENT';
  await assert.rejects(start(), { code: 'ROLE_DENIED' }); assert.equal(state.events.length, 1);
});
for (const patch of [{ client: { organizationId: 'foreign' } }, { client: { deletedAt: new Date() } },
  { conversation: { organizationId: 'foreign' } }, { conversation: { clientId: 'client-b' } }]) {
  test(`canonical client/conversation enforced ${JSON.stringify(patch)}`, async () => {
    const { start, state } = fixture(patch);
    await assert.rejects(start(), { code: 'RECORD_NOT_FOUND', statusCode: 404 }); assert.equal(state.runs.length, 0);
  });
}
test('archived conversations reject starts but allow staff reads and requester cancellation', async () => {
  const { start, state, db, service } = fixture(); const saved = await start(); state.conversation.archivedAt = new Date();
  await assert.rejects(start({ idempotencyKey: secondKey }), { code: 'CONVERSATION_ARCHIVED' });
  assert.equal((await service.read(db, user, client.id, conversation.id, saved.id)).id, saved.id);
  assert.equal((await service.cancel(db, user, client.id, conversation.id, saved.id)).status, 'CANCELLED');
});
for (const profile of [{ enabled: false }, { pluginIds: [] }, { clientId: 'foreign' }]) {
  test(`disabled or unavailable client work profile prevents writes ${JSON.stringify(profile)}`, async () => {
    const { start, state } = fixture({ profile }); await assert.rejects(start(), { code: 'AGENT_DISABLED', statusCode: 409 });
    assert.equal(state.runs.length, 0); assert.equal(state.events.length, 0);
  });
}
test('default profile reader reuses current side-effect-free profile defaults', async () => {
  const { start, state } = fixture({ actualProfile: true }); const row = await start();
  assert.equal(row.profileRevision, 0); assert.equal(state.runs.length, 1);
});
for (const options of [{ eventFailure: true }, { eventMissing: true }, { auditFailure: true }]) {
  test(`event/audit failure rolls back queued run and every sibling fact ${JSON.stringify(options)}`, async () => {
    const { start, state } = fixture(options);
    await assert.rejects(start(), error => error.statusCode === 503);
    assert.equal(state.runs.length, 0); assert.equal(state.events.length, 0); assert.equal(state.audits.length, 0);
  });
}
test('requester cancellation from queued/running is durable and replay does not repeat audit', async () => {
  for (const status of ['QUEUED', 'RUNNING']) {
    const { start, state, db, service } = fixture(); const row = await start(); state.runs[0].status = status;
    const cancelled = await service.cancel(db, user, client.id, conversation.id, row.id);
    assert.equal(cancelled.status, 'CANCELLED'); assert.ok(cancelled.finishedAt); assert.equal(state.runs[0].claimToken, null);
    assert.equal(state.audits[1].action, 'client_agent_run.cancelled');
    await service.cancel(db, user, client.id, conversation.id, row.id); assert.equal(state.audits.length, 2);
    assert.equal((await start()).status, 'CANCELLED');
  }
});
test('another TEAM cannot cancel while fresh ADMIN may cancel regardless of requester', async () => {
  const { start, state, db, service } = fixture(); const row = await start();
  state.actor.id = 'staff-b'; const colleague = { ...user, id: 'staff-b' };
  await assert.rejects(service.cancel(db, colleague, client.id, conversation.id, row.id), { code: 'ROLE_DENIED' });
  state.actor.role = 'ADMIN';
  assert.equal((await service.cancel(db, colleague, client.id, conversation.id, row.id)).status, 'CANCELLED');
});
for (const status of ['SUCCEEDED', 'FAILED', 'UNKNOWN']) {
  test(`completed ${status} cannot be cancelled`, async () => {
    const { start, state, db, service } = fixture(); const row = await start(); state.runs[0].status = status;
    await assert.rejects(service.cancel(db, user, client.id, conversation.id, row.id), { code: 'RUN_CONFLICT', statusCode: 409 });
    assert.equal(state.runs[0].status, status);
  });
}
test('lost cancellation CAS and missing audit preserve the prior run', async () => {
  for (const options of [{ cancelCollision: true }, { auditFailure: true }]) {
    const { state, db, service } = fixture(options);
    state.runs.push({ id: 'run-a', organizationId: 'org-a', conversationId: conversation.id, requestedById: user.id, status: 'RUNNING', claimToken: 'old-claim' });
    await assert.rejects(service.cancel(db, user, client.id, conversation.id, 'run-a'), error => options.cancelCollision ? error.statusCode === 409 : error.statusCode === 503);
    assert.equal(state.runs[0].status, 'RUNNING'); assert.equal(state.runs[0].claimToken, 'old-claim');
  }
});
test('foreign run reads/cancellation are uniformly unavailable', async () => {
  const { state, service, db } = fixture();
  state.runs.push({ id: 'run-a', organizationId: 'foreign', conversationId: conversation.id });
  await assert.rejects(service.read(db, user, client.id, conversation.id, 'run-a'), { code: 'RECORD_NOT_FOUND' });
  await assert.rejects(service.cancel(db, user, client.id, conversation.id, 'run-a'), { code: 'RECORD_NOT_FOUND' });
});
test('strict bounded input rejects injections before data queries', async () => {
  const { start, calls } = fixture();
  for (const patch of [{ question: '' }, { question: 'a'.repeat(2001) }, { idempotencyKey: 'invalid' }, { organizationId: 'foreign' }, { prompt: 'override' }]) {
    await assert.rejects(start(patch), { code: 'INVALID_INPUT', statusCode: 400 });
  }
  assert.deepEqual(calls, []);
});
test('uniqueness backstop conflicts are bounded and redacted', async () => {
  const { start, state } = fixture({ createCollision: true });
  await assert.rejects(start(), { code: 'RUN_CONFLICT', statusCode: 409 });
  assert.equal(state.runs.length, 0); assert.equal(state.events.length, 0);
});
