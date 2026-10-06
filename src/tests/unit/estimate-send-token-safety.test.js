import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import Mailgun from 'mailgun.js';

const VIEW_TOKEN = 'estimate-view-token-7f3a9c';

// env.js reads Mailgun settings when it is first imported, so configure them
// before loading the route.
process.env.MAILGUN_API_KEY = 'test-mailgun-key';
process.env.MAILGUN_DOMAIN = 'mail.ashbi.test';
const { default: estimateRoutes } = await import('../../routes/estimate.routes.js');

function captureConsole(t) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method];
    console[method] = (...args) => { lines.push(args.map(String).join(' ')); };
    t.after(() => { console[method] = original; });
  }
  return lines;
}

// Mirrors the Prisma Estimate model: the amount is stored as `total`.
function draftEstimate(clientEmail) {
  return {
    id: 'estimate-a',
    status: 'DRAFT',
    viewToken: VIEW_TOKEN,
    subtotal: 1000,
    tax: 200,
    total: 1200,
    client: { id: 'client-a', name: 'Avery Client', email: clientEmail },
  };
}

async function buildApp(t, draft) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' };
  });
  let current = draft;
  app.decorate('prisma', {
    estimate: {
      findUnique: async () => current,
      // Send claims the draft with a conditional updateMany (status DRAFT).
      updateMany: async ({ where, data }) => {
        if (where.status && current.status !== where.status) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      },
      update: async ({ data }) => {
        current = { ...current, ...data };
        return { ...current, client: { id: 'client-a', name: 'Avery Client' } };
      },
    },
  });
  app.addHook('onRequest', async (request) => {
    request.prisma = app.prisma;
  });
  await app.register(estimateRoutes);
  t.after(() => app.close());
  return app;
}

function assertNoTokenInLogs(lines) {
  for (const line of lines) {
    assert.ok(!line.includes(VIEW_TOKEN), `log line leaked the view token: ${line}`);
    assert.ok(!line.includes('/portal/estimate/'), `log line leaked the portal link: ${line}`);
  }
}

test('sending an estimate without email delivery succeeds and never logs its view token', async (t) => {
  const app = await buildApp(t, draftEstimate(null));
  const lines = captureConsole(t);

  const response = await app.inject({ method: 'POST', url: '/estimate-a/send' });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'SENT');
  // The response says no email went out, and why, so the page never claims
  // the client was emailed.
  assert.equal(response.json().emailSent, false);
  assert.equal(response.json().emailStatus, 'NO_CLIENT_EMAIL');
  assert.ok(response.json().clientLink.endsWith(`/portal/estimate/${response.json().viewToken}`));
  // Staff recover the client link from the authenticated response, not from
  // logs. Sending rotates the draft's placeholder into a 256-bit link token.
  const { viewToken, publicAccessExpiresAt } = response.json();
  assert.notEqual(viewToken, VIEW_TOKEN);
  assert.match(viewToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(publicAccessExpiresAt) > new Date());
  assert.ok(lines.every((line) => !line.includes(viewToken)));
  assert.ok(lines.length > 0, 'expected a non-sensitive delivery warning');
  assertNoTokenInLogs(lines);
});

test('sending an estimate emails the client its amount and portal link', async (t) => {
  const sent = [];
  const originalClient = Mailgun.prototype.client;
  Mailgun.prototype.client = () => ({
    messages: { create: async (domain, message) => { sent.push({ domain, message }); return { id: 'msg-1' }; } },
  });
  t.after(() => { Mailgun.prototype.client = originalClient; });
  const app = await buildApp(t, draftEstimate('client@example.test'));
  const lines = captureConsole(t);

  const response = await app.inject({ method: 'POST', url: '/estimate-a/send' });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(sent.length, 1, `expected one email, logs: ${lines.join(' | ')}`);
  assert.equal(sent[0].domain, 'mail.ashbi.test');
  assert.equal(sent[0].message.to, 'client@example.test');
  assert.match(sent[0].message.subject, /\$1[,.\u00a0\u202f]?200/);
  assert.ok(!sent[0].message.html.includes(`/portal/estimate/${VIEW_TOKEN}`), 'the draft placeholder token is never emailed');
  assert.ok(sent[0].message.html.includes(`/portal/estimate/${response.json().viewToken}`));
  assert.equal(response.json().emailSent, true);
  assert.equal(response.json().emailStatus, 'SENT');
  assertNoTokenInLogs(lines);
});

test('a failed estimate email is reported as not sent', async (t) => {
  const originalClient = Mailgun.prototype.client;
  Mailgun.prototype.client = () => ({
    messages: { create: async () => { throw new Error('mailgun down'); } },
  });
  t.after(() => { Mailgun.prototype.client = originalClient; });
  const app = await buildApp(t, draftEstimate('client@example.test'));
  captureConsole(t);

  const response = await app.inject({ method: 'POST', url: '/estimate-a/send' });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'SENT', 'the estimate is sent and its link works');
  assert.equal(response.json().emailSent, false);
  assert.equal(response.json().emailStatus, 'FAILED');
});

test('estimateEmailSkipReason names why no email will be attempted', async () => {
  const { estimateEmailSkipReason } = await import('../../routes/estimate.routes.js');
  assert.equal(estimateEmailSkipReason({ mailConfigured: true, clientEmail: null }), 'NO_CLIENT_EMAIL');
  assert.equal(estimateEmailSkipReason({ mailConfigured: true, clientEmail: '  ' }), 'NO_CLIENT_EMAIL');
  assert.equal(estimateEmailSkipReason({ mailConfigured: false, clientEmail: 'a@b.test' }), 'EMAIL_NOT_CONFIGURED');
  assert.equal(estimateEmailSkipReason({ mailConfigured: true, clientEmail: 'a@b.test' }), null);
});

test('a delivery-status write failure after a successful send still returns success', async (t) => {
  const sent = [];
  const originalClient = Mailgun.prototype.client;
  Mailgun.prototype.client = () => ({
    messages: { create: async (domain, message) => { sent.push(message); return { id: '<msg-2@mail.ashbi.test>' }; } },
  });
  t.after(() => { Mailgun.prototype.client = originalClient; });
  const app = await buildApp(t, draftEstimate('client@example.test'));
  const originalUpdate = app.prisma.estimate.update;
  app.prisma.estimate.update = async (args) => {
    if (args.data.deliveryStatus) throw Object.assign(new Error('connection lost'), { code: 'P1001' });
    return originalUpdate(args);
  };
  const lines = captureConsole(t);

  const response = await app.inject({ method: 'POST', url: '/estimate-a/send' });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]['v:ashbi-document-id'], 'estimate-a');
  assert.equal(response.json().status, 'SENT');
  assert.equal(response.json().deliveryStatus, 'ACCEPTED');
  assertNoTokenInLogs(lines);
});
