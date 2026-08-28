import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reconcilePaymentSettlement } from '../../services/stripe.service.js';

function harness() {
  const state = {
    payment: { id: 'pay-1', invoiceId: 'inv-1', method: 'STRIPE', stripeLivemode: false, transactionId: 'pi_1', amountMinor: 10000, currency: 'USD', invoice: { currency: 'USD' } },
    events: [],
  };
  const delegates = {
    invoicePayment: {
      findUnique: async ({ where }) => where.id === state.payment.id ? structuredClone(state.payment) : null,
      update: async ({ data }) => Object.assign(state.payment, structuredClone(data)),
    },
    invoiceSettlementEvent: {
      findUnique: async ({ where }) => structuredClone(state.events.find(event => event.requestId === where.requestId) || null),
      create: async ({ data }) => { state.events.push(structuredClone(data)); return data; },
    },
  };
  return { state, prisma: { ...delegates, $transaction: callback => callback(delegates) } };
}

function provider(balance = { id: 'txn_1', amount: 13800, fee: 400, net: 13400, currency: 'cad' }) {
  const calls = [];
  return { calls, client: { paymentIntents: { retrieve: async (...args) => {
    calls.push(args);
    return { id: 'pi_1', livemode: false, latest_charge: { id: 'ch_1', amount: 10000, currency: 'usd', balance_transaction: balance } };
  } } } };
}

test('verified settlement preserves charge and settlement currencies separately', async () => {
  const { state, prisma } = harness();
  const stripe = provider();
  const result = await reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient: stripe.client });
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(stripe.calls[0], ['pi_1', { expand: ['latest_charge.balance_transaction'] }]);
  assert.equal(state.payment.currency, 'USD');
  assert.equal(state.payment.settlementCurrency, 'CAD');
  assert.equal(state.payment.providerFeeMinor, 400);
  assert.equal(state.payment.settlementNetMinor, 13400);
  assert.equal(state.events.length, 1);
});

test('a repeated request is idempotent and does not reread Stripe', async () => {
  const { prisma } = harness();
  const stripe = provider();
  await reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient: stripe.client });
  const duplicate = await reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient: stripe.client });
  assert.equal(duplicate.duplicate, true);
  assert.equal(stripe.calls.length, 1);
});

test('a missing balance transaction stays pending and retryable', async () => {
  const { state, prisma } = harness();
  const result = await reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient: provider(null).client });
  assert.equal(result.status, 'PENDING');
  assert.equal(state.payment.settlementReconciliationReason, 'BALANCE_TRANSACTION_PENDING');
});

test('provider failure is recorded as unknown without leaking provider text', async () => {
  const { state, prisma } = harness();
  const stripeClient = { paymentIntents: { retrieve: async () => { throw Object.assign(new Error('secret detail'), { code: 'ETIMEDOUT' }); } } };
  const result = await reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient });
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(state.events[0].reasonCode, 'PROVIDER_UNREACHABLE');
  assert.doesNotMatch(JSON.stringify(state.events), /secret detail/);
});

test('invalid Stripe arithmetic fails before ledger mutation', async () => {
  const { state, prisma } = harness();
  await assert.rejects(reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', {
    stripeClient: provider({ id: 'txn_1', amount: 10000, fee: 300, net: 9999, currency: 'usd' }).client,
  }), /does not reconcile/);
  assert.equal(state.events.length, 0);
});

test('settlement rejects a provider mode that differs from the signed checkout event', async () => {
  const { state, prisma } = harness();
  const stripeClient = { paymentIntents: { retrieve: async () => ({
    id: 'pi_1', livemode: true,
    latest_charge: { id: 'ch_1', amount: 10000, currency: 'usd', balance_transaction: null },
  }) } };
  await assert.rejects(
    reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', { stripeClient }),
    /mode evidence does not match/,
  );
  assert.equal(state.events.length, 0);
});

test('a changed balance transaction cannot overwrite verified evidence', async () => {
  const { state, prisma } = harness();
  state.payment.stripeBalanceTransactionId = 'txn_original';
  await assert.rejects(reconcilePaymentSettlement(prisma, 'pay-1', 'request-1', {
    stripeClient: provider().client,
  }), /immutable evidence changed/);
  assert.equal(state.events.length, 0);
});

test('schema and migration keep settlement events append-only and tenant linked', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync('prisma/migrations/20260827011000_stripe_settlement_evidence/migration.sql', 'utf8');
  const routes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  assert.match(schema, /model InvoiceSettlementEvent/);
  assert.match(migration, /invoice_settlement_events_append_only/);
  assert.match(routes, /findFirst\([\s\S]*invoiceId: request\.params\.id/);
  assert.match(routes, /adminOnly/);
});
