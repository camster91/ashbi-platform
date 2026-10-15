import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import clientAssistantRoutes from '../../routes/client-assistant.routes.js';
import { AiBudgetExceededError, AiDisabledError } from '../../ai/errors.js';
import { requestStorage } from '../../utils/request-context.js';

const CLIENT = { id: 'client-a', organizationId: 'org-a', deletedAt: null, name: 'Example', domain: 'example.test', contacts: ['private-contact'] };
const PROJECT = { id: 'project-a', clientId: 'client-a', organizationId: 'org-a', deletedAt: null, name: 'Website', status: 'ACTIVE', startDate: null, endDate: null, summary: 'private-summary', budget: 999, risks: ['private-risk'] };
const URL = '/api/client-assistants/client-a/preview';

async function setup(t, { role = 'ADMIN', organizationId = 'org-a', client = CLIENT, projects = [PROJECT], chat } = {}) {
  const calls = [];
  const reads = [];
  const writes = [];
  const mutations = Object.fromEntries(['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany', 'upsert'].map((method) => [method, async (...args) => { writes.push({ method, args }); throw new Error('Unexpected mutation'); }]));
  const prisma = {
    client: { ...mutations, findFirst: async (args) => { reads.push(['client', args]); return client; } },
    project: { ...mutations, findMany: async (args) => { reads.push(['project', args]); return projects; } },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'staff-a', role, organizationId };
    request.prisma = prisma;
  });
  await app.register(rateLimit, { global: false });
  await app.register(clientAssistantRoutes, {
    prefix: '/api/client-assistants',
    chat: async (input) => {
      calls.push({ input, store: requestStorage.getStore() });
      return chat ? chat(input) : 'The Website project is active.';
    },
  });
  await app.ready();
  t.after(() => app.close());
  return { app, calls, reads, writes, prisma };
}

for (const role of ['ADMIN', 'TEAM']) {
  test(`${role} can preview one bounded client context without internal fields or mutations`, async (t) => {
    const { app, calls, reads, writes } = await setup(t, { role });
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: '  What is happening?  ' } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.mode, 'STAFF_PREVIEW');
    assert.equal(body.response, 'The Website project is active.');
    assert.ok(Number.isFinite(Date.parse(body.observedAt)));
    assert.deepEqual(body.context, {
      client: { id: 'client-a', name: 'Example', domain: 'example.test' },
      projects: [{ id: 'project-a', name: 'Website', status: 'ACTIVE', startDate: null, endDate: null }], truncated: false,
    });
    assert.deepEqual(Object.keys(body).sort(), ['context', 'mode', 'observedAt', 'response']);
    assert.equal(calls.length, 1);
    const { input } = calls[0];
    assert.equal(input.feature, 'client_assistant_preview');
    assert.equal(input.maxTokens, 2048);
    assert.equal(input.temperature, 0.2);
    const prompt = JSON.parse(input.prompt);
    assert.deepEqual(prompt.snapshot, body.context);
    assert.equal(prompt.question, 'What is happening?');
    assert.equal(prompt.observedAt, body.observedAt);
    assert.doesNotMatch(input.prompt, /private-|"budget"|"organizationId"|"clientId"/);
    assert.match(input.system, /cannot create tickets, change records, send messages/);
    assert.equal(input.tools, undefined);
    assert.equal(reads.length, 2);
    assert.deepEqual(writes, []);
  });
}

for (const [label, client] of [
  ['missing', null], ['foreign', { ...CLIENT, organizationId: 'org-b' }], ['deleted', { ...CLIENT, deletedAt: new Date() }],
]) {
  test(`${label} client returns 404 without a project query or model call`, async (t) => {
    const { app, reads, calls, writes } = await setup(t, { client });
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
    assert.deepEqual(reads.map(([model]) => model), ['client']);
    assert.equal(calls.length, 0);
    assert.deepEqual(writes, []);
  });
}

for (const role of ['CLIENT', 'BOT']) {
  test(`${role} cannot access staff previews`, async (t) => {
    const { app, reads, calls } = await setup(t, { role });
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'STAFF_REQUIRED');
    assert.deepEqual(reads, []);
    assert.deepEqual(calls, []);
  });
}

test('staff without an organization cannot query context or call a model', async (t) => {
  const { app, reads, calls } = await setup(t, { organizationId: null });
  const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(reads, []);
  assert.deepEqual(calls, []);
});

for (const [label, payload] of [
  ['extra fields', { message: 'Status?', organizationId: 'org-b', tools: ['create_ticket'] }],
  ['oversize message', { message: 'a'.repeat(2001) }],
  ['empty message', { message: '   ' }],
]) {
  test(`${label} are rejected before reads or model calls`, async (t) => {
    const { app, reads, calls } = await setup(t);
    const response = await app.inject({ method: 'POST', url: URL, payload });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(reads, []);
    assert.deepEqual(calls, []);
  });
}

test('model execution pins trusted organization, request prisma and feature over stale ambient storage', async (t) => {
  const { app, calls, prisma } = await setup(t);
  const stale = { organizationId: 'org-b', prisma: { wrong: true }, feature: 'unrelated', requestId: 'stale-id' };
  await requestStorage.run(stale, async () => {
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
    assert.equal(response.statusCode, 200);
    assert.strictEqual(requestStorage.getStore(), stale);
  });
  assert.equal(calls[0].store.organizationId, 'org-a');
  assert.strictEqual(calls[0].store.prisma, prisma);
  assert.equal(calls[0].store.feature, 'client_assistant_preview');
  assert.notEqual(calls[0].store.requestId, 'stale-id');
});

for (const [label, error, status, code] of [
  ['disabled AI', new AiDisabledError('organization'), 503, 'AI_DISABLED'],
  ['exhausted budget', new AiBudgetExceededError(), 402, 'AI_BUDGET_EXCEEDED'],
  ['unknown provider failure', new Error('SECRET-KEY and private tenant transcript'), 502, 'AI_PROVIDER_UPSTREAM'],
]) {
  test(`${label} returns its safe status and code`, async (t) => {
    const { app, calls, writes } = await setup(t, { chat: async () => { throw error; } });
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
    assert.equal(response.statusCode, status);
    assert.equal(response.json().code, code);
    assert.doesNotMatch(response.body, /SECRET-KEY|private tenant transcript|stack/);
    assert.equal(calls.length, 1);
    assert.deepEqual(writes, []);
  });
}

test('nontext model output cannot expose an action envelope', async (t) => {
  const { app, writes } = await setup(t, { chat: async () => ({ actions: [{ tool: 'create_ticket' }] }) });
  const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Create a ticket' } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().code, 'AI_PROVIDER_INVALID_RESPONSE');
  assert.equal(response.json().actions, undefined);
  assert.deepEqual(writes, []);
});

test('sixth preview within one minute is rate limited before another model call', async (t) => {
  const { app, calls } = await setup(t);
  for (let i = 0; i < 5; i++) {
    const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
    assert.equal(response.statusCode, 200);
  }
  const response = await app.inject({ method: 'POST', url: URL, payload: { message: 'Status?' } });
  assert.equal(response.statusCode, 429);
  assert.equal(calls.length, 5);
});
