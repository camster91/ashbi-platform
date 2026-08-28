import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as stripeService from '../../services/stripe.service.js';

const EVENT_TIME = 1_787_000_000;

function refundEvent(type = 'refund.created', overrides = {}) {
  return {
    id: 'evt_refund_1',
    type,
    created: EVENT_TIME,
    data: {
      object: {
        id: 're_123',
        object: 'refund',
        amount: 5000,
        currency: 'cad',
        payment_intent: 'pi_123',
        status: 'succeeded',
        created: EVENT_TIME - 10,
        ...overrides,
      },
    },
  };
}

function provider(refundOverrides = {}) {
  const calls = [];
  return {
    calls,
    client: {
      refunds: {
        retrieve: async (id) => {
          calls.push(id);
          return refundEvent('refund.updated', refundOverrides).data.object;
        },
      },
    },
  };
}

function refundHarness() {
  const state = {
    payment: {
      id: 'payment-1',
      invoiceId: 'invoice-1',
      transactionId: 'pi_123',
      method: 'STRIPE',
      amount: 113,
      amountMinor: 11300,
      currency: 'CAD',
      invoice: { id: 'invoice-1', invoiceNumber: 'INV-001', currency: 'CAD', total: 113 },
    },
    refunds: [],
    events: [],
  };

  const delegates = {
    invoicePayment: {
      findUnique: async ({ where }) => where.transactionId === state.payment.transactionId
        ? structuredClone(state.payment)
        : null,
    },
    invoiceRefund: {
      findUnique: async ({ where }) => structuredClone(
        state.refunds.find(item => item.stripeRefundId === where.stripeRefundId) || null,
      ),
      findMany: async ({ where }) => structuredClone(state.refunds.filter(item => (
        item.paymentId === where.paymentId
        && item.stripeRefundId !== where.stripeRefundId?.not
        && !where.status?.notIn?.includes(item.status)
      ))),
      create: async ({ data }) => {
        const created = { id: `refund-${state.refunds.length + 1}`, ...structuredClone(data) };
        state.refunds.push(created);
        return structuredClone(created);
      },
      update: async ({ where, data }) => {
        const existing = state.refunds.find(item => item.id === where.id);
        Object.assign(existing, structuredClone(data));
        return structuredClone(existing);
      },
    },
    invoiceRefundEvent: {
      findUnique: async ({ where }) => structuredClone(
        state.events.find(item => item.stripeEventId === where.stripeEventId) || null,
      ),
      create: async ({ data }) => {
        if (state.events.some(item => item.stripeEventId === data.stripeEventId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const created = { id: `refund-event-${state.events.length + 1}`, ...structuredClone(data) };
        state.events.push(created);
        return structuredClone(created);
      },
    },
  };

  return {
    state,
    prisma: {
      ...delegates,
      $transaction: callback => callback(delegates),
    },
  };
}

test('a verified successful refund creates one currency-exact ledger row and append-only event', async () => {
  assert.equal(typeof stripeService.reconcileRefundEvent, 'function');
  const { state, prisma } = refundHarness();
  const stripe = provider();

  const result = await stripeService.reconcileRefundEvent(prisma, refundEvent(), { stripeClient: stripe.client });

  assert.deepEqual(stripe.calls, ['re_123']);
  assert.deepEqual(result, {
    state: 'succeeded', duplicate: false, invoiceId: 'invoice-1', stripeRefundId: 're_123',
  });
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].paymentId, 'payment-1');
  assert.equal(state.refunds[0].amountMinor, 5000);
  assert.equal(state.refunds[0].currency, 'CAD');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].stripeEventId, 'evt_refund_1');
  assert.equal(state.events[0].status, 'succeeded');
});

test('the same signed refund event is idempotent', async () => {
  const { state, prisma } = refundHarness();
  const stripe = provider();
  const event = refundEvent();

  await stripeService.reconcileRefundEvent(prisma, event, { stripeClient: stripe.client });
  const replay = await stripeService.reconcileRefundEvent(prisma, event, { stripeClient: stripe.client });

  assert.deepEqual(replay, {
    state: 'succeeded', duplicate: true, invoiceId: 'invoice-1', stripeRefundId: 're_123',
  });
  assert.equal(stripe.calls.length, 1);
  assert.equal(state.refunds.length, 1);
  assert.equal(state.events.length, 1);
});

