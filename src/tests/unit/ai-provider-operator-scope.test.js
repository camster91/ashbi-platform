import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

// env.js reads operator ids when it is first imported, so configure them
// before loading the route.
process.env.PLATFORM_OPERATOR_USER_IDS = ' user-op , user-demoted ';
const { default: settingsRoutes } = await import('../../routes/settings.routes.js');
const providers = await import('../../ai/providers/index.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');

const ORG_ADMIN = { id: 'user-a', email: 'user-op@tenant-a.test', role: 'ADMIN', organizationId: 'org-a' };
const OPERATOR = { id: 'user-op', email: 'ops@ashbi.test', role: 'ADMIN', organizationId: 'org-ops' };
// Signed in while still ADMIN, then demoted: the token still says ADMIN.
const DEMOTED_OPERATOR = { id: 'user-demoted', email: 'old-ops@ashbi.test', role: 'ADMIN', organizationId: 'org-ops' };

const ACCOUNTS = {
  'user-a': { role: 'ADMIN', isActive: true },
  'user-op': { role: 'ADMIN', isActive: true },
  'user-demoted': { role: 'TEAM', isActive: true },
};

function stubOllamaModelList(t, names) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ models: names.map((name) => ({ name })) }) });
  t.after(() => { globalThis.fetch = originalFetch; });
}

async function buildApp(t, user) {
  const app = Fastify();
  await app.register(cookie);
  const principal = withSession(user);
  const signIn = async (request) => { request.user = principal; };
  app.decorate('authenticate', signIn);
  app.decorate('adminOnly', async (request, reply) => {
    await signIn(request);
    if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  const prisma = {
    user: { findUnique: async ({ where }) => ACCOUNTS[where.id] ?? null },
  };
  app.decorate('prisma', prisma);
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(settingsRoutes);
  t.after(() => app.close());
  return app;
}

function snapshot() {
  return { provider: providers.getProviderName(), model: providers.getOllamaModel(), env: process.env.OLLAMA_MODEL };
}

test('an organization admin cannot switch the deployment-wide AI provider or model', async (t) => {
  const before = snapshot();
  const app = await buildApp(t, ORG_ADMIN);

  const response = await app.inject({ method: 'POST', url: '/ai-provider', cookies: reauthCookies(ORG_ADMIN), payload: { provider: 'gemini' } });
  const modelResponse = await app.inject({
    method: 'POST',
    url: '/ai-provider',
    cookies: reauthCookies(ORG_ADMIN),
    payload: { provider: 'ollama', model: 'attacker-model' },
  });

  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().code, undefined, 'refused as a non-operator, not for missing re-authentication');
  assert.equal(modelResponse.statusCode, 403, modelResponse.body);
  assert.deepEqual(snapshot(), before);

  const view = await app.inject({ method: 'GET', url: '/ai-provider' });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().canManage, false);
});

test('a listed operator who has since been demoted cannot switch the provider', async (t) => {
  const before = snapshot();
  const app = await buildApp(t, DEMOTED_OPERATOR);

  const response = await app.inject({ method: 'POST', url: '/ai-provider', cookies: reauthCookies(DEMOTED_OPERATOR), payload: { provider: 'gemini' } });

  assert.equal(response.statusCode, 403, response.body);
  assert.deepEqual(snapshot(), before);
});

test('a platform operator cannot save a model name the provider does not offer', async (t) => {
  stubOllamaModelList(t, ['glm-4.6:cloud']);
  const before = snapshot();
  const app = await buildApp(t, OPERATOR);

  const position = await app.inject({ method: 'POST', url: '/ai-provider', cookies: reauthCookies(OPERATOR), payload: { provider: 'ollama', model: '0' } });
  const malformed = await app.inject({ method: 'POST', url: '/ai-provider', cookies: reauthCookies(OPERATOR), payload: { provider: 'ollama', model: 'bad model;' } });

  assert.equal(position.statusCode, 400, position.body);
  assert.equal(malformed.statusCode, 400, malformed.body);
  assert.deepEqual(snapshot(), before);
});

test('a platform operator can switch the Ollama model and it takes effect', async (t) => {
  stubOllamaModelList(t, ['glm-4.6:cloud']);
  const app = await buildApp(t, OPERATOR);

  const view = await app.inject({ method: 'GET', url: '/ai-provider' });
  assert.equal(view.json().canManage, true);

  const response = await app.inject({
    method: 'POST',
    url: '/ai-provider',
    cookies: reauthCookies(OPERATOR),
    payload: { provider: 'ollama', model: 'glm-4.6:cloud' },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().ollamaModel, 'glm-4.6:cloud');
  assert.equal(providers.getProviderName(), 'ollama');
  assert.equal(providers.getProvider().modelName, 'glm-4.6:cloud');
  assert.equal((await app.inject({ method: 'GET', url: '/ai-provider' })).json().ollamaModel, 'glm-4.6:cloud');
});

test('a platform operator must have re-authenticated recently to switch the provider', async (t) => {
  const before = snapshot();
  const app = await buildApp(t, OPERATOR);

  const response = await app.inject({ method: 'POST', url: '/ai-provider', payload: { provider: 'gemini' } });

  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().code, 'REAUTH_REQUIRED');
  assert.deepEqual(snapshot(), before);
});

test('only a re-authenticated platform operator can flip the deployment AI kill switch', async (t) => {
  const { getPlatformAiStatus, setPlatformAiDisabled } = await import('../../ai/governance.js');
  t.after(() => setPlatformAiDisabled(false));

  const orgAdmin = await buildApp(t, ORG_ADMIN);
  const denied = await orgAdmin.inject({ method: 'POST', url: '/ai-kill-switch', cookies: reauthCookies(ORG_ADMIN), payload: { disabled: true } });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(getPlatformAiStatus().disabled, false);

  const operator = await buildApp(t, OPERATOR);
  const noStepUp = await operator.inject({ method: 'POST', url: '/ai-kill-switch', payload: { disabled: true } });
  assert.equal(noStepUp.json().code, 'REAUTH_REQUIRED');
  assert.equal(getPlatformAiStatus().disabled, false);

  const off = await operator.inject({ method: 'POST', url: '/ai-kill-switch', cookies: reauthCookies(OPERATOR), payload: { disabled: true } });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().platformAi.disabled, true);
  assert.equal((await operator.inject({ method: 'GET', url: '/ai-provider' })).json().platformAi.runtimeDisabled, true);

  const on = await operator.inject({ method: 'POST', url: '/ai-kill-switch', cookies: reauthCookies(OPERATOR), payload: { disabled: false } });
  assert.equal(on.json().platformAi.disabled, false);
});
