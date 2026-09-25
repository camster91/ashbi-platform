// Every instrumented revenue, auth and admin path emits exactly the audit
// event documented in docs/audit-events.md, and a failing audit store never
// breaks the business action.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import bcrypt from 'bcrypt';

// env.js reads these on first import, so set them before loading any route.
process.env.PLATFORM_OPERATOR_USER_IDS = 'user-op';
process.env.CONTRACT_SIGNATURE_SECRET = 'audit-emission-signature-secret';

const { default: invoiceRoutes } = await import('../../routes/invoice.routes.js');
const { default: proposalRoutes } = await import('../../routes/proposal.routes.js');
const { default: contractRoutes } = await import('../../routes/contract.routes.js');
const { default: teamRoutes } = await import('../../routes/team.routes.js');
const { default: authRoutes } = await import('../../routes/auth.routes.js');
const { default: apiKeyRoutes } = await import('../../routes/api-key.routes.js');
const { default: settingsRoutes } = await import('../../routes/settings.routes.js');
const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');
const { recordCheckoutAuditEvents } = await import('../../services/stripe.service.js');
const providers = await import('../../ai/providers/index.js');

const ADMIN = { id: 'admin-1', role: 'ADMIN', organizationId: 'org-1' };
const FUTURE = new Date(Date.now() + 86_400_000);

function auditStore({ failing = false } = {}) {
  const events = [];
  return {
    events,
    create: async ({ data }) => {
      if (failing) throw new Error('audit store unavailable');
      events.push(data);
      return { id: `audit-${events.length}`, ...data };
    },
  };
}

