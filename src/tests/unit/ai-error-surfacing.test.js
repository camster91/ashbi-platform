// AI kill switch / budget errors reach callers as clear 4xx/5xx codes, not
// generic 500s or canned answers (#413, docs/ai-byok.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { default: searchRoutes } = await import('../../routes/search.routes.js');
const { default: aiBridgeRoutes } = await import('../../routes/ai-bridge.routes.js');
const { AiBudgetExceededError, AiDisabledError, AiProviderError } = await import('../../ai/errors.js');
const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const { requestStorage } = await import('../../utils/request-context.js');

test('the real AI client path answers 503 AI_DISABLED when the platform kill switch is on', async (t) => {
  const db = createFakeAiDb();
  db.platformSetting.rows.push({ id: 'platform', aiDisabled: true });
  t.after(await installFakeGovernance(db));
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'ADMIN' }; });
  app.addHook('preHandler', async (request) => { request.prisma = {}; });
  await app.register(searchRoutes);
  t.after(() => app.close());

  // Short words only: no context lookups, straight to the AI call.
  const response = await app.inject({ method: 'POST', url: '/ask', payload: { question: 'why now' } });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, 'AI_DISABLED');
  assert.match(response.json().error, /turned off/);
});

test('the AI bridge reports a budget stop in the OpenAI error shape', async (t) => {
  const app = Fastify();
  const empty = { findMany: async () => [] };
  const prisma = { project: empty, task: empty, client: empty, chatMessage: empty, retainerPlan: empty };
  app.decorate('authenticateWithApiKey', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'TEAM' };
    request.apiKeyScopes = ['ai_bridge:read'];
  });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(aiBridgeRoutes, { chatClient: { chat: async () => { throw new AiBudgetExceededError(); } } });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(response.statusCode, 402, response.body);
  assert.equal(response.json().error.code, 'AI_BUDGET_EXCEEDED');
});

test('semantic search answers 503 AI_DISABLED instead of embedding when the organization turned AI off', async (t) => {
  const db = createFakeAiDb({ organizations: [{ id: 'org-a', aiDisabled: true }] });
  t.after(await installFakeGovernance(db));
  const originalFetch = globalThis.fetch;
  let embedCalls = 0;
  globalThis.fetch = async () => { embedCalls += 1; throw new Error('must not embed'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { default: semanticSearchRoutes } = await import('../../routes/semantic-search.routes.js');
  const { toClientErrorBody } = await import('../../utils/http-errors.js');
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'ADMIN' }; request.organizationId = 'org-a'; });
  app.addHook('preHandler', async (request) => { requestStorage.enterWith({ organizationId: 'org-a', prisma: {} }); });
  app.setErrorHandler((error, _request, reply) => reply.status(error.statusCode || 500).send(toClientErrorBody(error)));
  await app.register(semanticSearchRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/search?q=brand%20colours' });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, 'AI_DISABLED');
  assert.equal(embedCalls, 0);
});

test('Ash chat returns the saved conversation id when AI fails after the message was stored', async (t) => {
  // The kill-switch pre-check passes; the call itself is refused (as when
  // the budget runs out or the switch flips mid-request).
  const db = createFakeAiDb();
  t.after(await installFakeGovernance(db, {
    platformProvider: () => ({}),
    beforeCall: () => { throw new AiDisabledError('organization'); },
  }));
  const { default: ashChatRoutes } = await import('../../routes/ash-chat.routes.js');
  const saved = [];
  const prisma = {
    ashConversation: { create: async () => ({ id: 'conv-1' }), findUnique: async () => null, update: async () => ({}) },
    ashChatMessage: {
      create: async ({ data }) => { saved.push(data); return { id: `m${saved.length}`, ...data }; },
      findMany: async () => saved.map((row) => ({ ...row })),
    },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'ADMIN' }; });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; requestStorage.enterWith({ organizationId: 'org-a', prisma }); });
  await app.register(ashChatRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/message', payload: { message: 'hello' } });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, 'AI_DISABLED');
  assert.equal(response.json().conversationId, 'conv-1');
  assert.equal(saved.length, 1, 'only the user message was stored');
});

test('email triage skips per-item provider failures and stops on AI_DISABLED / AI_BUDGET_EXCEEDED', async (t) => {
  const { default: emailTriageRoutes } = await import('../../routes/email-triage.routes.js');
  const aiClient = (await import('../../ai/client.js')).default;
  const threads = ['t1', 't2', 't3'].map((id) => ({ id, subject: id, messages: [{ senderEmail: 'a@b.test', bodyText: 'hi' }] }));
  const created = [];
  const prisma = {
    thread: { findMany: async () => threads },
    emailTriageItem: { findMany: async () => [], create: async ({ data }) => { created.push(data); return { id: `i-${data.threadId}`, ...data }; } },
  };
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async () => {});
  await app.register(emailTriageRoutes);
  t.after(() => app.close());

  const originalChatJSON = aiClient.chatJSON;
  t.after(() => { aiClient.chatJSON = originalChatJSON; });

  const outcomes = [new AiProviderError('rate_limit'), { tags: ['client'], summary: 'ok' }, new AiProviderError('timeout')];
  aiClient.chatJSON = async () => { const next = outcomes.shift(); if (next instanceof Error) throw next; return next; };
  const partial = await app.inject({ method: 'POST', url: '/scan', payload: {} });
  assert.equal(partial.statusCode, 200, partial.body);
  assert.deepEqual({ scanned: partial.json().scanned, triaged: partial.json().triaged, failed: partial.json().failed }, { scanned: 3, triaged: 1, failed: 2 });

  for (const error of [new AiDisabledError('organization'), new AiBudgetExceededError()]) {
    let calls = 0;
    aiClient.chatJSON = async () => { calls += 1; throw error; };
    const stopped = await app.inject({ method: 'POST', url: '/scan', payload: {} });
    assert.equal(stopped.statusCode, error.statusCode);
    assert.equal(stopped.json().code, error.code);
    assert.equal(calls, 1, 'the scan stops at the first thread');
  }
});
