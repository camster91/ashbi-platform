import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = await import('../../services/invoiceCheckoutInvalidation.service.js').catch(() => ({}));

const NOW = new Date('2026-08-26T23:30:00.000Z');

function invoice(overrides = {}) {
  return {
    id: 'invoice-1',
    invoiceNumber: 'INV-001',
    status: 'SENT',
    stripeCheckoutSessionId: 'cs_active',
    stripeCheckoutAttempt: 2,
    publicAccessRevokedAt: null,
    ...overrides,
  };
}

function prismaHarness(initialInvoice = invoice()) {
  const state = { invoice: { ...initialInvoice }, audits: [] };
  const calls = { outsideUpdates: [], transactionUpdates: [], audits: [] };
  const applyData = (data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        state.invoice[key] = (state.invoice[key] || 0) + value.increment;
      } else {
        state.invoice[key] = value;
      }
    }
    return { ...state.invoice };
  };
  const tx = {
    invoice: {
      update: async ({ data }) => {
        calls.transactionUpdates.push(data);
        return applyData(data);
      },
    },
    invoiceCheckoutAudit: {
      create: async ({ data }) => {
        calls.audits.push(data);
        state.audits.push(data);
        return data;
      },
    },
  };
  const prisma = {
    invoice: {
      update: async ({ data }) => {
        calls.outsideUpdates.push(data);
        return applyData(data);
      },
    },
    $transaction: async callback => callback(tx),
  };
  return { calls, prisma, state };
}

test('open Stripe checkout is expired with an attempt-specific idempotency key', async () => {
  assert.equal(typeof service.expireInvoiceCheckoutWithClient, 'function');
  const calls = { retrieve: [], expire: [] };
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          calls.retrieve.push(id);
          return { id, status: 'open', payment_status: 'unpaid' };
        },
        expire: async (id, params, options) => {
          calls.expire.push({ id, params, options });
          return { id, status: 'expired', payment_status: 'unpaid' };
        },
      },
    },
  };

  const result = await service.expireInvoiceCheckoutWithClient(invoice(), stripeClient);

  assert.deepEqual(result, { state: 'expired', providerStatus: 'expired', paymentStatus: 'unpaid' });
  assert.deepEqual(calls.retrieve, ['cs_active']);
  assert.deepEqual(calls.expire, [{
    id: 'cs_active',
    params: {},
    options: { idempotencyKey: 'ashbi:invoice:invoice-1:checkout:2:invalidate' },
  }]);
});

test('already expired Stripe checkout is accepted without another provider mutation', async () => {
  assert.equal(typeof service.expireInvoiceCheckoutWithClient, 'function');
  let expires = 0;
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async id => ({ id, status: 'expired', payment_status: 'unpaid' }),
        expire: async () => { expires += 1; },
      },
    },
  };

  const result = await service.expireInvoiceCheckoutWithClient(invoice(), stripeClient);

  assert.equal(result.state, 'expired');
  assert.equal(expires, 0);
});

test('completed Stripe checkout is blocked until its payment state reconciles', async () => {
  assert.equal(typeof service.expireInvoiceCheckoutWithClient, 'function');
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async id => ({ id, status: 'complete', payment_status: 'paid' }),
      },
    },
  };

  await assert.rejects(
    service.expireInvoiceCheckoutWithClient(invoice(), stripeClient),
    error => error.code === 'CHECKOUT_COMPLETED_RECONCILIATION_REQUIRED'
      && error.statusCode === 409
      && error.reconciliationRequired === true,
  );
});

test('unknown provider outcome is classified without exposing the provider error', async () => {
  assert.equal(typeof service.expireInvoiceCheckoutWithClient, 'function');
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async () => { throw new Error('socket failed with secret details'); },
      },
    },
  };

  await assert.rejects(
    service.expireInvoiceCheckoutWithClient(invoice(), stripeClient),
    error => error.code === 'CHECKOUT_INVALIDATION_OUTCOME_UNKNOWN'
      && error.statusCode === 503
      && error.reconciliationRequired === true
      && !error.message.includes('secret details'),
  );
});

test('confirmed invalidation voids locally only after shielding access and expiring Stripe', async () => {
  assert.equal(typeof service.invalidateInvoiceCheckout, 'function');
  const { calls, prisma, state } = prismaHarness();
  const providerCalls = [];
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async id => ({ id, status: 'open', payment_status: 'unpaid' }),
        expire: async (id) => {
          providerCalls.push(id);
          return { id, status: 'expired', payment_status: 'unpaid' };
        },
      },
    },
  };

  const result = await service.invalidateInvoiceCheckout({
    prisma,
    invoice: invoice(),
    action: 'VOID',
    actorUserId: 'user-1',
    stripeClient,
    now: NOW,
  });

  assert.deepEqual(calls.outsideUpdates[0], { publicAccessRevokedAt: NOW, stripePaymentLink: null });
  assert.deepEqual(providerCalls, ['cs_active']);
  assert.equal(result.status, 'VOID');
  assert.equal(state.invoice.voidedFromStatus, 'SENT');
  assert.equal(state.invoice.voidedAt, NOW);
  assert.equal(state.invoice.stripeCheckoutSessionId, null);
  assert.equal(state.invoice.stripeCheckoutAttempt, 3);
  assert.equal(state.invoice.stripeCheckoutReconciliationRequiredAt, null);
  assert.equal(calls.audits[0].outcome, 'CONFIRMED');
  assert.equal(calls.audits[0].action, 'VOID');
});