async function buildApp(t, routes, prisma, { user = ADMIN, prefix, decorate = {}, jwtPlugins = false } = {}) {
  const app = Fastify({ logger: false });
  if (jwtPlugins) {
    await app.register(cookie);
    await app.register(jwt, { secret: 'audit-emission-jwt', cookie: { cookieName: 'token', signed: false } });
  }
  const signIn = async (request) => { request.user = user; };
  app.decorate('authenticate', signIn);
  app.decorate('adminOnly', async (request, reply) => {
    await signIn(request);
    if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  app.decorate('prisma', prisma);
  for (const [name, value] of Object.entries(decorate)) app.decorate(name, value);
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(routes, prefix ? { prefix } : {});
  t.after(() => app.close());
  return app;
}

function draftInvoice(overrides = {}) {
  return {
    id: 'inv-1', status: 'DRAFT', total: 113, currency: 'CAD', invoiceNumber: 'INV-1', dueDate: FUTURE,
    client: { id: 'client-1', name: 'Acme', contacts: [] }, lineItems: [], ...overrides,
  };
}

test('sending an invoice emits invoice.sent with the correlation id', async (t) => {
  const audit = auditStore();
  const app = await buildApp(t, invoiceRoutes, {
    auditEvent: audit,
    invoice: {
      findUnique: async () => draftInvoice(),
      update: async ({ data }) => ({ ...draftInvoice(), ...data, client: { id: 'client-1', name: 'Acme' } }),
    },
  });
  const response = await app.inject({ method: 'POST', url: '/inv-1/send', payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(audit.events.length, 1);
  const [event] = audit.events;
  assert.equal(event.action, 'invoice.sent');
  assert.equal(event.entityType, 'invoice');
  assert.equal(event.entityId, 'inv-1');
  assert.equal(event.organizationId, 'org-1');
  assert.equal(event.actorUserId, 'admin-1');
  assert.equal(event.actorType, 'USER');
  assert.match(event.requestId, /^req-/);
  assert.deepEqual(event.metadata, { fromStatus: 'DRAFT', toStatus: 'SENT', deliveryAccepted: false, paymentLinkAttached: false, total: 113, currency: 'CAD' });
});

test('a failing audit store does not fail the invoice send', async (t) => {
  const app = await buildApp(t, invoiceRoutes, {
    auditEvent: auditStore({ failing: true }),
    invoice: {
      findUnique: async () => draftInvoice(),
      update: async ({ data }) => ({ ...draftInvoice(), ...data }),
    },
  });
  const response = await app.inject({ method: 'POST', url: '/inv-1/send', payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'SENT');
});

test('marking an invoice paid emits invoice.paid and payment.recorded', async (t) => {
  const audit = auditStore();
  const invoice = draftInvoice({ status: 'SENT' });
  const tx = {
    invoice: { update: async ({ data }) => ({ ...invoice, ...data }) },
    invoicePayment: { create: async ({ data }) => ({ id: 'pay-1', ...data }) },
  };
  const app = await buildApp(t, invoiceRoutes, {
    auditEvent: audit,
    invoice: { findUnique: async () => invoice },
    $transaction: async (fn) => fn(tx),
  });
  const response = await app.inject({ method: 'POST', url: '/inv-1/mark-paid', payload: { paymentMethod: 'CHEQUE', amount: 113, paymentNotes: 'cheque #12' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'PAID');
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityType, event.entityId]), [
    ['invoice.paid', 'invoice', 'inv-1'],
    ['payment.recorded', 'invoice_payment', 'pay-1'],
  ]);
  assert.deepEqual(audit.events[1].metadata, { invoiceId: 'inv-1', amount: 113, method: 'CHEQUE', source: 'manual', bulk: false, currency: 'CAD' });
  assert.doesNotMatch(JSON.stringify(audit.events), /cheque #12/, 'free-text payment notes are not copied into the audit log');
});

test('bulk actions emit one event per changed invoice', async (t) => {
  const audit = auditStore();
  const invoices = { 'inv-a': draftInvoice({ id: 'inv-a', status: 'SENT' }), 'inv-b': draftInvoice({ id: 'inv-b', status: 'PAID' }) };
  const app = await buildApp(t, invoiceRoutes, {
    auditEvent: audit,
    invoice: {
      findUnique: async ({ where }) => invoices[where.id] ?? null,
      update: async ({ where, data }) => ({ ...invoices[where.id], ...data }),
    },
    invoicePayment: { create: async ({ data }) => ({ id: `pay-${data.invoiceId}`, ...data }) },
    $transaction: async (operations) => Promise.all(operations),
  });
  const response = await app.inject({ method: 'POST', url: '/bulk/mark-paid', payload: { ids: ['inv-a', 'inv-b'] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { updated: 1 });
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityId, event.metadata.bulk]), [
    ['invoice.paid', 'inv-a', true],
    ['payment.recorded', 'pay-inv-a', true],
  ]);

  audit.events.length = 0;
  invoices['inv-a'] = draftInvoice({ id: 'inv-a' });
  const sent = await app.inject({ method: 'POST', url: '/bulk/send', payload: { ids: ['inv-a', 'inv-b'] } });
  assert.deepEqual(sent.json(), { sent: 1 });
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityId]), [['invoice.sent', 'inv-a']]);
});

test('a settled Stripe checkout is audited as a webhook actor; a replay is not', async () => {
  const audit = auditStore();
  const prisma = {
    auditEvent: audit,
    invoice: { findUnique: async () => ({ client: { organizationId: 'org-9' } }) },
    invoicePayment: { findUnique: async ({ where }) => (where.transactionId === 'pi_1' ? { id: 'pay-9', amount: 50 } : null) },
  };
  const event = { id: 'evt_1', data: { object: { id: 'cs_1', payment_intent: 'pi_1', currency: 'cad' } } };
  await recordCheckoutAuditEvents(prisma, { id: 'req-9', ip: '198.51.100.1' }, event, { duplicate: true, invoiceId: 'inv-9' });
  assert.equal(audit.events.length, 0);
  await recordCheckoutAuditEvents(prisma, { id: 'req-9', ip: '198.51.100.1' }, event, { duplicate: false, invoiceId: 'inv-9' });
  assert.deepEqual(audit.events.map((row) => [row.action, row.entityId, row.actorType, row.organizationId, row.actorUserId]), [
    ['invoice.paid', 'inv-9', 'WEBHOOK', 'org-9', null],
    ['payment.recorded', 'pay-9', 'WEBHOOK', 'org-9', null],
  ]);
  assert.equal(audit.events[1].metadata.stripeEventId, 'evt_1');
  assert.equal(audit.events[0].requestId, 'req-9');
});

test('a client approving a proposal by link emits proposal.approved in the owner tenant', async (t) => {
  const audit = auditStore();
  const proposal = { id: 'prop-1', clientId: 'client-1', status: 'SENT', total: 5000, publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null };
  const app = await buildApp(t, proposalRoutes, {
    auditEvent: audit,
    client: { findUnique: async ({ where }) => (where.id === 'client-1' ? { organizationId: 'org-owner' } : null) },
    proposal: {
      findUnique: async () => proposal,
      update: async ({ data }) => ({ ...proposal, ...data }),
    },
  }, { user: null });
  const response = await app.inject({ method: 'POST', url: '/client/view-token/approve' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].action, 'proposal.approved');
  assert.equal(audit.events[0].actorType, 'CLIENT');
  assert.equal(audit.events[0].actorUserId, null);
  assert.equal(audit.events[0].organizationId, 'org-owner');
  assert.equal(audit.events[0].entityId, 'prop-1');
});

test('signing a contract emits contract.signed without the signer name', async (t) => {
  const audit = auditStore();
  const contract = { id: 'k-1', clientId: 'client-1', status: 'SENT', content: 'terms', publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null };
  const app = await buildApp(t, contractRoutes, {
    auditEvent: audit,
    client: { findUnique: async () => ({ organizationId: 'org-owner' }) },
    contract: { findUnique: async () => contract, updateMany: async () => ({ count: 1 }) },
  }, { user: null });
  const response = await app.inject({ method: 'POST', url: '/sign/sign-token', payload: { signerName: 'Jane Signer', agreement: true } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].action, 'contract.signed');
  assert.equal(audit.events[0].organizationId, 'org-owner');
  assert.equal(audit.events[0].metadata.signingMethod, 'type');
  assert.match(audit.events[0].metadata.documentHash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(audit.events), /Jane Signer/);
});

test('team changes emit role, deactivation and password-reset events only on real transitions', async (t) => {
  const audit = auditStore();
  let stored = { id: 'user-2', role: 'STAFF', isActive: true, name: 'Sam', email: 's@x.test', skills: '[]', capacity: 100 };
  const app = await buildApp(t, teamRoutes, {
    auditEvent: audit,
    user: {
      findUnique: async () => ({ role: stored.role, isActive: stored.isActive }),
      update: async ({ data }) => { stored = { ...stored, ...data }; return stored; },
    },
  });
  await app.inject({ method: 'PUT', url: '/user-2', payload: { name: 'Sam B' } });
  await app.inject({ method: 'PUT', url: '/user-2', payload: { role: 'STAFF' } });
  assert.equal(audit.events.length, 0, 'no transition, no event');

  await app.inject({ method: 'PUT', url: '/user-2', payload: { role: 'ADMIN', isActive: false } });
  await app.inject({ method: 'PUT', url: '/user-2', payload: { isActive: true } });
  const reset = await app.inject({ method: 'POST', url: '/user-2/reset-password', payload: { newPassword: 'a-new-password-1' } });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityId]), [
    ['user.role_changed', 'user-2'],
    ['user.deactivated', 'user-2'],
    ['user.reactivated', 'user-2'],
    ['auth.password_changed', 'user-2'],
  ]);
  assert.deepEqual(audit.events[0].metadata, { fromRole: 'STAFF', toRole: 'ADMIN' });
  assert.deepEqual(audit.events[3].metadata, { method: 'admin_reset' });
  assert.doesNotMatch(JSON.stringify(audit.events), /a-new-password-1/);
});

