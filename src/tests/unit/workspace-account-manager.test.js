import { processClientAgentRun } from '../../jobs/client-agent-run.js';
import { requestStorage } from '../../utils/request-context.js';
import Fastify from 'fastify';
import routes from '../../routes/workspace-account-manager.routes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkspaceAccountManager, updateWorkspaceAccountManager, requestWorkspaceAccountManager,
  listWorkspaceAccountManagerInvocations, readWorkspaceAccountManagerInvocation, getWorkspaceAccountManagerByIntent,
  claimWorkspaceAgentRun, settleWorkspaceAgentRun, expireWorkspaceAgentRuns } from '../../services/workspace-account-manager.service.js';
import { createClientAgentConversationService } from '../../services/client-agent-conversation.service.js';
import { createClientAgentRunService } from '../../services/client-agent-run.service.js';
import { WORKSPACE_CHAT_TOOLS } from '../../integrations/workspace-chat-tools.js';
const user = { id: 'staff', organizationId: 'org', role: 'ADMIN', isActive: true };
const intent = '332fc99e-738c-4403-a319-2c7fb69024cf';
const input = { bindingId: 'binding', sourceMessageId: 'message', idempotencyKey: intent };
function matches(row, where = {}) {
  return !!row && Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => matches(row, part));
    if (key === 'OR') return value.some(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lte' in value) return +row[key] <= +value.lte;
      if ('not' in value) return row[key] !== value.not;
      if ('some' in value) return row[key]?.some(part => matches(part, value.some));
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      return matches(row[key], value);
    }
    return row[key] === value || (value === null && row[key] == null);
  });
}
function fixture() {
  const state = { users: [{ ...user }], clients: [{ id: 'client', organizationId: 'org', deletedAt: null }],
    channels: [{ id: 'channel', organizationId: 'org', clientId: 'client', projectId: null, kind: 'CLIENT', archivedAt: null, client: { organizationId: 'org', deletedAt: null },
      members: [{ userId: 'staff', organizationId: 'org', leftAt: null }] }],
    profiles: [{ id: 'profile', organizationId: 'org', clientId: 'client', enabled: true, revision: 1, pluginIds: ['client-work'] }],
    projects: [], messages: [{ id: 'message', organizationId: 'org', channelId: 'channel', content: 'Private selected question', author: { ...user } }],
    bindings: [], invocations: [], conversations: [], runs: [], audits: [], events: [], locks: 0, auditFails: false };
  const db = {};
  for (const [model, key] of Object.entries({ user: 'users', client: 'clients', project: 'projects', workspaceChatChannel: 'channels', clientAgentProfile: 'profiles',
    workspaceChatMessage: 'messages', workspaceAccountManagerBinding: 'bindings', workspaceAccountManagerInvocation: 'invocations',
    clientAgentConversation: 'conversations', clientAgentRun: 'runs', auditEvent: 'audits', domainEvent: 'events' })) {
    const rows = () => state[key].map(row => key === 'invocations' ? { ...row, binding: state.bindings.find(b => b.id === row.bindingId) } : key === 'runs' ? { ...row, conversation: state.conversations.find(c => c.id === row.conversationId) } : row);
    db[model] = {
      findFirst: async ({ where }) => structuredClone(rows().find(row => matches(row, where)) ?? null),
      findMany: async ({ where, take }) => structuredClone(rows().filter(row => matches(row, where)).slice(0, take)),
      aggregate: async () => ({ _max: { sequence: 0 } }),
      create: async ({ data }) => {
        if (key === 'audits' && state.auditFails) throw new Error('Private DB failure');
        const row = { id: key === 'bindings' ? 'binding' : key + (state[key].length + 1), ...(key === 'runs' ? { response: null } : {}), createdAt: new Date(),
          updatedAt: new Date(), deliveryState: 'PENDING', ...data };
        state[key].push(row);return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const rows = state[key].filter(row => matches(row, where));
        for (const row of rows) for (const [k,v] of Object.entries(data)) row[k] = v?.increment ? row[k] + v.increment : v;
        return { count: rows.length };
      },
    };
  }
  db.$queryRaw = async () => { state.locks++;return [{ id: 'channel' }]; };
  db.$executeRaw = async () => 1;
  db.$transaction = async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable'); const before = structuredClone(state);
    try { return await fn(db); } catch (error) { Object.assign(state, before); throw error; }
  };
  const enable = async () => {
    const installed = await installWorkspaceAccountManager(db, user, 'channel', { profileId: 'profile' });
    assert.equal(installed.binding.enabled, false);
    await updateWorkspaceAccountManager(db, user, 'channel', 'binding', { revision: 1, enabled: true });
  };
  return { db, state, enable, request: () => requestWorkspaceAccountManager(db, user, 'channel', input) };
}
test('explicit disabled installation then one human-source invocation, ID-only outbox, safe card, idempotent replay', async () => {
  const f = fixture(); await f.enable(); const first = await f.request(); const replay = await f.request();
  assert.equal(replay.idempotent, true);assert.equal(first.invocation.id, replay.invocation.id);
  assert.equal(f.state.runs.length, 1);assert.equal(f.state.events.length, 1);assert.equal(f.state.messages.length, 1);
  assert.deepEqual(Object.keys(f.state.events[0].payload).sort(), ['clientId','conversationId','requestedById','runId']);
  assert.equal(first.invocation.kind, 'ACCOUNT_MANAGER_DRAFT');assert.equal(first.invocation.scope, 'WORKSPACE_CHANNEL');
  assert.doesNotMatch(JSON.stringify(first), /Private selected|inputHash|idempotencyKey|instructions/);
  assert.doesNotMatch(JSON.stringify(f.state.audits), /Private selected|prompt|response/);
});
test('disabled/profile-paused/canonical remap cannot produce; TEAM cannot install; stale binding CAS denied', async () => {
  const f = fixture(); await f.enable();
  await assert.rejects(updateWorkspaceAccountManager(f.db, user, 'channel', 'binding', { revision: 1, enabled: true }), { statusCode: 409 });
  f.state.bindings[0].enabled = false;await assert.rejects(f.request(), { statusCode: 404 });
  f.state.bindings[0].enabled = true;f.state.profiles[0].enabled = false;await assert.rejects(f.request(), { statusCode: 404 });
  f.state.profiles[0].enabled = true;f.state.channels[0].clientId = 'different';await assert.rejects(f.request(), { statusCode: 404 });
  f.state.users[0].role = 'TEAM';await assert.rejects(installWorkspaceAccountManager(f.db, { ...user, role: 'TEAM' }, 'channel', { profileId: 'profile' }), { statusCode: 404 });
  assert.equal(f.state.runs.length, 0);
});
test('member loss blocks every private list/detail/by-intent and generic transcript/run surface, even ADMIN', async () => {
  const f = fixture(); await f.enable(); const { invocation } = await f.request();
  f.state.channels[0].members[0].leftAt = new Date();
  const operations = [
    () => listWorkspaceAccountManagerInvocations(f.db, user, 'channel'),
    () => listWorkspaceAccountManagerInvocations(f.db, user, 'channel', { after: invocation.id }),
    () => readWorkspaceAccountManagerInvocation(f.db, user, 'channel', invocation.id),
    () => getWorkspaceAccountManagerByIntent(f.db, user, 'channel', intent),
    () => createClientAgentConversationService().read(f.db, user, 'client', invocation.conversationId),
    () => createClientAgentRunService().read(f.db, user, 'client', invocation.conversationId, invocation.runId),
    () => createClientAgentRunService().byIntent(f.db, user, 'client', invocation.conversationId, intent),
    () => createClientAgentRunService().cancel(f.db, user, 'client', invocation.conversationId, invocation.runId),
  ];
  for (const operation of operations) await assert.rejects(operation(), error => error.statusCode === 404);
  const shared = await createClientAgentConversationService().list(f.db, user, 'client');
  assert.deepEqual(shared.items, []); assert.equal(shared.nextCursor, null);
});
test('fresh member gets explicit private audience; generic producer cannot bypass source invocation', async () => {
  const f = fixture();await f.enable();const { invocation } = await f.request();
  const detail = await createClientAgentConversationService().read(f.db, user, 'client', invocation.conversationId);
  assert.equal(detail.scope, 'WORKSPACE_CHANNEL');assert.equal(detail.conversation.scope, 'WORKSPACE_CHANNEL');
  await assert.rejects(createClientAgentRunService().start(f.db, user, 'client', invocation.conversationId, { question: 'Bypass', idempotencyKey: intent }), { statusCode: 404 });
});
test('revoked queued claim fails durably without inference and source answer is never retained', async () => {
  const f = fixture();await f.enable();await f.request();const run = f.state.runs[0], conversation = f.state.conversations[0];
  f.state.channels[0].members[0].leftAt = new Date();
  assert.equal((await claimWorkspaceAgentRun(f.db, run, conversation, { claimToken: 'claim', startedAt: new Date(), deadlineAt: new Date(Date.now()+10000) })).count, 0);
  assert.equal(f.state.runs[0].status, 'FAILED');assert.equal(f.state.invocations[0].deliveryState, 'SUPPRESSED');assert.equal(f.state.runs[0].response, null);
});
for (const mutation of ['member', 'profile', 'binding', 'actor', 'sourceAuthor', 'clientRemap', 'archive']) test('late answer suppressed after current '+mutation+' revocation', async () => {
  const f = fixture();await f.enable();await f.request();const run = f.state.runs[0], conversation = f.state.conversations[0];
  const deadlineAt = new Date(Date.now()+60000);
  await claimWorkspaceAgentRun(f.db, run, conversation, { claimToken: 'claim', startedAt: new Date(), deadlineAt });
  if (mutation === 'member') f.state.channels[0].members[0].leftAt = new Date();
  if (mutation === 'profile') f.state.profiles[0].revision++;
  if (mutation === 'binding') f.state.bindings[0].enabled = false;
  if (mutation === 'actor') f.state.users[0].role = 'CLIENT';
  if (mutation === 'sourceAuthor') f.state.messages[0].author.isActive = false;
  if (mutation === 'clientRemap') f.state.channels[0].clientId = 'other';
  if (mutation === 'archive') f.state.conversations[0].archivedAt = new Date();
  await settleWorkspaceAgentRun(f.db, run, conversation, { claimToken: 'claim', deadlineAt, status: 'SUCCEEDED', fields: { response: 'PRIVATE LATE ANSWER' }, at: new Date() });
  assert.equal(f.state.runs[0].status, 'FAILED');assert.equal(f.state.runs[0].response, null);assert.equal(f.state.invocations[0].deliveryState, 'SUPPRESSED');
});
test('successful authorized settlement atomic with delivery and audit; duplicate settlement cannot rewrite', async () => {
  const f = fixture();await f.enable();await f.request();const run = f.state.runs[0], conversation = f.state.conversations[0];const deadlineAt = new Date(Date.now()+60000);
  await claimWorkspaceAgentRun(f.db, run, conversation, { claimToken: 'claim', startedAt: new Date(), deadlineAt });
  const args = { claimToken: 'claim', deadlineAt, status: 'SUCCEEDED', fields: { response: 'Draft answer' }, at: new Date() };
  f.state.auditFails = true;await assert.rejects(settleWorkspaceAgentRun(f.db, run, conversation, args));
  assert.equal(f.state.runs[0].status, 'RUNNING');assert.equal(f.state.runs[0].response, null);assert.equal(f.state.invocations[0].deliveryState, 'PENDING');
  f.state.auditFails = false;await settleWorkspaceAgentRun(f.db, run, conversation, args);
  await settleWorkspaceAgentRun(f.db, run, conversation, { ...args, fields: { response: 'Replacement' } });
  assert.equal(f.state.runs[0].response, 'Draft answer');assert.equal(f.state.invocations[0].deliveryState, 'DELIVERED');
  const cards = await listWorkspaceAccountManagerInvocations(f.db, user, 'channel');assert.equal(cards.items[0].response, 'Draft answer');
});
test('producer audit failure rolls back conversation, run, invocation and outbox together', async () => {
  const f = fixture();await f.enable();f.state.auditFails = true;await assert.rejects(f.request());
  for (const key of ['conversations','runs','events','invocations']) assert.equal(f.state[key].length, 0);
});
test('MCP pilot surface is read-only and uses same current-member authorization', async () => {
  const tools = WORKSPACE_CHAT_TOOLS.filter(t => t.name.includes('account_manager'));assert.equal(tools.length, 2);
  const f = fixture();await f.enable();const { invocation } = await f.request();f.state.channels[0].members[0].leftAt = new Date();
  for (const tool of tools) { assert.equal(tool.class, 'read');await assert.rejects(tool.run({ prisma: f.db, user, input: { channelId: 'channel', invocationId: invocation.id } }), error => [400,404].includes(error.statusCode)); }
});

