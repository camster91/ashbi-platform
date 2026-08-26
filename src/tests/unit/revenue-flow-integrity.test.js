import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { publicAccessFailure, createPublicAccessWindow } from '../../utils/public-document-access.js';
import * as stripeService from '../../services/stripe.service.js';

const { createPaymentLinkWithClient, recordCompletedCheckout } = stripeService;

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
    invoice: {
      id: 'invoice-1', invoiceNumber: 'INV-001', total: 113, currency: 'CAD', status: 'SENT',
      stripeCheckoutSessionId: 'cs_123', stripeCheckoutAttempt: 0,
    },
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
    id: 'invoice-123', invoiceNumber: 'INV-0001', total: 125.5, currency: 'CAD', status: 'SENT',
    viewToken: 'view-token', publicAccessExpiresAt: new Date(Date.now() + 60_000),
    publicAccessRevokedAt: null, stripeCheckoutAttempt: 0, notes: null,
  }, stripeClient);

  assert.equal(options.idempotencyKey, 'ashbi:invoice:invoice-123:checkout:0');
  assert.equal(request.metadata.invoiceId, 'invoice-123');
  assert.equal(Object.hasOwn(request, 'payment_method_types'), false);
  assert.equal(Object.hasOwn(request, 'automatic_tax'), false);
  assert.match(request.integration_identifier, /^ashbi_invoice_[a-z]{8}$/);
  assert.deepEqual(result, {
    paymentLink: 'https://checkout.stripe.example/session', checkoutSessionId: 'cs_123', paymentIntentId: 'pi_123',
  });
});

test('Stripe checkout creation fails closed without exact payable invoice evidence', async () => {
  const stripeClient = { checkout: { sessions: { create: async () => ({}) } } };
  const valid = {
    id: 'invoice-123', invoiceNumber: 'INV-0001', total: 125.5, currency: 'CAD', status: 'SENT',
    viewToken: 'view-token', publicAccessExpiresAt: new Date(Date.now() + 60_000),
    publicAccessRevokedAt: null, stripeCheckoutAttempt: 0,
  };

  for (const [name, invoice] of [
    ['unassigned currency', { ...valid, currency: null }],
    ['unsupported currency', { ...valid, currency: 'EUR' }],
    ['non-positive amount', { ...valid, total: 0 }],
    ['draft invoice', { ...valid, status: 'DRAFT' }],
    ['expired public access', { ...valid, publicAccessExpiresAt: new Date(0) }],
    ['revoked public access', { ...valid, publicAccessRevokedAt: new Date() }],
  ]) {
    await assert.rejects(
      createPaymentLinkWithClient(invoice, stripeClient),
      Error,
      name,
    );
  }
});

test('Stripe completion rejects a stale checkout session without changing invoice state', async () => {
  const { state, prisma } = paymentHarness();
  state.invoice.stripeCheckoutSessionId = 'cs_active';

  await assert.rejects(
    recordCompletedCheckout(prisma, checkoutEvent({ id: 'cs_stale' })),
    /active checkout session/,
  );
  assert.equal(state.invoice.status, 'SENT');
  assert.equal(state.payments.length, 0);
});

test('Stripe completion never turns a voided invoice back into paid', async () => {
  const { state, prisma } = paymentHarness();
  state.invoice.status = 'VOID';

  await assert.rejects(
    recordCompletedCheckout(prisma, checkoutEvent()),
    /payable state/,
  );
  assert.equal(state.invoice.status, 'VOID');
  assert.equal(state.payments.length, 0);
});

test('Stripe delayed-payment events stay pending until a verified success event arrives', async () => {
  assert.equal(typeof stripeService.reconcileCheckoutEvent, 'function');
  const { state, prisma } = paymentHarness();
  const pendingEvent = checkoutEvent({ payment_status: 'unpaid' });
  pendingEvent.type = 'checkout.session.completed';

  const pending = await stripeService.reconcileCheckoutEvent(prisma, pendingEvent);
  assert.deepEqual(pending, { state: 'pending', invoiceId: 'invoice-1' });
  assert.equal(state.invoice.status, 'SENT');
  assert.equal(state.payments.length, 0);

  const succeededEvent = checkoutEvent();
  succeededEvent.type = 'checkout.session.async_payment_succeeded';
  const succeeded = await stripeService.reconcileCheckoutEvent(prisma, succeededEvent);
  assert.deepEqual(succeeded, { state: 'paid', duplicate: false, invoiceId: 'invoice-1' });
  assert.equal(state.invoice.status, 'PAID');
  assert.equal(state.payments.length, 1);
});

