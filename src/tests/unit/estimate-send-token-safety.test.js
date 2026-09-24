import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import estimateRoutes from '../../routes/estimate.routes.js';

const VIEW_TOKEN = 'estimate-view-token-7f3a9c';

function captureConsole(t) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method];
    console[method] = (...args) => { lines.push(args.map(String).join(' ')); };
    t.after(() => { console[method] = original; });
  }
  return lines;
}

test('sending an estimate without email delivery succeeds and never logs its view token', async (t) => {
  const draft = {
    id: 'estimate-a',
    status: 'DRAFT',
    viewToken: VIEW_TOKEN,
    totalAmount: 1200,
    client: { id: 'client-a', name: 'Avery Client', email: null },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' };
  });
  app.decorate('prisma', {
    estimate: {
      findUnique: async () => draft,
      update: async ({ data }) => ({ ...draft, ...data, client: { id: 'client-a', name: 'Avery Client' } }),
    },
  });
  app.addHook('onRequest', async (request) => {
    request.prisma = app.prisma;
  });
  await app.register(estimateRoutes);
  t.after(() => app.close());
  const lines = captureConsole(t);

  const response = await app.inject({ method: 'POST', url: '/estimate-a/send' });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'SENT');
  // Staff recover the client link from the authenticated response, not from logs.
  assert.equal(response.json().viewToken, VIEW_TOKEN);
  assert.ok(lines.length > 0, 'expected a non-sensitive delivery warning');
  for (const line of lines) {
    assert.ok(!line.includes(VIEW_TOKEN), `log line leaked the view token: ${line}`);
    assert.ok(!line.includes('/portal/estimate/'), `log line leaked the portal link: ${line}`);
  }
});