test('actual HTTP routes enforce staff/current membership and validate before writes', async t => {
  const f = fixture();const app = Fastify();let actor = user;
  app.decorate('authenticate', async request => { request.user = actor;request.prisma = f.db; });
  await app.register(routes, { prefix: '/api/workspace-chat' });await app.ready();t.after(() => app.close());
  const base = '/api/workspace-chat/channels/channel/account-manager';
  assert.equal((await app.inject({ method: 'GET', url: base })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: base, payload: { profileId: 'profile', enabled: true } })).statusCode, 400);
  assert.equal(f.state.bindings.length, 0);
  assert.equal((await app.inject({ method: 'POST', url: base, payload: { profileId: 'profile' } })).json().binding.enabled, false);
  assert.equal((await app.inject({ method: 'PATCH', url: base+'/binding', payload: { revision: 1, enabled: true } })).statusCode, 200);
  const response = await app.inject({ method: 'POST', url: base+'/requests', payload: input });
  assert.equal(response.statusCode, 200);const card = response.json().invocation;
  assert.equal((await app.inject({ method: 'GET', url: base+'/requests/by-intent/'+intent })).json().invocation.id, card.id);
  assert.equal((await app.inject({ method: 'GET', url: base+'/requests?limit=51' })).statusCode, 400);
  f.state.channels[0].members[0].leftAt = new Date();
  assert.equal((await app.inject({ method: 'GET', url: base+'/requests/'+card.id })).statusCode, 404);
  for (const role of ['CLIENT','BOT']) { actor = { ...user, role };assert.equal((await app.inject({ method: 'GET', url: base })).statusCode, 403); }
});

