import test from 'node:test';
import assert from 'node:assert/strict';
import { processClientAgentRun } from '../../jobs/client-agent-run.js';
import { requestStorage } from '../../utils/request-context.js';

const ids = { organizationId: 'org-a', runId: 'run-a' };
function matches(row, where = {}) {
  return !!row && Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every(part => matches(row, part));
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('gt' in expected) return +row[key] > +expected.gt;
      if ('lte' in expected) return +row[key] <= +expected.lte;
    }
    return row[key] === expected || (expected === null && row[key] == null);
  });
}
function fixture() {
  const state = {
    run: { id: 'run-a', organizationId: 'org-a', conversationId: 'conversation-a', requestedById: 'staff-a', prompt: 'What is underway?', status: 'QUEUED' },
    conversation: { id: 'conversation-a', organizationId: 'org-a', clientId: 'client-a', archivedAt: null },
    actor: { id: 'staff-a', organizationId: 'org-a', role: 'TEAM', isActive: true },
    client: { id: 'client-a', organizationId: 'org-a', deletedAt: null, name: 'Example', domain: 'example.test', contacts: 'PRIVATE CONTACTS' },
    profile: { id: 'profile-a', organizationId: 'org-a', clientId: 'client-a', name: 'Manager', instructions: 'Keep it concise', enabled: true, revision: 7, pluginIds: ['client-work'] },
    projects: [{ id: 'project-a', organizationId: 'org-a', clientId: 'client-a', deletedAt: null, name: 'Website', status: 'ACTIVE', startDate: null, endDate: null, summary: 'PRIVATE NOTES', budget: 9999 }],
    calls: [], writes: [], time: new Date('2026-10-15T20:00:00Z'),
  };
  const delegate = key => ({ findFirst: async ({ where }) => matches(state[key], where) ? structuredClone(state[key]) : null });
  const prisma = {
    clientAgentRun: { ...delegate('run'), updateMany: async ({ where, data }) => {
      state.writes.push({ where: structuredClone(where), data: structuredClone(data) });
      if (!matches(state.run, where)) return { count: 0 };
      Object.assign(state.run, data); return { count: 1 };
    } },
    clientAgentConversation: delegate('conversation'), user: delegate('actor'), client: delegate('client'), clientAgentProfile: delegate('profile'),
    project: { findMany: async () => structuredClone(state.projects) },
  };
  const chat = async input => { state.calls.push(input); return 'Website is active.'; };
  const process = (options = {}) => requestStorage.run({ prisma, organizationId: ids.organizationId, feature: 'background_job' },
    () => processClientAgentRun(prisma, ids, { chat, now: () => new Date(state.time), ...options }));
  return { state, prisma, process };
}

test('processor requires matching verified outer tenant and exact scoped client before any writes', async () => {
  const f = fixture();
  await assert.rejects(processClientAgentRun(f.prisma, ids), { code: 'TENANT_CONTEXT_REQUIRED' });
  for (const store of [{ prisma: {}, organizationId: 'org-a' }, { prisma: f.prisma, organizationId: 'org-b' }]) {
    await assert.rejects(requestStorage.run(store, () => processClientAgentRun(f.prisma, ids)), { code: 'TENANT_CONTEXT_REQUIRED' });
  }
  assert.deepEqual(f.state.writes, []); assert.deepEqual(f.state.calls, []);
});

test('processor concurrent duplicate claims dispatch once after committed claim and preserve bounded public context', async () => {
  const f = fixture(); let calls = 0;
  const chat = async input => {
    calls++; assert.equal(f.state.run.status, 'RUNNING'); assert.ok(f.state.run.claimToken);
    assert.equal(f.state.writes[0].data.status, 'RUNNING');
    assert.equal(requestStorage.getStore().prisma, f.prisma);
    assert.equal(requestStorage.getStore().organizationId, 'org-a');
    assert.equal(requestStorage.getStore().feature, 'client_agent_run');
    assert.equal(input.singleAttempt, true); assert.equal(input.maxTokens, 2048); assert.equal(input.feature, 'client_agent_run');
    assert.doesNotMatch(JSON.stringify(input), /PRIVATE|9999/);
    assert.equal(JSON.parse(input.prompt).snapshot.client.id, 'client-a');
    return 'Website is active.';
  };
  await Promise.all([f.process({ chat }), f.process({ chat })]);
  assert.equal(calls, 1); assert.equal(f.state.run.status, 'SUCCEEDED');
  assert.equal(f.state.run.profileRevision, 7); assert.equal(f.state.run.response, 'Website is active.');
  assert.ok(f.state.run.finishedAt);
  await f.process({ chat }); assert.equal(calls, 1);
});

test('processor running replay never calls provider and expired claim becomes UNKNOWN permanently', async () => {
  const f = fixture();
  Object.assign(f.state.run, { status: 'RUNNING', claimToken: 'previous', deadlineAt: new Date(+f.state.time + 1) });
  assert.equal((await f.process()).status, 'RUNNING');
  f.state.time = new Date(+f.state.time + 2);
  assert.equal((await f.process()).status, 'UNKNOWN');
  assert.equal(f.state.run.errorCode, 'RUN_DEADLINE_EXCEEDED');
  await f.process(); assert.equal(f.state.calls.length, 0);
});

for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']) {
  test(`processor terminal ${status} replay performs no writes or inference`, async () => {
    const f = fixture(); f.state.run.status = status;
    assert.equal((await f.process()).status, status);
    assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.writes, []);
  });
}

