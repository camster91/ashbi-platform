// POST /api/ai/generate-proposal reads the fields its schema accepts
// (aiGenerateProposalSchema: clientId, projectId, brief, budget, deadline) and
// resolves the client inside the organization. The SPA proposal generator
// (web/src/pages/Proposals.jsx) calls it through api.generateProposal.
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import Fastify from 'fastify';

const { default: aiRoutes } = await import('../../routes/ai.routes.js');
const { default: aiClient } = await import('../../ai/client.js');

async function buildApp(t, prisma) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'ADMIN' }; });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(aiRoutes);
  t.after(() => app.close());
  return app;
}

test('generate-proposal writes for the scoped client with the brief and budget', async (t) => {
  const prompts = [];
  mock.method(aiClient, 'chat', async ({ prompt }) => { prompts.push(prompt); return 'Proposal text'; });
  t.after(() => mock.restoreAll());
  const lookups = [];
  const app = await buildApp(t, {
    client: { findUnique: async (args) => { lookups.push(args.where); return { id: 'c1', name: 'Acme Foods' }; } },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/generate-proposal',
    payload: { clientId: 'c1', brief: 'Project type: Branding\nTone: Professional', budget: 5000 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { proposal: 'Proposal text', clientId: 'c1', clientName: 'Acme Foods' });
  assert.deepEqual(lookups, [{ id: 'c1' }]);
  assert.match(prompts[0], /Client: Acme Foods/);
  assert.match(prompts[0], /Brief: Project type: Branding/);
  assert.match(prompts[0], /Budget: \$5,000/);
});

test('generate-proposal answers 404 for a client outside the organization and 400 without a clientId', async (t) => {
  const chat = mock.method(aiClient, 'chat', async () => 'never');
  t.after(() => mock.restoreAll());
  const app = await buildApp(t, { client: { findUnique: async () => null } });

  const missing = await app.inject({ method: 'POST', url: '/generate-proposal', payload: { clientId: 'other-org-client' } });
  assert.equal(missing.statusCode, 404, missing.body);
  const legacy = await app.inject({ method: 'POST', url: '/generate-proposal', payload: { clientName: 'Acme', projectType: 'branding' } });
  assert.equal(legacy.statusCode, 400, legacy.body);
  assert.equal(chat.mock.callCount(), 0);
});