for (const revoked of [false, true]) test('actual worker reuses single governed inference and source delivery checks; revoked='+revoked, async () => {
  const f = fixture();await f.enable();const { invocation } = await f.request();let calls = 0;
  const process = () => requestStorage.run({ organizationId: 'org', prisma: f.db }, () => processClientAgentRun(f.db,
    { organizationId: 'org', runId: invocation.runId }, { chat: async options => {
      calls++;assert.equal(options.singleAttempt, true);assert.deepEqual(JSON.parse(options.prompt).memorySnapshot.turns, []);
      assert.match(options.system, /member-restricted channel/);
      if (revoked) f.state.channels[0].members[0].leftAt = new Date();
      return 'PRIVATE WORKER ANSWER';
    } }));
  await process();await process();assert.equal(calls, 1);
  assert.equal(f.state.runs[0].status, revoked ? 'FAILED' : 'SUCCEEDED');
  assert.equal(f.state.runs[0].response, revoked ? null : 'PRIVATE WORKER ANSWER');
  assert.equal(f.state.invocations[0].deliveryState, revoked ? 'SUPPRESSED' : 'DELIVERED');
});

test('source recovery atomically suppresses expired queued/running cards without inference and never reclaims', async () => {
  for (const running of [false,true]) {
    const f = fixture();await f.enable();await f.request();const run = f.state.runs[0];
    const at = new Date();run.createdAt = new Date(+at-700000);
    if (running) { run.status = 'RUNNING';run.claimToken = 'claim';run.deadlineAt = new Date(+at-1); }
    const result = await expireWorkspaceAgentRuns(f.db, 'org', at, new Date(+at-600000));
    assert.equal(result[running ? 'expired' : 'queueExpired'], 1);
    assert.equal(f.state.runs[0].status, running ? 'UNKNOWN' : 'FAILED');
    assert.equal(f.state.invocations[0].deliveryState, 'SUPPRESSED');assert.equal(f.state.runs[0].response, null);
    assert.deepEqual(await expireWorkspaceAgentRuns(f.db, 'org', at, new Date(+at-600000)), { expired: 0, queueExpired: 0 });
  }
});

