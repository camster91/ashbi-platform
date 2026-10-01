// Stripe checkout webhooks and the outbox (#412, docs/event-outbox.md): odd
// legacy invoice data never stops a payment from being recorded, and each
// way a verified delivery can fail answers Stripe with a distinct code.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

// env.js reads these on first import, so set them before loading any route.
process.env.STRIPE_SECRET_KEY = 'sk_test_outbox_unit';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_outbox_unit';

const { default: Stripe } = await import('stripe');
const { default: invoiceRoutes } = await import('../../routes/invoice.routes.js');
const { default: webhookRoutes } = await import('../../routes/webhook.routes.js');
const { handleCheckoutFailure, StripeCheckoutRejectedError } = await import('../../services/stripe.service.js');
const { DomainEventValidationError } = await import('../../services/domain-event-catalog.js');
const { enterRequestContext } = await import('../../utils/request-context.js');
const { outboxStore } = await import('../helpers/domain-event-fake.js');
import { applyInvoiceData, statusMatches } from '../helpers/fake-invoice-row.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function checkoutEvent(invoice, overrides = {}) {
  return {
    id: 'evt_outbox_1',
    type: 'checkout.session.completed',
    created: 1_786_240_000,
    data: {
      object: {
        id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid',
        amount_total: Math.round(invoice.total * 100), currency: String(invoice.currency).toLowerCase(),
        metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
        ...overrides,
      },
    },
  };
}

/** A fake database whose outbox can be made to fail. */
function database(invoice, { failEventWrite = null, clientOrganizationId = 'org-1' } = {}) {
  const outbox = outboxStore();
  const state = { invoice: { ...invoice }, payments: [] };
  const domainEvent = failEventWrite
    ? { ...outbox.domainEvent, create: async () => { throw failEventWrite; } }
    : outbox.domainEvent;
  /** @type {any} */
  const db = {
    auditEvent: { create: async ({ data }) => data },
    domainEvent,
    $executeRaw: outbox.$executeRaw,
    client: { findUnique: async () => (clientOrganizationId ? { organizationId: clientOrganizationId } : null) },
    invoice: {
      findUnique: async ({ where, select }) => (where.id === state.invoice.id
        ? (select?.client ? { client: { organizationId: 'org-1' } } : { ...state.invoice })
        : null),
      updateMany: async ({ where, data }) => {
        if (!statusMatches(state.invoice.status, where.status)) return { count: 0 };
        applyInvoiceData(state.invoice, data);
        return { count: 1 };
      },
      update: async ({ data }) => ({ ...applyInvoiceData(state.invoice, data) }),
    },
    invoicePayment: {
      aggregate: async () => ({ _sum: { amount: state.payments.reduce((sum, payment) => sum + payment.amount, 0) || null } }),
      findUnique: async ({ where }) => state.payments.find((payment) => payment.transactionId === where.transactionId) ?? null,
      create: async ({ data }) => {
        const payment = { id: `payment-${state.payments.length + 1}`, ...data };
        state.payments.push(payment);
        return payment;
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  return { db, outbox, state };
}

async function buildApp(t, routes, db) {
  const app = Fastify({ logger: false });
  // Keep the raw body for signature verification, as src/index.js does.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    /** @type {any} */ (request).rawBody = body;
    try { done(null, JSON.parse(/** @type {string} */ (body))); } catch (err) { done(/** @type {Error} */ (err)); }
  });
  app.decorate('prisma', db);
  app.decorate('authenticate', async () => {});
  app.decorate('adminOnly', async () => {});
  app.addHook('onRequest', async (request) => {
    request.prisma = db;
    enterRequestContext({ prisma: db, organizationId: null });
  });
  await app.register(routes);
  t.after(() => app.close());
  return app;
}

function signedDelivery(event) {
  const payload = JSON.stringify(event);
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }),
    },
  };
}

const LEGACY_INVOICE = {
  id: 'inv-legacy', clientId: 'legacy client #7', invoiceNumber: 'INV-7', total: 42, currency: 'Euro', status: 'SENT',
};