test('processor rejects foreign or missing stored run before claiming', async () => {
  const f = fixture(); f.state.run.organizationId = 'org-b';
  assert.equal((await f.process()).status, 'NOT_FOUND');
  assert.deepEqual(f.state.writes, []); assert.deepEqual(f.state.calls, []);
});

for (const [label, mutate, code] of [
  ['revoked role', state => { state.actor.role = 'CLIENT'; }, 'ROLE_DENIED'],
  ['inactive actor', state => { state.actor.isActive = false; }, 'ROLE_DENIED'],
  ['foreign actor', state => { state.actor.organizationId = 'org-b'; }, 'ROLE_DENIED'],
  ['foreign client', state => { state.client.organizationId = 'org-b'; }, 'RECORD_NOT_FOUND'],
  ['deleted client', state => { state.client.deletedAt = new Date(); }, 'RECORD_NOT_FOUND'],
  ['archived conversation', state => { state.conversation.archivedAt = new Date(); }, 'RECORD_NOT_FOUND'],
  ['disabled profile', state => { state.profile.enabled = false; }, 'CLIENT_AGENT_PAUSED'],
  ['disabled plugin', state => { state.profile.pluginIds = []; }, 'CLIENT_AGENT_PLUGIN_DISABLED'],
  ['oversized question', state => { state.run.prompt = 'x'.repeat(2001); }, 'RUN_INPUT_INVALID'],
  ['oversized snapshot', state => { state.client.name = 'x'.repeat(64_001); }, 'CONTEXT_TOO_LARGE'],
]) {
  test(`processor preflight ${label} fails durably before dispatch`, async () => {
    const f = fixture(); mutate(f.state);
    assert.equal((await f.process()).status, 'FAILED');
    assert.equal(f.state.run.errorCode, code); assert.equal(f.state.calls.length, 0);
    await f.process(); assert.equal(f.state.calls.length, 0);
  });
}

test('processor unexpected preflight failure is sanitized and never dispatches', async () => {
  const f = fixture(); f.prisma.user.findFirst = async () => { throw Error('private database password'); };
  await f.process(); assert.equal(f.state.run.status, 'FAILED');
  assert.equal(f.state.run.errorCode, 'RUN_PREFLIGHT_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(f.state.run), /password/); assert.deepEqual(f.state.calls, []);
});

test('processor cancellation during context reads prevents dispatch', async () => {
  const f = fixture();
  f.prisma.project.findMany = async () => { f.state.run.status = 'CANCELLED'; return []; };
  assert.equal((await f.process()).status, 'CANCELLED'); assert.deepEqual(f.state.calls, []);
});

test('processor dispatch exceptions including setup errors become UNKNOWN without retry', async () => {
  for (const code of ['AI_UNAVAILABLE', 'ETIMEDOUT', undefined]) {
    const f = fixture(); let calls = 0;
    const chat = async () => { calls++; throw Object.assign(Error('private provider payload'), { code }); };
    await f.process({ chat }); await f.process({ chat });
    assert.equal(calls, 1); assert.equal(f.state.run.status, 'UNKNOWN');
    assert.equal(f.state.run.errorCode, 'RUN_PROVIDER_OUTCOME_UNKNOWN');
    assert.doesNotMatch(JSON.stringify(f.state.run), /private provider/);
  }
});

test('processor invalid, empty and oversized answers become UNKNOWN and cannot dispatch again', async () => {
  for (const response of [undefined, '', '  ', 'x'.repeat(20_001)]) {
    const f = fixture(); let calls = 0;
    const chat = async () => { calls++; return response; };
    await f.process({ chat }); await f.process({ chat });
    assert.equal(calls, 1); assert.equal(f.state.run.status, 'UNKNOWN');
    assert.equal(f.state.run.errorCode, 'RUN_RESPONSE_INVALID'); assert.equal(f.state.run.response, undefined);
  }
});

test('processor governed kill switch and budget denials remain known terminal failures', async () => {
  for (const code of ['AI_DISABLED', 'AI_BUDGET_EXCEEDED']) {
    const f = fixture();
    await f.process({ chat: async () => { throw Object.assign(Error('Denied'), { code }); } });
    assert.equal(f.state.run.status, 'FAILED'); assert.equal(f.state.run.errorCode, code);
  }
});

test('processor late answer cannot overwrite cancellation or a different claimant', async () => {
  for (const change of [{ status: 'CANCELLED' }, { claimToken: 'other-claim' }]) {
    const f = fixture();
    await f.process({ chat: async () => { Object.assign(f.state.run, change); return 'Late response'; } });
    assert.equal(f.state.run.response, undefined);
    assert.equal(f.state.run.status, change.status ?? 'RUNNING');
    if (change.claimToken) assert.equal(f.state.run.claimToken, change.claimToken);
  }
});

test('processor discards response received after deadline and never redispatches', async () => {
  const f = fixture(); let calls = 0;
  await f.process({ chat: async () => { calls++; f.state.time = new Date(+f.state.time + 120_001); return 'Late response'; } });
  assert.equal(f.state.run.status, 'UNKNOWN'); assert.equal(f.state.run.response, undefined);
  assert.equal(f.state.run.errorCode, 'RUN_DEADLINE_EXCEEDED');
  await f.process(); assert.equal(calls, 1);
});