test('multiple partial refunds cannot exceed the exact Stripe payment amount', async () => {
  const { state, prisma } = refundHarness();
  const firstProvider = provider({ id: 're_first', amount: 7000 });
  await stripeService.reconcileRefundEvent(
    prisma,
    refundEvent('refund.created', { id: 're_first', amount: 7000 }),
    { stripeClient: firstProvider.client },
  );
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].amountMinor, 7000);
  assert.equal(state.refunds[0].status, 'succeeded');

  const secondProvider = provider({ id: 're_second', amount: 5000 });
  const secondEvent = refundEvent('refund.created', { id: 're_second', amount: 5000 });
  secondEvent.id = 'evt_refund_2';
  await assert.rejects(
    stripeService.reconcileRefundEvent(
      prisma,
      secondEvent,
      { stripeClient: secondProvider.client },
    ),
    /exceeds the recorded payment/i,
  );
  assert.equal(state.refunds.length, 1);
  assert.equal(state.events.length, 1);
});

test('refund currency must exactly match the immutable payment and invoice currency', async () => {
  const { state, prisma } = refundHarness();
  const stripe = provider({ currency: 'usd' });

  await assert.rejects(
    stripeService.reconcileRefundEvent(
      prisma,
      refundEvent('refund.created', { currency: 'usd' }),
      { stripeClient: stripe.client },
    ),
    /currency/i,
  );
  assert.equal(state.refunds.length, 0);
  assert.equal(state.events.length, 0);
});

test('a signed refund event without a recognized status fails before ledger mutation', async () => {
  const { state, prisma } = refundHarness();
  const event = refundEvent('refund.updated', { status: undefined });

  await assert.rejects(
    stripeService.reconcileRefundEvent(prisma, event, { stripeClient: provider().client }),
    /signed event status/i,
  );
  assert.equal(state.refunds.length, 0);
  assert.equal(state.events.length, 0);
});

test('legacy payment rows without exact minor amount and currency fail closed', async () => {
  const { state, prisma } = refundHarness();
  state.payment.amountMinor = null;
  state.payment.currency = null;

  await assert.rejects(
    stripeService.reconcileRefundEvent(prisma, refundEvent(), { stripeClient: provider().client }),
    /payment currency and amount evidence/i,
  );
  assert.equal(state.refunds.length, 0);
});

test('a later failed provider state updates the refund and preserves both events', async () => {
  const { state, prisma } = refundHarness();
  await stripeService.reconcileRefundEvent(prisma, refundEvent(), { stripeClient: provider().client });

  const failedEvent = refundEvent('refund.failed', {
    status: 'failed',
    failure_reason: 'declined',
  });
  failedEvent.id = 'evt_refund_2';
  failedEvent.created += 60;
  const failedProvider = provider({ status: 'failed', failure_reason: 'declined' });
  const result = await stripeService.reconcileRefundEvent(
    prisma,
    failedEvent,
    { stripeClient: failedProvider.client },
  );

  assert.equal(result.state, 'failed');
  assert.equal(state.refunds[0].status, 'failed');
  assert.equal(state.refunds[0].failureReason, 'declined');
  assert.equal(state.events.length, 2);
});

test('an out-of-order webhook uses current provider truth and never moves its event clock backwards', async () => {
  const { state, prisma } = refundHarness();
  const newer = refundEvent('refund.updated');
  newer.id = 'evt_newer';
  newer.created += 120;
  await stripeService.reconcileRefundEvent(prisma, newer, { stripeClient: provider().client });

  const older = refundEvent('refund.created');
  older.id = 'evt_older';
  const result = await stripeService.reconcileRefundEvent(
    prisma,
    older,
    { stripeClient: provider({ status: 'failed', failure_reason: 'declined' }).client },
  );

  assert.equal(result.state, 'failed');
  assert.equal(state.refunds[0].status, 'failed');
  assert.equal(state.refunds[0].lastProviderEventAt.toISOString(), new Date(newer.created * 1000).toISOString());
  assert.equal(state.refunds[0].lastStripeEventId, 'evt_newer');
  assert.equal(state.events.length, 2);
  assert.equal(state.events[1].signedStatus, 'succeeded');
  assert.equal(state.events[1].status, 'failed');
});