for (const [label, routes, url] of [
  ['/api/invoices/stripe-webhook', invoiceRoutes, '/stripe-webhook'],
  ['/api/webhooks/stripe', webhookRoutes, '/stripe'],
]) {
  test(`${label}: odd legacy invoice data still records the payment and its event`, async (t) => {
    const { db, outbox, state } = database(LEGACY_INVOICE);
    const app = await buildApp(t, routes, db);
    const response = await app.inject({ method: 'POST', url, ...signedDelivery(checkoutEvent(LEGACY_INVOICE)) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(state.invoice.status, 'PAID');
    assert.equal(state.payments.length, 1);
    assert.equal(outbox.events.length, 1);
    const { payload } = outbox.events[0];
    assert.equal(payload.currency, 'XXX');
    assert.match(payload.clientId, /^invalid-[0-9a-f]{32}$/);
    assert.deepEqual(payload.dataIssues.sort(), ['clientId', 'currency']);
    assert.equal(payload.amount, 42);
    assert.equal(outbox.events[0].causationId, 'stripe:evt_outbox_1');
  });

  test(`${label}: an infrastructure failure writing the event answers 500 so Stripe retries`, async (t) => {
    const { db } = database({ ...LEGACY_INVOICE, clientId: 'client-1', currency: 'CAD' }, {
      failEventWrite: Object.assign(new Error('Connection terminated unexpectedly'), { code: 'P1017' }),
    });
    const app = await buildApp(t, routes, db);
    const response = await app.inject({ method: 'POST', url, ...signedDelivery(checkoutEvent({ ...LEGACY_INVOICE, currency: 'CAD' })) });
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(response.json(), { error: 'Stripe payment could not be recorded', code: 'CHECKOUT_RECORDING_FAILED' });
    // In PostgreSQL the whole transaction (transition + payment) rolls back:
    // src/tests/integration/domain-events.database.test.js.
  });

  test(`${label}: a rejected outbox event answers 500 DOMAIN_EVENT_INVALID, not an invoice mismatch`, async (t) => {
    const { db } = database({ ...LEGACY_INVOICE, currency: 'CAD' }, { clientOrganizationId: null });
    const app = await buildApp(t, routes, db);
    const response = await app.inject({ method: 'POST', url, ...signedDelivery(checkoutEvent({ ...LEGACY_INVOICE, currency: 'CAD' })) });
    assert.equal(response.statusCode, 500, response.body);
    assert.equal(response.json().code, 'DOMAIN_EVENT_INVALID');
    assert.doesNotMatch(response.body, /did not match/);
  });

  test(`${label}: a session that does not match the invoice is acknowledged (200) as a mismatch, unrecorded`, async (t) => {
    const { db, state } = database({ ...LEGACY_INVOICE, currency: 'CAD' });
    const app = await buildApp(t, routes, db);
    const response = await app.inject({ method: 'POST', url, ...signedDelivery(checkoutEvent({ ...LEGACY_INVOICE, currency: 'CAD' }, { currency: 'usd' })) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { received: true, recorded: false, code: 'CHECKOUT_MISMATCH' });
    assert.equal(state.payments.length, 0);
  });

  test(`${label}: a charge above the balance is refused, alerted and kept as a payment.refused audit event`, async (t) => {
    const invoice = { ...LEGACY_INVOICE, currency: 'CAD', clientId: 'client-1' };
    const { db, state } = database(invoice);
    // A manual payment landed after the session was priced at the full total.
    state.payments.push({ id: 'manual-1', invoiceId: invoice.id, amount: 2, method: 'BANK', transactionId: null });
    const audits = [];
    db.auditEvent = { create: async ({ data }) => { audits.push(data); return data; } };
    const app = await buildApp(t, routes, db);
    const response = await app.inject({ method: 'POST', url, ...signedDelivery(checkoutEvent(invoice)) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { received: true, recorded: false, code: 'CHECKOUT_BALANCE_CHANGED' });
    assert.equal(state.payments.length, 1);
    assert.deepEqual(audits.map((row) => [row.action, row.entityType, row.entityId, row.actorType]), [['payment.refused', 'invoice', invoice.id, 'WEBHOOK']]);
    assert.deepEqual(audits[0].metadata, { code: 'CHECKOUT_BALANCE_CHANGED', amount: 42, currency: 'cad', stripeEventId: 'evt_outbox_1', transactionId: 'pi_1' });
  });
}

test('handleCheckoutFailure logs a distinct code and alerts where a human must act', async () => {
  const logs = [];
  const alerts = [];
  const log = { warn: (fields, message) => logs.push(['warn', fields.code, message]), error: (fields, message) => logs.push(['error', fields.code, message]) };
  const alert = async (event) => { alerts.push(event.event); return { delivered: true }; };
  const event = { id: 'evt_1', data: { object: { metadata: { invoiceId: 'inv-1' } } } };

  const cases = [
    [new DomainEventValidationError('Invalid invoice.paid v1 payload'), 500, 'DOMAIN_EVENT_INVALID'],
    [new StripeCheckoutRejectedError('Stripe paid amount does not match invoice'), 200, 'CHECKOUT_MISMATCH'],
    [new StripeCheckoutRejectedError('Invoice was already paid by another transaction', 'INVOICE_ALREADY_PAID'), 200, 'INVOICE_ALREADY_PAID'],
    [new StripeCheckoutRejectedError('Stripe paid more than the invoice balance', 'CHECKOUT_BALANCE_CHANGED'), 200, 'CHECKOUT_BALANCE_CHANGED'],
    [new Error('connect ECONNREFUSED'), 500, 'CHECKOUT_RECORDING_FAILED'],
  ];
  for (const [err, statusCode, code] of cases) {
    const result = handleCheckoutFailure(err, { event, route: '/api/webhooks/stripe', log, alert });
    assert.deepEqual([result.statusCode, result.code], [statusCode, code]);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(alerts, ['domain_event_invalid', 'stripe_checkout_invoice_already_paid', 'stripe_checkout_balance_changed']);
  assert.deepEqual(logs.map(([level, code]) => [level, code]), [
    ['error', 'DOMAIN_EVENT_INVALID'],
    ['warn', 'CHECKOUT_MISMATCH'],
    ['error', 'INVOICE_ALREADY_PAID'],
    ['error', 'CHECKOUT_BALANCE_CHANGED'],
    ['error', 'CHECKOUT_RECORDING_FAILED'],
  ]);
});
