import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import routes from '../../routes/client-agent-conversation.routes.js';
import { ToolError } from '../../ai/tools/registry.js';

const clientId = `c${'a'.repeat(24)}`;
const conversationId = `c${'b'.repeat(24)}`;
const runId = `c${'d'.repeat(24)}`;
const key = '123e4567-e89b-42d3-a456-426614174000';
const base = `/api/clients/${clientId}/assistant/conversations`;
const conversation = `${base}/${conversationId}`;
const run = `${conversation}/runs/${runId}`;
const endpoints = [
  ['GET', base, undefined, 'listClientAgentConversations'],
  ['POST', base, { title: 'Shared planning' }, 'createClientAgentConversation'],
  ['GET', conversation, undefined, 'readClientAgentConversation'],
  ['POST', `${conversation}/archive`, { revision: 0 }, 'archiveClientAgentConversation'],
  ['POST', `${conversation}/runs`, { question: 'What is active?', idempotencyKey: key }, 'startClientAgentRun'],
  ['GET', run, undefined, 'readClientAgentRun'],
  ['POST', `${run}/cancel`, undefined, 'cancelClientAgentRun'],
  ['GET', `${conversation}/runs/by-intent/${key}`, undefined, 'getClientAgentRunByIntent'],
];
async function setup(t, { role = 'TEAM', authenticated = true, failure } = {}) {
  const calls = [];
  const actor = { id: 'staff-a', organizationId: 'org-a', role };
  const prisma = { marker: 'exact-request-scoped-client' };
  const services = Object.fromEntries(endpoints.map(([, , , name]) => [name, async (...args) => {
    calls.push({ name, args }); if (failure) throw failure;
    return { scope: 'SHARED_STAFF', marker: name };
  }]));
  const app = Fastify();
  app.decorate('authenticate', async (request, reply) => {
    if (!authenticated) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    request.user = actor; request.prisma = prisma;
  });
  await app.register(routes, { prefix: '/api', services });
  await app.ready(); t.after(() => app.close());
  return { app, calls, actor, prisma };
}

test('each literal route delegates exact request-scoped Prisma and authenticated actor', async t => {
  const f = await setup(t);
  for (const [method, url, payload, name] of endpoints) {
    const response = await f.app.inject({ method, url, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 200, `${method} ${url}: ${response.body}`);
    assert.equal(response.json().marker, name);
    const { args } = f.calls.at(-1);
    assert.equal(args[0], f.prisma); assert.equal(args[1], f.actor); assert.equal(args[2], clientId);
    if (name !== 'listClientAgentConversations' && name !== 'createClientAgentConversation') assert.equal(args[3], conversationId);
    if (name === 'readClientAgentRun' || name === 'cancelClientAgentRun') assert.equal(args[4], runId);
    if (name === 'getClientAgentRunByIntent') assert.equal(args[4], key);
  }
  assert.equal(f.calls.length, endpoints.length);
  assert.deepEqual(f.calls[0].args[3], { limit: 25, includeArchived: false });
  assert.deepEqual(f.calls[4].args[4], { question: 'What is active?', idempotencyKey: key });
});

for (const options of [{ authenticated: false }, { role: 'CLIENT' }, { role: 'BOT' }]) {
  test(`all routes reject unauthenticated or non-staff before delegation ${JSON.stringify(options)}`, async t => {
    const f = await setup(t, options);
    for (const [method, url, payload] of endpoints) {
      const response = await f.app.inject({ method, url, ...(payload ? { payload } : {}) });
      assert.equal(response.statusCode, options.authenticated === false ? 401 : 403);
    }
    assert.deepEqual(f.calls, []);
  });
}

test('strict bounded query, bodies, CUID parameters and UUID intent are validated before delegates', async t => {
  const f = await setup(t);
  const invalid = [
    ['GET', `${base}?limit=51`], ['GET', `${base}?includeArchived=maybe`], ['GET', `${base}?after=not-cuid`],
    ['GET', `${conversation}?unknown=1`], ['GET', base.replace(clientId, 'not-cuid')],
    ['GET', `${base}/not-cuid`], ['GET', `${conversation}/runs/not-cuid`],
    ['GET', `${conversation}/runs/by-intent/not-uuid`],
    ['POST', base, { title: 'Title', organizationId: 'foreign' }], ['POST', base, { title: 'x'.repeat(201) }],
    ['POST', `${conversation}/archive`, { revision: -1 }], ['POST', `${conversation}/archive`, { revision: 0, userId: 'foreign' }],
    ['POST', `${conversation}/runs`, { question: 'x'.repeat(2001), idempotencyKey: key }],
    ['POST', `${conversation}/runs`, { question: 'Question', idempotencyKey: 'not-uuid' }],
    ['POST', `${conversation}/runs`, { question: 'Question', idempotencyKey: key, context: 'private' }],
    ['POST', `${run}/cancel`, { actorId: 'foreign' }], ['POST', `${run}/cancel?force=true`],
  ];
  for (const [method, url, payload] of invalid) {
    const response = await f.app.inject({ method, url, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 400, `${method} ${url}: ${response.body}`);
  }
  assert.deepEqual(f.calls, []);
});

test('valid foreign CUID reaches fresh service authorization and returns a uniform safe 404', async t => {
  const f = await setup(t, { failure: new ToolError('RECORD_NOT_FOUND', 'private foreign title', { statusCode: 404 }) });
  const response = await f.app.inject(conversation.replace(conversationId, `c${'f'.repeat(24)}`));
  assert.equal(response.statusCode, 404); assert.equal(f.calls.length, 1);
  assert.doesNotMatch(response.body, /private foreign/);
});

test('recognized safe service codes use fixed statuses without reflecting raw messages', async t => {
  for (const [code, status] of [['INVALID_INPUT', 400], ['ROLE_DENIED', 403], ['RECORD_NOT_FOUND', 404],
    ['RUN_IDEMPOTENCY_CONFLICT', 409], ['RUN_IN_PROGRESS', 409], ['CONVERSATION_CONFLICT', 409], ['AGENT_DISABLED', 409]]) {
    const f = await setup(t, { failure: new ToolError(code, 'secret prompt and database password', { statusCode: 500 }) });
    const response = await f.app.inject(base);
    assert.equal(response.statusCode, status); assert.equal(response.json().code, code);
    assert.doesNotMatch(response.body, /secret|password/);
  }
});

test('unexpected errors and unknown ToolError codes become sanitized 503', async t => {
  for (const failure of [Error('private prompt password'), new ToolError('UNKNOWN_PRIVATE_CODE', 'secret', { statusCode: 400 })]) {
    const f = await setup(t, { failure });
    const response = await f.app.inject(base);
    assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'CLIENT_AGENT_UNAVAILABLE');
    assert.doesNotMatch(response.body, /private|password|secret|UNKNOWN_PRIVATE_CODE/);
  }
});

test('intent receipt is a read scoped to current actor and unknown intent stays an honest 404', async t => {
  const f = await setup(t, { failure: new ToolError('RECORD_NOT_FOUND', 'Not yet observed', { statusCode: 404 }) });
  const response = await f.app.inject(`${conversation}/runs/by-intent/${key.toUpperCase()}`);
  assert.equal(response.statusCode, 404);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'getClientAgentRunByIntent');
  assert.equal(f.calls[0].args[1], f.actor); assert.equal(f.calls[0].args[4], key);
  assert.doesNotMatch(response.body, /failed|retry|not committed/i);
});