test('refund persistence is currency-safe, tenant-scoped, and its event history is append-only', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const tenantProxy = readFileSync('src/utils/prisma-tenant-proxy.js', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827007000_stripe_refund_reconciliation/migration.sql',
    'utf8',
  );
  const paymentModel = schema.match(/model InvoicePayment \{[\s\S]*?\n\}/)?.[0] || '';
  const refundModel = schema.match(/model InvoiceRefund \{[\s\S]*?\n\}/)?.[0] || '';
  const eventModel = schema.match(/model InvoiceRefundEvent \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(paymentModel, /amountMinor\s+Int\?/);
  assert.match(paymentModel, /currency\s+String\?/);
  assert.match(refundModel, /stripeRefundId\s+String\s+@unique/);
  assert.match(refundModel, /amountMinor\s+Int/);
  assert.match(refundModel, /currency\s+String/);
  assert.match(eventModel, /stripeEventId\s+String\s+@unique/);
  assert.match(eventModel, /signedStatus\s+String/);
  assert.match(tenantProxy, /invoicerefund:\s*\['invoice', 'client'\]/);
  assert.match(tenantProxy, /invoicerefundevent:\s*\['invoice', 'client'\]/);
  assert.match(migration, /invoice_payments_currency_amount_evidence/);
  assert.match(migration, /invoice_refund_events_status_supported/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "invoice_refund_events"/);
  assert.match(migration, /Invoice refund event rows are append-only/);
});

test('refund migration stores the signed provider status on each append-only event', () => {
  const migration = readFileSync(
    'prisma/migrations/20260827007000_stripe_refund_reconciliation/migration.sql',
    'utf8',
  );
  const refundTable = migration.match(/CREATE TABLE "invoice_refunds" \([\s\S]*?\n\);/)?.[0] || '';
  const eventTable = migration.match(/CREATE TABLE "invoice_refund_events" \([\s\S]*?\n\);/)?.[0] || '';

  assert.doesNotMatch(refundTable, /"signedStatus" TEXT NOT NULL/);
  assert.match(eventTable, /"signedStatus" TEXT NOT NULL/);
});

test('the canonical signed Stripe webhook handles current refund lifecycle events', () => {
  const webhookRoutes = readFileSync('src/routes/webhook.routes.js', 'utf8');
  assert.match(webhookRoutes, /reconcileRefundEvent/);
  for (const eventType of ['refund.created', 'refund.updated', 'refund.failed']) {
    assert.match(webhookRoutes, new RegExp(eventType.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(webhookRoutes, /charge\.refund\.updated/);
});

test('staff payment history stays tenant-scoped and returns its refund ledger', () => {
  const invoiceRoutes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const start = invoiceRoutes.indexOf("fastify.get('/:id/payments'");
  const end = invoiceRoutes.indexOf('// ─── POST /from-proposal', start);
  const route = invoiceRoutes.slice(start, end);

  assert.match(route, /request\.prisma\.invoice\.findUnique/);
  assert.match(route, /request\.prisma\.invoicePayment\.findMany/);
  assert.match(route, /refunds:\s*\{/);
  assert.doesNotMatch(route, /fastify\.prisma/);
});

test('manual payment recording stays tenant-scoped and stores exact invoice currency evidence', () => {
  const invoiceRoutes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const start = invoiceRoutes.indexOf("fastify.post('/:id/mark-paid'");
  const end = invoiceRoutes.indexOf("fastify.post('/:id/payment-link'", start);
  const route = invoiceRoutes.slice(start, end);

  assert.match(route, /request\.prisma\.invoice\.findUnique/);
  assert.match(route, /request\.prisma\.\$transaction/);
  assert.match(route, /amountMinor:\s*Math\.round\(paidAmount \* 100\)/);
  assert.match(route, /currency:\s*invoice\.currency/);
  assert.doesNotMatch(route, /fastify\.prisma/);
});

test('invoice payment history visibly labels currency and refund outcomes', () => {
  const page = readFileSync('web/src/pages/InvoiceDetail.jsx', 'utf8');
  assert.match(page, /p\.refunds\?\.map/);
  assert.match(page, /refund\.currency/);
  assert.match(page, /refund\.status/);
  assert.doesNotMatch(page, /fmt\(invoice\.total\)\} CAD/);
});
