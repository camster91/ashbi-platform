import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAccessFailure, createPublicAccessWindow } from '../../utils/public-document-access.js';
import { createPaymentLinkWithClient, recordCompletedCheckout } from '../../services/stripe.service.js';

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
    invoice: { id: 'invoice-1', invoiceNumber: 'INV-001', total: 113, currency: 'CAD', status: 'SENT' },
    payments: [],
  };
  const tx = {
    invoice: {
      findUnique: async ({ where }) => where.id === state.invoice.id ? { ...state.invoice } : null,
      updateMany: async () => {
        if (state.invoice.status === 'PAID') return { count: 0 };
        state.invoice.status = 'PAID';
        return { count: 1 };
      },
    },
    invoicePayment: {
      findUnique: async ({ where }) => state.payments.find(payment => payment.transactionId === where.transactionId) || null,
      create: async ({ data }) => {
        state.payments.push({ ...data });
        return data;
      },
    },
  };
  return { state, prisma: { $transaction: callback => callback(tx) } };
}

test('public document access windows are high entropy, expiring, and revocable', () => {
  const access = createPublicAccessWindow();
  assert.match(access.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null }), null);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: new Date(0), publicAccessRevokedAt: null })?.statusCode, 410);
  assert.equal(publicAccessFailure({ publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: new Date() })?.statusCode, 410);
});

test('Stripe checkout completion transitions an invoice and records payment exactly once', async () => {
  const { state, prisma } = paymentHarness();
  const first = await recordCompletedCheckout(prisma, checkoutEvent());
  const replay = await recordCompletedCheckout(prisma, checkoutEvent());
  assert.deepEqual(first, { duplicate: false, invoiceId: 'invoice-1' });
  assert.deepEqual(replay, { duplicate: true, invoiceId: 'invoice-1' });
  assert.equal(state.invoice.status, 'PAID');
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].transactionId, 'pi_123');
});

test('Stripe checkout creation uses one stable idempotency key per invoice', async () => {
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

  assert.equal(options.idempotencyKey, 'ashbi:invoice:invoice-123:checkout');
  assert.equal(request.metadata.invoiceId, 'invoice-123');
  assert.deepEqual(result, {
    paymentLink: 'https://checkout.stripe.example/session', checkoutSessionId: 'cs_123', paymentIntentId: 'pi_123',
  });
});

for (const [name, override, message] of [
  ['unpaid session', { payment_status: 'unpaid' }, /not paid/],
  ['wrong amount', { amount_total: 11299 }, /amount/],
  ['wrong currency', { currency: 'usd' }, /currency/],
  ['wrong invoice number', { metadata: { invoiceId: 'invoice-1', invoiceNumber: 'INV-OTHER' } }, /invoice number/],
]) {
  test(`Stripe checkout rejects ${name} without changing invoice state`, async () => {
    const { state, prisma } = paymentHarness();
    await assert.rejects(recordCompletedCheckout(prisma, checkoutEvent(override)), message);
    assert.equal(state.invoice.status, 'SENT');
    assert.equal(state.payments.length, 0);
  });
}