test('unknown invalidation outcome keeps invoice payable state and records reconciliation evidence', async () => {
  assert.equal(typeof service.invalidateInvoiceCheckout, 'function');
  const { calls, prisma, state } = prismaHarness();
  const stripeClient = {
    checkout: {
      sessions: {
        retrieve: async () => { throw new Error('network unavailable'); },
      },
    },
  };

  await assert.rejects(
    service.invalidateInvoiceCheckout({
      prisma,
      invoice: invoice(),
      action: 'VOID',
      actorUserId: 'user-1',
      stripeClient,
      now: NOW,
    }),
    error => error.code === 'CHECKOUT_INVALIDATION_OUTCOME_UNKNOWN',
  );

  assert.equal(state.invoice.status, 'SENT');
  assert.equal(state.invoice.publicAccessRevokedAt, NOW);
  assert.equal(state.invoice.stripeCheckoutSessionId, 'cs_active');
  assert.equal(state.invoice.stripeCheckoutReconciliationRequiredAt, NOW);
  assert.equal(state.invoice.stripeCheckoutReconciliationReason, 'CHECKOUT_INVALIDATION_OUTCOME_UNKNOWN');
  assert.equal(calls.audits[0].outcome, 'RECONCILIATION_REQUIRED');
  assert.doesNotMatch(JSON.stringify(calls.audits[0]), /network unavailable/);
});

test('configured Stripe access is required when an active checkout must be invalidated', async () => {
  assert.equal(typeof service.invalidateInvoiceCheckout, 'function');
  const { prisma, state } = prismaHarness();

  await assert.rejects(
    service.invalidateInvoiceCheckout({
      prisma,
      invoice: invoice(),
      action: 'REVOKE',
      actorUserId: 'user-1',
      stripeClient: null,
      now: NOW,
    }),
    error => error.code === 'CHECKOUT_INVALIDATION_OUTCOME_UNKNOWN'
      && error.reconciliationRequired === true,
  );

  assert.equal(state.invoice.publicAccessRevokedAt, NOW);
  assert.equal(state.invoice.stripeCheckoutSessionId, 'cs_active');
  assert.equal(state.invoice.stripeCheckoutReconciliationRequiredAt, NOW);
});

test('rotation creates a new access window only after checkout invalidation is confirmed', async () => {
  assert.equal(typeof service.invalidateInvoiceCheckout, 'function');
  const { prisma, state } = prismaHarness(invoice({ stripeCheckoutSessionId: null }));
  let accessCalls = 0;
  const accessFactory = () => {
    accessCalls += 1;
    return { token: 'new-token', expiresAt: new Date('2026-09-25T23:30:00.000Z'), revokedAt: null };
  };

  await service.invalidateInvoiceCheckout({
    prisma,
    invoice: invoice({ stripeCheckoutSessionId: null }),
    action: 'ROTATE',
    actorUserId: 'user-1',
    stripeClient: null,
    now: NOW,
    accessFactory,
  });

  assert.equal(accessCalls, 1);
  assert.equal(state.invoice.viewToken, 'new-token');
  assert.equal(state.invoice.publicAccessRevokedAt, null);
});

test('invoice invalidation state and immutable audit evidence exist at the database boundary', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827005000_invoice_checkout_invalidation/migration.sql',
    'utf8',
  );
  const invoiceModel = schema.match(/model Invoice \{[\s\S]*?\n\}/)?.[0] || '';
  const auditModel = schema.match(/model InvoiceCheckoutAudit \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(invoiceModel, /stripeCheckoutReconciliationRequiredAt\s+DateTime\?/);
  assert.match(invoiceModel, /stripeCheckoutReconciliationReason\s+String\?/);
  assert.match(invoiceModel, /checkoutAudits\s+InvoiceCheckoutAudit\[\]/);
  assert.match(auditModel, /invoiceId\s+String/);
  assert.match(auditModel, /action\s+String/);
  assert.match(auditModel, /outcome\s+String/);
  assert.match(auditModel, /actorUserId\s+String\?/);
  assert.match(migration, /CREATE TABLE "invoice_checkout_audits"/);
  assert.doesNotMatch(migration, /ON DELETE SET NULL/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "invoice_checkout_audits"/);
  assert.match(migration, /Invoice checkout audit rows are append-only/);
});

test('invoice checkout audit access is tenant-scoped through its invoice owner', () => {
  const tenantProxy = readFileSync('src/utils/prisma-tenant-proxy.js', 'utf8');
  assert.match(tenantProxy, /invoicecheckoutaudit:\s*\['invoice', 'client'\]/);
});

test('revoke rotate and void routes share the provider-backed invalidation service', () => {
  const routes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  assert.match(routes, /invalidateInvoiceCheckout/);
  for (const [marker, action] of [
    ["fastify.delete('/:id'", 'VOID'],
    ["fastify.post('/:id/public-link/revoke'", 'REVOKE'],
    ["fastify.post('/:id/public-link/rotate'", 'ROTATE'],
  ]) {
    const start = routes.indexOf(marker);
    const end = routes.indexOf('\n  });', start);
    const route = routes.slice(start, end);
    assert.match(route, new RegExp(`action: '${action}'`));
    assert.match(route, /actorUserId: request\.user\.id/);
    assert.match(route, /reconciliationRequired/);
  }
});
