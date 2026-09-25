import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLEARED_CHECKOUT_FIELDS,
  checkoutPersistenceData,
  createPaymentLinkWithClient,
  ensureCheckoutSession,
  reusableCheckoutLink,
} from '../../services/stripe.service.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');

// Fake Stripe that behaves like the real idempotency layer: a repeated key
// with identical params replays the original session; a repeated key with
// different params is rejected, exactly as Stripe does.
function fakeStripe() {
  const byKey = new Map();
  const calls = [];
  let counter = 0;
  const client = {
    checkout: {
      sessions: {
        create: async (params, { idempotencyKey }) => {
          calls.push({ params, idempotencyKey });
          const fingerprint = JSON.stringify(params);
          const prior = byKey.get(idempotencyKey);
          if (prior) {
            if (prior.fingerprint !== fingerprint) {
              const err = new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.');
              err.type = 'StripeIdempotencyError';
              throw err;
            }
            return prior.session;
          }
          counter += 1;
          const session = {
            id: `cs_${counter}`,
            url: `https://checkout.stripe.example/cs_${counter}`,
            payment_intent: null,
            expires_at: Math.floor(NOW.getTime() / 1000) + 24 * 3600,
          };
          byKey.set(idempotencyKey, { fingerprint, session });
          return session;
        },
      },
    },
  };
  return { client, calls, sessionsCreated: () => counter };
}

function invoiceStore(overrides = {}) {
  const state = {
    invoice: {
      id: 'inv-1', invoiceNumber: 'INV-1', total: 100, currency: 'CAD', viewToken: 'tok-1', notes: null,
      stripePaymentLink: null, stripeCheckoutSessionId: null, stripeCheckoutAmountMinor: null,
      stripeCheckoutCurrency: null, stripeCheckoutExpiresAt: null, stripeCheckoutAttempt: 0,
      ...overrides,
    },
  };
  const prisma = {
    invoice: {
      update: async ({ where, data }) => {
        assert.equal(where.id, state.invoice.id);
        Object.assign(state.invoice, data);
        return { ...state.invoice };
      },
    },
  };
  return { state, prisma };
}

test('rapid duplicate retries of the same checkout request share one key and one session', async () => {
  const stripe = fakeStripe();
  const invoice = { id: 'inv-1', invoiceNumber: 'INV-1', total: 100, currency: 'CAD', viewToken: 'tok-1', stripeCheckoutAttempt: 0 };
  const [a, b] = await Promise.all([
    createPaymentLinkWithClient(invoice, stripe.client),
    createPaymentLinkWithClient(invoice, stripe.client),
  ]);
  assert.equal(stripe.calls[0].idempotencyKey, stripe.calls[1].idempotencyKey);
  assert.equal(a.checkoutSessionId, b.checkoutSessionId);
  assert.equal(stripe.sessionsCreated(), 1);
});

test('an edited invoice total gets a new session instead of an idempotency conflict or stale amount', async () => {
  const stripe = fakeStripe();
  const { state, prisma } = invoiceStore();
  const first = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  assert.equal(first.reused, false);
  assert.equal(state.invoice.stripeCheckoutAmountMinor, 10000);

  state.invoice.total = 125;
  const second = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  assert.equal(second.reused, false);
  assert.notEqual(second.paymentLink, first.paymentLink);
  assert.equal(stripe.sessionsCreated(), 2);
  assert.equal(stripe.calls[1].params.line_items[0].price_data.unit_amount, 12500);
  assert.notEqual(stripe.calls[0].idempotencyKey, stripe.calls[1].idempotencyKey);
  assert.equal(state.invoice.stripeCheckoutAmountMinor, 12500);
});

test('an open matching session is reused without calling Stripe', async () => {
  const stripe = fakeStripe();
  const { state, prisma } = invoiceStore();
  const first = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  const again = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  assert.equal(again.reused, true);
  assert.equal(again.paymentLink, first.paymentLink);
  assert.equal(stripe.calls.length, 1);
});

test('an expired session (same amount, same day) is replaced with a fresh one', async () => {
  const stripe = fakeStripe();
  const { state, prisma } = invoiceStore();
  const first = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  const later = new Date(state.invoice.stripeCheckoutExpiresAt.getTime() + 60_000);
  const second = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: later });
  assert.equal(second.reused, false);
  assert.notEqual(second.paymentLink, first.paymentLink);
  assert.notEqual(stripe.calls[0].idempotencyKey, stripe.calls[1].idempotencyKey);
  assert.equal(state.invoice.stripeCheckoutAttempt, 2);
});

test('a session cleared by the checkout.session.expired webhook can be recreated', async () => {
  const stripe = fakeStripe();
  const { state, prisma } = invoiceStore();
  await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  // clearExpiredCheckout nulls the link but keeps the attempt counter.
  Object.assign(state.invoice, { stripePaymentLink: null, stripeCheckoutSessionId: null, stripeCheckoutExpiresAt: null });
  const second = await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  assert.equal(second.reused, false);
  assert.equal(stripe.sessionsCreated(), 2);
});

test('a rotated public link changes the return URLs without an idempotency conflict', async () => {
  const stripe = fakeStripe();
  const invoice = { id: 'inv-1', invoiceNumber: 'INV-1', total: 100, currency: 'CAD', viewToken: 'tok-1', stripeCheckoutAttempt: 3 };
  await createPaymentLinkWithClient(invoice, stripe.client);
  await createPaymentLinkWithClient({ ...invoice, viewToken: 'tok-2' }, stripe.client);
  assert.equal(stripe.sessionsCreated(), 2);
});

test('reuse rules reject sessions with wrong currency, near expiry, or untracked legacy links', () => {
  const base = {
    total: 100, currency: 'CAD', stripePaymentLink: 'https://x', stripeCheckoutSessionId: 'cs_1',
    stripeCheckoutAmountMinor: 10000, stripeCheckoutCurrency: 'cad',
    stripeCheckoutExpiresAt: new Date(NOW.getTime() + 3600_000),
  };
  assert.equal(reusableCheckoutLink(base, NOW), 'https://x');
  assert.equal(reusableCheckoutLink({ ...base, currency: 'USD' }, NOW), null);
  assert.equal(reusableCheckoutLink({ ...base, stripeCheckoutExpiresAt: new Date(NOW.getTime() + 60_000) }, NOW), null);
  assert.equal(reusableCheckoutLink({ ...base, stripeCheckoutAmountMinor: null }, NOW), null);
});

test('persisting a session advances the attempt counter used by the next key', () => {
  const data = checkoutPersistenceData({ stripeCheckoutAttempt: 4 }, {
    paymentLink: 'u', checkoutSessionId: 'cs', paymentIntentId: null, amountMinor: 1, currency: 'cad', expiresAt: NOW,
  });
  assert.equal(data.stripeCheckoutAttempt, 5);
  assert.equal(data.stripeCheckoutExpiresAt, NOW);
});

test('revoking or rotating a link clears every stored checkout field but keeps the attempt counter', async () => {
  const stripe = fakeStripe();
  const { state, prisma } = invoiceStore();
  await ensureCheckoutSession(prisma, state.invoice, { stripeClient: stripe.client, now: NOW });
  Object.assign(state.invoice, CLEARED_CHECKOUT_FIELDS);
  assert.equal(state.invoice.stripeCheckoutAmountMinor, null);
  assert.equal(state.invoice.stripeCheckoutCurrency, null);
  assert.equal(state.invoice.stripeCheckoutExpiresAt, null);
  assert.equal(state.invoice.stripeCheckoutAttempt, 1);
  assert.equal(reusableCheckoutLink(state.invoice, NOW), null);
});