test('archive before claim prevents dispatch; stale pre-lock conversation cannot authorize delivery', async () => {
  const f = fixture();await f.enable();await f.request();const run = structuredClone(f.state.runs[0]), conversation = structuredClone(f.state.conversations[0]);
  f.state.conversations[0].archivedAt = new Date();
  assert.equal((await claimWorkspaceAgentRun(f.db, run, conversation, { claimToken: 'claim', startedAt: new Date(), deadlineAt: new Date(Date.now()+60000) })).count, 0);
  assert.equal(f.state.runs[0].status, 'FAILED');assert.equal(f.state.runs[0].response, null);
  assert.equal(f.state.invocations[0].deliveryState, 'SUPPRESSED');
  assert.ok(f.state.audits.some(a => a.action === 'workspace_agent.suppressed'));
});

test('private archive between claim and preflight blocks provider dispatch and records suppression', async () => {
  const f = fixture();await f.enable();const { invocation } = await f.request();let reads = 0, calls = 0;
  const readProfile = f.db.clientAgentProfile.findFirst;
  f.db.clientAgentProfile.findFirst = async args => {
    const value = await readProfile(args);if (++reads === 2) f.state.conversations[0].archivedAt = new Date();return value;
  };
  await requestStorage.run({ organizationId: 'org', prisma: f.db }, () => processClientAgentRun(f.db,
    { organizationId: 'org', runId: invocation.runId }, { chat: async () => { calls++;return 'Must not dispatch'; } }));
  assert.equal(calls, 0);assert.equal(f.state.runs[0].status, 'FAILED');assert.equal(f.state.runs[0].response, null);
  assert.equal(f.state.invocations[0].deliveryState, 'SUPPRESSED');assert.ok(f.state.audits.some(a => a.action === 'workspace_agent.suppressed'));
});