test('Stripe expiration clears only the active session and advances the checkout attempt', async () => {
  const calls = [];
  const prisma = {
    invoice: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };
  const event = checkoutEvent();
  event.type = 'checkout.session.expired';

  const result = await stripeService.reconcileCheckoutEvent(prisma, event);

  assert.deepEqual(result, { state: 'expired', invoiceId: 'invoice-1', cleared: true });
  assert.deepEqual(calls[0], {
    where: { id: 'invoice-1', stripeCheckoutSessionId: 'cs_123', status: { not: 'PAID' } },
    data: {
      stripePaymentLink: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeCheckoutAttempt: { increment: 1 },
    },
  });
});

test('Stripe has one canonical webhook route with complete checkout event coverage', () => {
  const invoiceRoutes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const webhookRoutes = readFileSync('src/routes/webhook.routes.js', 'utf8');

  assert.doesNotMatch(invoiceRoutes, /post\(['"]\/stripe-webhook/);
  assert.match(webhookRoutes, /reconcileCheckoutEvent/);
  for (const eventType of [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ]) {
    assert.match(webhookRoutes, new RegExp(eventType.replaceAll('.', '\\.')));
  }
});

test('invoice delivery persists the exact public token before creating its checkout', () => {
  const invoiceRoutes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const start = invoiceRoutes.indexOf("fastify.post('/:id/send'");
  const end = invoiceRoutes.indexOf('// ─── GET /:id/pdf', start);
  const sendRoute = invoiceRoutes.slice(start, end);

  assert.match(sendRoute, /const claimed = await request\.prisma\.invoice\.updateMany/);
  assert.match(sendRoute, /where:\s*\{ id: request\.params\.id, status: 'DRAFT' \}/);
  assert.match(sendRoute, /const preparedInvoice = await request\.prisma\.invoice\.findUnique/);
  assert.match(sendRoute, /createPaymentLink\(preparedInvoice\)/);
  assert.ok(
    sendRoute.indexOf('const preparedInvoice = await request.prisma.invoice.findUnique')
      < sendRoute.indexOf('createPaymentLink(preparedInvoice)'),
    'public access must be persisted before Stripe receives its redirect token',
  );
  assert.doesNotMatch(sendRoute, /fastify\.prisma/);
});

test('staff checkout creation stays inside the authenticated tenant scope', () => {
  const invoiceRoutes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const start = invoiceRoutes.indexOf("fastify.post('/:id/payment-link'");
  const end = invoiceRoutes.indexOf('// ─── GET /:id/payments', start);
  const paymentLinkRoute = invoiceRoutes.slice(start, end);

  assert.match(paymentLinkRoute, /request\.prisma\.invoice\.findUnique/);
  assert.match(paymentLinkRoute, /request\.prisma\.invoice\.update/);
  assert.doesNotMatch(paymentLinkRoute, /fastify\.prisma/);
});

test('Stripe checkout attempt is persisted for retry-safe expired-session replacement', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827003000_stripe_checkout_attempt/migration.sql',
    'utf8',
  );
  const invoiceModel = schema.match(/model Invoice \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(invoiceModel, /stripeCheckoutAttempt\s+Int\s+@default\(0\)/);
  assert.match(migration, /ADD COLUMN "stripeCheckoutAttempt" INTEGER NOT NULL DEFAULT 0/);
});

test('Stripe client and environment guidance use the reviewed API and least-privilege key boundary', () => {
  const service = readFileSync('src/services/stripe.service.js', 'utf8');
  const exampleEnv = readFileSync('.env.example', 'utf8');

  assert.match(service, /new Stripe\(env\.stripeSecretKey, \{ apiVersion: '2026-07-29\.dahlia' \}\)/);
  assert.match(exampleEnv, /test-mode restricted key/i);
  assert.match(exampleEnv, /rk_/);
  assert.doesNotMatch(exampleEnv, /[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/);
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
