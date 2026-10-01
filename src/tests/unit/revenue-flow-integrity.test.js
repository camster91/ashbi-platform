import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAccessFailure, createPublicAccessWindow } from '../../utils/public-document-access.js';
import { createPaymentLinkWithClient, handleCheckoutFailure, recordCompletedCheckout } from '../../services/stripe.service.js';
import { outboxStore } from '../helpers/domain-event-fake.js';
import { applyInvoiceData, statusMatches } from '../helpers/fake-invoice-row.js';

function checkoutEvent(overrides = {}) {
  return {
    id: 'evt_123',
    created: 1_786_240_000,
    data: {
      object: {
        id: 'cs_123',
        payment_intent: 'pi_123',
        payment_status: 'paid',
        amount_total: 11300,
        currency: 'cad',
        metadata: { invoiceId: 'invoice-1', invoiceNumber: 'INV-001' },
        ...overrides,
      },
    },
  };
}

function paymentHarness() {
  const state = {
    invoice: { id: 'invoice-1', clientId: 'client-1', invoiceNumber: 'INV-001', total: 113, currency: 'CAD', status: 'SENT' },
    payments: [],
  };
  const outbox = outboxStore();
  const tx = {
    client: { findUnique: async ({ where }) => (where.id === 'client-1' ? { organizationId: 'org-1' } : null) },
    domainEvent: outbox.domainEvent,
    $executeRaw: outbox.$executeRaw,
    invoice: {
      findUnique: async ({ where }) => where.id === state.invoice.id ? { ...state.invoice } : null,
      updateMany: async ({ where, data }) => {
        if (!statusMatches(state.invoice.status, where.status)) return { count: 0 };
        applyInvoiceData(state.invoice, data);
        return { count: 1 };
      },
      update: async ({ data }) => ({ ...applyInvoiceData(state.invoice, data) }),
    },
    invoicePayment: {
      aggregate: async ({ where }) => ({ _sum: { amount: state.payments.filter((payment) => payment.invoiceId === where.invoiceId).reduce((sum, payment) => sum + payment.amount, 0) || null } }),
      findUnique: async ({ where }) => state.payments.find(payment => payment.transactionId === where.transactionId) || null,
      create: async ({ data }) => {
        const payment = { id: `payment-${state.payments.length + 1}`, ...data };
        state.payments.push(payment);
        return payment;
      },
    },
  };
  return { state, outbox, prisma: { $transaction: callback => callback(tx) } };
}

test('public document access windows are high entropy, expiring, and revocable', () => {
  const access = createPublicAccessWindow();
  assert.match(access.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null }), null);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: new Date(0), publicAccessRevokedAt: null })?.statusCode, 410);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: new Date() })?.statusCode, 410);
});

test('Stripe checkout completion transitions an invoice and records payment exactly once', async () => {
  const { state, outbox, prisma } = paymentHarness();
  const first = await recordCompletedCheckout(prisma, checkoutEvent(), { correlationId: 'req-7' });
  const replay = await recordCompletedCheckout(prisma, checkoutEvent(), { correlationId: 'req-8' });
  assert.deepEqual(first, { duplicate: false, invoiceId: 'invoice-1', fullyPaid: true });
  assert.deepEqual(replay, { duplicate: true, invoiceId: 'invoice-1' });
  assert.equal(state.invoice.status, 'PAID');
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].transactionId, 'pi_123');
  // One invoice.paid outbox event in the same transaction; the replayed
  // delivery records none. The Stripe event is the causation.
  assert.equal(outbox.events.length, 1);
  const [event] = outbox.events;
  assert.deepEqual(
    [event.type, event.organizationId, event.aggregateId, event.correlationId, event.causationId, event.idempotencyKey],
    ['invoice.paid', 'org-1', 'invoice-1', 'req-7', 'stripe:evt_123', 'invoice.paid:invoice-1:payment-1'],
  );
  assert.deepEqual(event.payload, {
    invoiceId: 'invoice-1', clientId: 'client-1', paymentId: 'payment-1', amount: 113, total: 113, currency: 'CAD',
    method: 'STRIPE', source: 'stripe_checkout', paidAt: new Date(1_786_240_000 * 1000).toISOString(),
  });
});

test('Stripe checkout creation keys the request by invoice, attempt, amount and currency', async () => {
  let request;
  let options;
  const stripeClient = {
    checkout: {
      sessions: {
        create: async (input, inputOptions) => {
          request = input;
          options = inputOptions;
          return { id: 'cs_123', url: 'https://checkout.stripe.example/session', payment_intent: 'pi_123' };
        },
      },
    },
  };

  const result = await createPaymentLinkWithClient({
    id: 'invoice-123', invoiceNumber: 'INV-0001', total: 125.5, currency: 'CAD', viewToken: 'view-token', notes: null,
  }, stripeClient);

  assert.match(options.idempotencyKey, /^ashbi:invoice:invoice-123:checkout:0:cad:12550:[0-9a-f]{16}$/);
  assert.equal(request.metadata.invoiceId, 'invoice-123');
  assert.equal(result.paymentLink, 'https://checkout.stripe.example/session');
  assert.equal(result.checkoutSessionId, 'cs_123');
  assert.equal(result.paymentIntentId, 'pi_123');
  assert.equal(result.amountMinor, 12550);
  assert.equal(result.currency, 'cad');
});

