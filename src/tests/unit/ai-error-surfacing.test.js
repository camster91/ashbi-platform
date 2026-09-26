// AI kill switch / budget errors reach callers as clear 4xx/5xx codes, not
// generic 500s or canned answers (#413, docs/ai-byok.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { default: searchRoutes } = await import('../../routes/search.routes.js');
const { default: aiBridgeRoutes } = await import('../../routes/ai-bridge.routes.js');
const { setPlatformAiDisabled } = await import('../../ai/governance.js');
const { AiBudgetExceededError } = await import('../../ai/errors.js');

test('the real AI client path answers 503 AI_DISABLED when the platform kill switch is on', async (t) => {
  setPlatformAiDisabled(true);
  t.after(() => setPlatformAiDisabled(false));
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