test('auth emits login_failed for known accounts only, and password changes', async (t) => {
  const audit = auditStore();
  const hash = await bcrypt.hash('current-password', 4);
  const accounts = { 'known@x.test': { id: 'user-5', organizationId: 'org-5', isActive: true, password: hash, email: 'known@x.test' } };
  const prisma = {
    auditEvent: audit,
    user: {
      findUnique: async ({ where }) => (where.email ? accounts[where.email] ?? null : accounts['known@x.test']),
      findFirst: async () => ({ ...accounts['known@x.test'] }),
      update: async () => ({}),
    },
  };
  const app = await buildApp(t, authRoutes, prisma, {
    user: { id: 'user-5', role: 'TEAM', organizationId: 'org-5' },
    decorate: { auth: { login: async () => { throw new Error('Invalid credentials'); } } },
  });

  const known = await app.inject({ method: 'POST', url: '/login', payload: { email: 'Known@x.test', password: 'wrong' } });
  const unknown = await app.inject({ method: 'POST', url: '/login', payload: { email: 'nobody@x.test', password: 'wrong' } });
  assert.equal(known.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(known.json(), unknown.json(), 'responses stay indistinguishable');
  await new Promise((resolve) => setTimeout(resolve, 20)); // the failure audit is not awaited by design
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityId, event.organizationId, event.actorUserId]), [
    ['auth.login_failed', 'user-5', 'org-5', null],
  ]);
  assert.deepEqual(audit.events[0].metadata, { portal: 'staff', accountActive: true });
  assert.doesNotMatch(JSON.stringify(audit.events), /known@x\.test|wrong/i);

  audit.events.length = 0;
  const changed = await app.inject({ method: 'POST', url: '/change-password', payload: { currentPassword: 'current-password', newPassword: 'brand-new-password' } });
  assert.equal(changed.statusCode, 200, changed.body);
  const reset = await app.inject({ method: 'POST', url: '/reset-password', payload: { token: 'reset-token', newPassword: 'brand-new-password' } });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityId, event.metadata.method]), [
    ['auth.password_changed', 'user-5', 'self_service'],
    ['auth.password_changed', 'user-5', 'reset_link'],
  ]);
});

