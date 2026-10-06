// A voided invoice can never be settled by a stale Stripe Checkout session
// (S4): completion only settles SENT/OVERDUE invoices; a payment for a VOID
// invoice is acknowledged (200) and alerted as INVOICE_VOID, never flipped to
// PAID; voiding expires the stored session and forgets it.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { expireCheckoutSession, handleCheckoutFailure, recordCompletedCheckout, StripeCheckoutRejectedError } from '../../services/stripe.service.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { outboxStore } from '../helpers/domain-event-fake.js';
import { applyInvoiceData, statusMatches } from '../helpers/fake-invoice-row.js';

function checkoutEvent() {
  return {
    id: 'evt_void', created: 1_786_240_000,
    data: { object: {
      id: 'cs_void', payment_intent: 'pi_void', payment_status: 'paid', amount_total: 11300, currency: 'cad',
      metadata: { invoiceId: 'invoice-1', invoiceNumber: 'INV-001' },
    } },
  };
}

function settlementHarness(status) {
  const outbox = outboxStore();
  const state = { invoice: { id: 'invoice-1', invoiceNumber: 'INV-001', clientId: 'client-1', total: 113, currency: 'CAD', status }, payments: [], events: outbox.events };
  const tx = {
    invoice: {
      findUnique: async () => ({ ...state.invoice }),
      updateMany: async ({ where, data }) => {
        if (!statusMatches(state.invoice.status, where.status)) return { count: 0 };
        applyInvoiceData(state.invoice, data);
        return { count: 1 };
      },
      update: async ({ data }) => ({ ...applyInvoiceData(state.invoice, data) }),
    },
    invoicePayment: {
      aggregate: async () => ({ _sum: { amount: null } }),
      findUnique: async () => null,
      create: async ({ data }) => { state.payments.push(data); return { id: 'pay-1', ...data }; },
    },
    client: { findUnique: async () => ({ organizationId: 'org-1' }) },
    domainEvent: outbox.domainEvent,
    $executeRaw: outbox.$executeRaw,
  };
  return { state, prisma: { $transaction: (callback) => callback(tx) } };
}

test('a completed checkout never settles a VOID invoice', async () => {
  const { state, prisma } = settlementHarness('VOID');
  const error = await recordCompletedCheckout(prisma, checkoutEvent()).catch((err) => err);
  assert.ok(error instanceof StripeCheckoutRejectedError);
  assert.equal(error.code, 'INVOICE_VOID');
  assert.equal(state.invoice.status, 'VOID');
  assert.equal(state.payments.length, 0);

  const alerts = [];
  const logged = [];
  const failure = handleCheckoutFailure(error, {
    event: checkoutEvent(), route: '/api/invoices/stripe-webhook',
    log: { warn: (fields) => logged.push(fields), error: (fields) => logged.push(fields) },
    alert: async (alert) => { alerts.push(alert); },
  });
  assert.deepEqual([failure.statusCode, failure.acknowledged, failure.code], [200, true, 'INVOICE_VOID']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alerts[0]?.event, 'stripe_checkout_invoice_void');
});

test('a completed checkout settles an OVERDUE invoice', async () => {
  const { state, prisma } = settlementHarness('OVERDUE');
  const result = await recordCompletedCheckout(prisma, checkoutEvent());
  assert.deepEqual(result, { duplicate: false, invoiceId: 'invoice-1', fullyPaid: true });
  assert.equal(state.invoice.status, 'PAID');
  assert.equal(state.payments.length, 1);
  assert.deepEqual(state.events.map((event) => event.type), ['invoice.paid']);
});

test('voiding an invoice expires and forgets its Checkout session', async (t) => {
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A' }],
    invoices: [
      { id: 'invoice-a', clientId: 'client-a', status: 'SENT', invoiceNumber: 'INV-1', stripeCheckoutSessionId: 'cs_a', stripePaymentLink: 'https://checkout.stripe.test/a' },
      { id: 'invoice-b', clientId: 'client-a', status: 'OVERDUE', invoiceNumber: 'INV-2', stripeCheckoutSessionId: 'cs_b', stripePaymentLink: 'https://checkout.stripe.test/b' },
    ],
  });
  const expired = [];
  const app = await buildInvoiceApp(t, invoiceRoutes, db, {
    routeOptions: { expireCheckoutSession: async (id) => { expired.push(id); return true; } },
  });
  const single = await app.inject({ method: 'DELETE', url: '/invoice-a' });
  assert.equal(single.statusCode, 200, single.body);
  const bulk = await app.inject({ method: 'POST', url: '/bulk/archive', payload: { ids: ['invoice-b'] } });
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.deepEqual(expired, ['cs_a', 'cs_b']);
  for (const invoice of db.state.invoices) {
    assert.equal(invoice.status, 'VOID');
    assert.equal(invoice.stripeCheckoutSessionId, null);
    assert.equal(invoice.stripePaymentLink, null);
  }
});

test('session expiry is best-effort and never throws', async () => {
  const warnings = [];
  const log = { warn: (fields) => warnings.push(fields) };
  assert.equal(await expireCheckoutSession('cs_1', { stripeClient: { checkout: { sessions: { expire: async () => { throw Object.assign(new Error('already expired'), { code: 'resource_missing' }); } } } }, log }), false);
  assert.equal(warnings.length, 1);
  assert.equal(await expireCheckoutSession('cs_2', { stripeClient: { checkout: { sessions: { expire: async () => ({ status: 'expired' }) } } }, log }), true);
  assert.equal(await expireCheckoutSession(null, { stripeClient: null, log }), false);
});
