import test from 'node:test';
import assert from 'node:assert/strict';
import { registerClientAgentRunSubscriber } from '../../subscribers/client-agent-run.subscriber.js';
import { subscribersFor, unregisterDomainEventSubscriber } from '../../services/domain-event-dispatcher.service.js';
import { requestStorage } from '../../utils/request-context.js';

function fixture(t, enqueue) {
  const event = { type: 'client_agent.run_requested', organizationId: 'org-a', aggregateId: 'run-a',
    payload: { clientId: 'client-a', conversationId: 'conversation-a', runId: 'run-a', requestedById: 'staff-a' } };
  const state = { run: { id: 'run-a', organizationId: 'org-a', conversationId: 'conversation-a', requestedById: 'staff-a', status: 'QUEUED' },
    conversation: { id: 'conversation-a', organizationId: 'org-a', clientId: 'client-a' }, calls: [], reads: [] };
  const prisma = {
    clientAgentRun: { findFirst: async args => { state.reads.push(args); return state.run; } },
    clientAgentConversation: { findFirst: async args => { state.reads.push(args); return state.conversation; } },
  };
  registerClientAgentRunSubscriber({ enqueue: enqueue ?? (async (...args) => { state.calls.push(args); }) });
  t.after(() => unregisterDomainEventSubscriber('client-agent-run-enqueue'));
  const subscriber = subscribersFor(event.type).find(item => item.name === 'client-agent-run-enqueue');
  const deliver = () => requestStorage.run({ prisma, organizationId: 'org-a' }, () => subscriber.handle(event, { prisma, attempt: 1 }));
  return { event, state, prisma, subscriber, deliver };
}

test('replay schedules IDs only with stable job key and bounded transport retry backoff', async t => {
  const f = fixture(t);
  await f.deliver(); await f.deliver();
  assert.equal(f.state.calls.length, 2); assert.deepEqual(f.state.calls[0], f.state.calls[1]);
  assert.deepEqual(f.state.calls[0], ['run-client-agent', { organizationId: 'org-a', runId: 'run-a' },
    { jobId: 'client-agent-run-a', attempts: 3, backoff: { type: 'exponential', delay: 2000 } }]);
  assert.doesNotMatch(JSON.stringify(f.state.calls), /question|prompt|response|requestedById|clientId|conversationId/);
  assert.ok(f.state.reads.every(args => args.where.organizationId === 'org-a'));
  assert.equal(subscribersFor('invoice.paid').some(item => item.name === 'client-agent-run-enqueue'), false);
});

test('queue failure propagates and a later outbox retry uses the same job identity', async t => {
  const calls = []; let attempts = 0;
  const f = fixture(t, async (...args) => { calls.push(args); if (++attempts === 1) throw Error('Redis unavailable'); });
  await assert.rejects(f.deliver(), /Redis unavailable/);
  await f.deliver(); assert.deepEqual(calls[0], calls[1]);
});

test('missing or mismatched outer tenant context refuses before database reads', async t => {
  const f = fixture(t);
  await assert.rejects(f.subscriber.handle(f.event, { prisma: f.prisma }), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });
  await assert.rejects(requestStorage.run({ prisma: f.prisma, organizationId: 'org-b' }, () => f.subscriber.handle(f.event, { prisma: f.prisma })), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });
  await assert.rejects(requestStorage.run({ prisma: {}, organizationId: 'org-a' }, () => f.subscriber.handle(f.event, { prisma: f.prisma })), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });
  assert.deepEqual(f.state.reads, []); assert.deepEqual(f.state.calls, []);
});

test('forged envelope, extra context and malformed IDs fail closed', async t => {
  const f = fixture(t), original = structuredClone(f.event);
  for (const mutate of [
    event => { event.aggregateId = 'other-run'; }, event => { event.organizationId = 'org-b'; },
    event => { event.payload.question = 'Unapproved prompt'; }, event => { event.payload.runId = 'bad:id'; },
    event => { delete event.payload.clientId; }, event => { event.type = 'other.event'; },
  ]) {
    Object.assign(f.event, structuredClone(original)); mutate(f.event);
    await assert.rejects(f.deliver(), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });
  }
  assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.reads, []);
});

test('stored run and conversation identities must agree with every payload scope field', async t => {
  const f = fixture(t), original = structuredClone(f.state);
  for (const [table, key, value] of [
    ['run', 'id', 'other-run'], ['run', 'organizationId', 'org-b'], ['run', 'conversationId', 'other-conversation'],
    ['run', 'requestedById', 'other-staff'], ['conversation', 'id', 'other-conversation'],
    ['conversation', 'organizationId', 'org-b'], ['conversation', 'clientId', 'other-client'],
  ]) {
    f.state.run = structuredClone(original.run); f.state.conversation = structuredClone(original.conversation);
    f.state[table][key] = value;
    await assert.rejects(f.deliver(), { code: 'CLIENT_AGENT_EVENT_SCOPE_INVALID' });
  }
  assert.deepEqual(f.state.calls, []);
});

test('deleted runs and already claimed or terminal runs skip without scheduling inference', async t => {
  const f = fixture(t);
  for (const status of ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']) {
    f.state.run.status = status; assert.equal((await f.deliver()).skipped, 'RUN_ALREADY_CLAIMED');
  }
  f.state.run = null; assert.equal((await f.deliver()).skipped, 'RUN_NOT_FOUND');
  assert.deepEqual(f.state.calls, []);
});