for (const [name, override, message] of [
  ['unpaid session', { payment_status: 'unpaid' }, /not paid/],
  ['more than the balance', { amount_total: 11301 }, /balance/],
  ['zero amount', { amount_total: 0 }, /amount/],
  ['wrong currency', { currency: 'usd' }, /currency/],
  ['wrong invoice number', { metadata: { invoiceId: 'invoice-1', invoiceNumber: 'INV-OTHER' } }, /invoice number/],
]) {
  test(`Stripe checkout rejects ${name} without changing invoice state`, async () => {
    const { state, outbox, prisma } = paymentHarness();
    await assert.rejects(recordCompletedCheckout(prisma, checkoutEvent(override)), message);
    assert.equal(state.invoice.status, 'SENT');
    assert.equal(state.payments.length, 0);
    assert.equal(outbox.events.length, 0);
  });
}

// A manual payment recorded after the Checkout session was created changes
// the balance the session was priced for (H1). Sequential cases: the manual
// payment commits, then the delivery arrives.
test('a stale session smaller than the balance is recorded as a partial payment', async () => {
  const { state, outbox, prisma } = paymentHarness();
  const result = await recordCompletedCheckout(prisma, checkoutEvent({ amount_total: 5000 }));
  assert.deepEqual(result, { duplicate: false, invoiceId: 'invoice-1', fullyPaid: false });
  assert.equal(state.invoice.status, 'SENT', 'the invoice stays open');
  assert.deepEqual(state.payments.map((payment) => payment.amount), [50]);
  assert.equal(outbox.events.length, 0, 'no invoice.paid for a partial payment');
});

test('manual partial payment, then a Checkout session for the old total: refused and alerted, nothing recorded', async () => {
  const { state, outbox, prisma } = paymentHarness();
  state.payments.push({ id: 'manual-1', invoiceId: 'invoice-1', amount: 13, method: 'BANK', transactionId: null });
  const error = await recordCompletedCheckout(prisma, checkoutEvent()).catch((err) => err);
  assert.equal(error?.code, 'CHECKOUT_BALANCE_CHANGED');
  assert.equal(state.invoice.status, 'SENT');
  assert.equal(state.payments.length, 1);
  assert.equal(outbox.events.length, 0);
  const alerts = [];
  const failure = handleCheckoutFailure(error, {
    event: checkoutEvent(), route: '/api/invoices/stripe-webhook',
    log: { warn: () => {}, error: () => {} }, alert: async (alert) => { alerts.push(alert.event); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([failure.statusCode, failure.acknowledged, failure.code], [200, true, 'CHECKOUT_BALANCE_CHANGED']);
  assert.deepEqual(alerts, ['stripe_checkout_balance_changed']);
});

test('manual partial payment, then a Checkout session for the remaining balance: settles the invoice', async () => {
  const { state, outbox, prisma } = paymentHarness();
  state.payments.push({ id: 'manual-1', invoiceId: 'invoice-1', amount: 13, method: 'BANK', transactionId: null });
  const result = await recordCompletedCheckout(prisma, checkoutEvent({ amount_total: 10000 }));
  assert.deepEqual(result, { duplicate: false, invoiceId: 'invoice-1', fullyPaid: true });
  assert.equal(state.invoice.status, 'PAID');
  assert.deepEqual(state.payments.map((payment) => payment.amount), [13, 100]);
  assert.deepEqual(outbox.events.map((event) => [event.type, event.payload.amount]), [['invoice.paid', 100]]);
});

test('manual full payment, then a stale Checkout session: refused as already paid and alerted', async () => {
  const { state, prisma } = paymentHarness();
  state.payments.push({ id: 'manual-1', invoiceId: 'invoice-1', amount: 113, method: 'BANK', transactionId: null });
  state.invoice.status = 'PAID';
  const error = await recordCompletedCheckout(prisma, checkoutEvent()).catch((err) => err);
  assert.equal(error?.code, 'INVOICE_ALREADY_PAID');
  assert.equal(state.payments.length, 1);
  const alerts = [];
  handleCheckoutFailure(error, {
    event: checkoutEvent(), route: '/api/invoices/stripe-webhook',
    log: { warn: () => {}, error: () => {} }, alert: async (alert) => { alerts.push(alert.event); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(alerts, ['stripe_checkout_invoice_already_paid']);
});
