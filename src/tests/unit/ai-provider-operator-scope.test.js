import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

// env.js reads operator emails when it is first imported, so configure them
// before loading the route.
process.env.PLATFORM_OPERATOR_EMAILS = ' Operator@Ashbi.test ';
const { default: settingsRoutes } = await import('../../routes/settings.routes.js');
const providers = await import('../../ai/providers/index.js');

const ORG_ADMIN = { id: 'user-a', email: 'admin@tenant-a.test', role: 'ADMIN', organizationId: 'org-a' };
const OPERATOR = { id: 'user-op', email: 'operator@ashbi.test', role: 'ADMIN', organizationId: 'org-ops' };
const OPERATOR_AS_MEMBER = { ...OPERATOR, role: 'MEMBER' };

async function buildApp(t, user) {
  const app = Fastify();
  const signIn = async (request) => { request.user = user; };
  app.decorate('authenticate', signIn);
  app.decorate('adminOnly', async (request, reply) => {
    await signIn(request);
    if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  app.decorate('prisma', {});
  await app.register(settingsRoutes);
  t.after(() => app.close());
  return app;
}

test('an organization admin cannot switch the deployment-wide AI provider or model', async (t) => {
  const before = { provider: providers.getProviderName(), model: providers.getOllamaModel() };
  const app = await buildApp(t, ORG_ADMIN);

  const response = await app.inject({
    method: 'POST',
    url: '/ai-provider',
    payload: { provider: 'gemini' },
  });
  const modelResponse = await app.inject({
    method: 'POST',
    url: '/ai-provider',
    payload: { provider: 'ollama', model: 'attacker-model' },
  });

  assert.equal(response.statusCode, 403, response.body);
  assert.equal(modelResponse.statusCode, 403, modelResponse.body);
  assert.equal(providers.getProviderName(), before.provider);
  assert.equal(providers.getOllamaModel(), before.model);
  assert.equal(process.env.OLLAMA_MODEL, undefined);

  const view = await app.inject({ method: 'GET', url: '/ai-provider' });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().canManage, false);
});

test('an operator email without the ADMIN role cannot switch the provider', async (t) => {
  const app = await buildApp(t, OPERATOR_AS_MEMBER);
  const response = await app.inject({ method: 'POST', url: '/ai-provider', payload: { provider: 'gemini' } });
  assert.equal(response.statusCode, 403);
  assert.notEqual(providers.getProviderName(), 'gemini');
});

test('a platform operator can switch the Ollama model and it takes effect', async (t) => {
  const app = await buildApp(t, OPERATOR);

  const view = await app.inject({ method: 'GET', url: '/ai-provider' });
  assert.equal(view.json().canManage, true);

  const response = await app.inject({
    method: 'POST',
    url: '/ai-provider',
    payload: { provider: 'ollama', model: 'qwen3:32b' },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().ollamaModel, 'qwen3:32b');
  assert.equal(providers.getProviderName(), 'ollama');
  assert.equal(providers.getProvider().modelName, 'qwen3:32b');
  assert.equal((await app.inject({ method: 'GET', url: '/ai-provider' })).json().ollamaModel, 'qwen3:32b');
});