test('API key creation and revocation are audited without the key material', async (t) => {
  const audit = auditStore();
  let created;
  const app = await buildApp(t, apiKeyRoutes, {
    auditEvent: audit,
    apiKey: {
      count: async () => 0,
      create: async ({ data }) => { created = { id: 'key-1', createdAt: new Date(), ...data }; return created; },
      findUnique: async () => ({ id: 'key-1', userId: 'admin-1' }),
      update: async () => ({}),
    },
  });
  const response = await app.inject({ method: 'POST', url: '/', payload: { name: 'CI' } });
  assert.equal(response.statusCode, 200, response.body);
  const revoked = await app.inject({ method: 'DELETE', url: '/key-1' });
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(audit.events.map((event) => [event.action, event.entityType, event.entityId]), [
    ['api_key.created', 'api_key', 'key-1'],
    ['api_key.revoked', 'api_key', 'key-1'],
  ]);
  const serialized = JSON.stringify(audit.events);
  assert.doesNotMatch(serialized, new RegExp(response.json().key));
  assert.doesNotMatch(serialized, new RegExp(created.key));
});

test('a platform operator switching the AI provider is audited', async (t) => {
  const audit = auditStore();
  const before = { provider: providers.getProviderName(), model: providers.getOllamaModel() };
  t.after(() => providers.setProvider(before.provider, { model: before.model }));
  const app = await buildApp(t, settingsRoutes, {
    auditEvent: audit,
    user: { findUnique: async () => ({ role: 'ADMIN', isActive: true }) },
  }, { user: { id: 'user-op', role: 'ADMIN', organizationId: 'org-ops' } });
  const target = before.provider === 'gemini' ? 'claude' : 'gemini';
  const response = await app.inject({ method: 'POST', url: '/ai-provider', payload: { provider: target } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].action, 'settings.ai_provider_changed');
  assert.equal(audit.events[0].organizationId, 'org-ops');
  assert.equal(audit.events[0].metadata.fromProvider, before.provider);
  assert.equal(audit.events[0].metadata.toProvider, target);
});

test('a client deleting a portal document is audited as a CLIENT actor', async (t) => {
  const audit = auditStore();
  const portalUser = { id: 'portal-user', email: 'c@x.test', name: 'C', role: 'CLIENT', clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1 };
  const prisma = {
    auditEvent: audit,
    user: { findUnique: async ({ where }) => (where.id === portalUser.id ? portalUser : null) },
    contact: { findFirst: async () => ({ id: 'contact-a', email: portalUser.email, clientId: 'client-a' }) },
    client: { findFirst: async () => ({ id: 'client-a', organizationId: 'org-a' }) },
    attachment: {
      findUnique: async () => ({ id: 'doc-1', entityType: 'PROJECT', entityId: 'proj-1', path: 'uploads/none-such-file', mimeType: 'application/pdf', size: 42, filename: 'secret-plan.pdf' }),
      delete: async () => ({}),
    },
    project: { findFirst: async () => ({ id: 'proj-1' }) },
  };
  const app = await buildApp(t, clientPortalRoutes, prisma, { user: null, jwtPlugins: true });
  const token = app.jwt.sign({ ...portalUser, contactId: 'contact-a' }, { expiresIn: '1h' });
  const response = await app.inject({ method: 'DELETE', url: '/documents/doc-1', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(audit.events.length, 1);
  assert.deepEqual(
    [audit.events[0].action, audit.events[0].actorType, audit.events[0].actorUserId, audit.events[0].organizationId, audit.events[0].entityType],
    ['client_portal.document_deleted', 'CLIENT', 'portal-user', 'org-a', 'attachment'],
  );
  assert.deepEqual(audit.events[0].metadata, { projectId: 'proj-1', clientId: 'client-a', mimeType: 'application/pdf', size: 42 });
});
