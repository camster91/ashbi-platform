// Unit coverage for the money-path guards (the real-database proof is
// src/tests/integration/money-paths.database.test.js): schema refusals,
// helper arithmetic, and compare-and-set behaviour that a stale read cannot
// get around.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { default: proposalRoutes } = await import('../../routes/proposal.routes.js');
const { default: portalRoutes } = await import('../../routes/portal.routes.js');
const { invoiceListOrderBy, proposalInvoiceTaxRate } = await import('../../routes/invoice.routes.js');
const { proposalDataFromEstimate, computeEstimateTotals } = await import('../../routes/estimate.routes.js');
const { retainerBillingPeriod } = await import('../../routes/retainer.routes.js');
const { proposalBuilderUpdateSchema, createInvoiceSchema, retainerGenerateInvoiceSchema } = await import('../../validators/schemas.js');
const { firstRecurringDate, RECURRING_SOURCE_STATUSES, processRecurringInvoices } = await import('../../jobs/recurring-invoices.js');
const { recordManualPayment, InvoiceOverpaymentError } = await import('../../services/invoice-payment.service.js');
const { invoiceBalance } = await import('../../utils/invoice-balance.js');
const { checkoutAmountMinor } = await import('../../services/stripe.service.js');
const { enterRequestContext } = await import('../../utils/request-context.js');
const { outboxStore } = await import('../helpers/domain-event-fake.js');
const { applyInvoiceData, statusMatches } = await import('../helpers/fake-invoice-row.js');
const { InvalidPaymentAmountError } = await import('../../services/invoice-payment.service.js');

const FUTURE = new Date(Date.now() + 86_400_000);

test('the proposal builder update schema refuses status and money fields', () => {
  for (const forged of [{ status: 'APPROVED' }, { total: 1 }, { subtotal: 1 }, { title: 'x', status: 'SENT' }]) {
    assert.equal(proposalBuilderUpdateSchema.safeParse(forged).success, false, JSON.stringify(forged));
  }
  const ok = proposalBuilderUpdateSchema.safeParse({ title: 'x', lineItems: [{ description: 'Design', unitPrice: 10 }], discount: 2 });
  assert.equal(ok.success, true);
  assert.equal(ok.data.lineItems[0].quantity, 1);
});

function staleProposalDatabase(stored) {
  // Every request reads the SENT snapshot it would have read just before the
  // client's other answer landed; only the write decides.
  const snapshot = { id: 'prop-1', clientId: 'client-1', status: 'SENT', total: 100, internalNotes: null, publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null };
  const outbox = outboxStore();
  /** @type {any} */
  const prisma = {
    auditEvent: { create: async ({ data }) => data },
    domainEvent: outbox.domainEvent,
    $executeRaw: outbox.$executeRaw,
    client: { findUnique: async () => ({ organizationId: 'org-1' }) },
    proposal: {
      findUnique: async () => ({ ...snapshot }),
      // An unguarded write would overwrite the stored answer.
      update: async ({ data }) => { Object.assign(stored, data); return { ...snapshot, ...stored }; },
      updateMany: async ({ where, data }) => {
        const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
        if (!allowed.includes(stored.status) || (where.publicAccessRevokedAt === null && stored.publicAccessRevokedAt)) return { count: 0 };
        Object.assign(stored, data);
        return { count: 1 };
      },
    },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  return prisma;
}

async function publicApp(t, routes, prefix, prisma) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', prisma);
  app.addHook('onRequest', async (request) => {
    request.prisma = prisma;
    enterRequestContext({ prisma, organizationId: null });
  });
  await app.register(routes, { prefix });
  t.after(() => app.close());
  return app;
}

for (const [label, routes, prefix, url, payload] of [
  ['legacy proposal link', proposalRoutes, '/api/proposals', '/api/proposals/client/view-token/decline', undefined],
  ['SPA portal link', portalRoutes, '/api/portal', '/api/portal/proposal/view-token/decline', { reason: 'Too expensive' }],
]) {
  test(`a decline via the ${label} cannot overwrite an approval that landed after its read`, async (t) => {
    const stored = { status: 'APPROVED', approvedAt: new Date(), publicAccessRevokedAt: new Date() };
    const app = await publicApp(t, routes, prefix, staleProposalDatabase(stored));
    const response = await app.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(stored.status, 'APPROVED');
    assert.equal(stored.declinedAt, undefined);
  });

  test(`a decline via the ${label} still works while the proposal awaits an answer`, async (t) => {
    const stored = { status: 'VIEWED', publicAccessRevokedAt: null };
    const app = await publicApp(t, routes, prefix, staleProposalDatabase(stored));
    const response = await app.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, 'DECLINED');
    assert.equal(stored.status, 'DECLINED');
  });
}

test('the portal approve refuses a proposal that is not awaiting an answer', async (t) => {
  const stored = { status: 'DRAFT', publicAccessRevokedAt: null };
  const prisma = staleProposalDatabase(stored);
  prisma.proposal.findUnique = async () => ({ id: 'prop-1', clientId: 'client-1', status: 'DRAFT', total: 100, publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null });
  const app = await publicApp(t, portalRoutes, '/api/portal', prisma);
  const response = await app.inject({ method: 'POST', url: '/api/portal/proposal/view-token/approve' });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(stored.status, 'DRAFT');
});

test('the invoice list sort and order are allowlisted', () => {
  assert.deepEqual(invoiceListOrderBy(undefined, undefined), { createdAt: 'desc' });
  assert.deepEqual(invoiceListOrderBy('total', 'asc'), { total: 'asc' });
  assert.deepEqual(invoiceListOrderBy('client', 'asc'), { createdAt: 'asc' });
  assert.deepEqual(invoiceListOrderBy('__proto__', 'DROP'), { createdAt: 'desc' });
  assert.deepEqual(invoiceListOrderBy(['total'], { asc: 1 }), { createdAt: 'desc' });
});

test('an estimate becomes a pre-tax proposal whose invoice bills the estimate total', () => {
  const estimate = {
    id: 'est-1', title: 'Site', description: 'Scope', clientId: 'client-1', taxRate: 5, tax: 0, validUntil: null,
    lineItems: [{ description: 'Build', quantity: 3, rate: 33.33 }, { description: '', quantity: 1, rate: 10 }],
  };
  const data = proposalDataFromEstimate(estimate, { createdById: 'user-1' });
  const totals = computeEstimateTotals(estimate.lineItems, { taxRate: 5 });
  assert.deepEqual(data.lineItems.create, [
    { description: 'Build', quantity: 3, unitPrice: 33.33, total: 99.99 },
    { description: 'Line item', quantity: 1, unitPrice: 10, total: 10 },
  ]);
  assert.deepEqual([data.subtotal, data.total, data.status, data.createdById, data.notes], [totals.subtotal, totals.subtotal, 'DRAFT', 'user-1', 'Scope']);
  assert.equal('content' in data || 'tax' in data, false);
  assert.equal(proposalInvoiceTaxRate(data), 5);
  // An expired estimate validity is not copied: the new draft gets 30 days.
  const now = new Date('2026-10-01T00:00:00.000Z');
  const expired = proposalDataFromEstimate({ ...estimate, validUntil: new Date('2026-09-01T00:00:00.000Z') }, { createdById: 'user-1', now });
  assert.equal(expired.validUntil.toISOString(), '2026-10-31T00:00:00.000Z');
  const future = new Date('2026-12-01T00:00:00.000Z');
  assert.equal(proposalDataFromEstimate({ ...estimate, validUntil: future }, { createdById: 'user-1', now }).validUntil, future);

  // A legacy estimate (fixed tax, no stored rate) carries the implied rate.
  const legacy = proposalDataFromEstimate({ ...estimate, taxRate: null, tax: 10.999 }, { createdById: 'user-1' });
  assert.ok(Math.abs(proposalInvoiceTaxRate(legacy) - (11 / 109.99) * 100) < 0.001);
  // Any other proposal is invoiced at the HST default.
  assert.equal(proposalInvoiceTaxRate({ metadata: null }), 13);
  assert.equal(proposalInvoiceTaxRate({ metadata: '{not json' }), 13);
});

test('recurring invoices: first date is in the future and only issued invoices are sources', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  assert.equal(firstRecurringDate(new Date('2026-10-01T09:00:00.000Z'), 'MONTHLY', now).toISOString(), '2026-11-01T09:00:00.000Z');
  // A back-dated issue date does not create a backlog.
  assert.equal(firstRecurringDate(new Date('2026-01-31T00:00:00.000Z'), 'MONTHLY', now).toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(firstRecurringDate(new Date('2025-02-15T00:00:00.000Z'), 'ANNUALLY', now).toISOString(), '2027-02-15T00:00:00.000Z');
  assert.deepEqual([...RECURRING_SOURCE_STATUSES], ['SENT', 'VIEWED', 'OVERDUE', 'PAID']);

  const base = { clientId: 'cmclient0000000000000000', lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }] };
  assert.equal(createInvoiceSchema.safeParse({ ...base, isRecurring: true }).success, false);
  assert.equal(createInvoiceSchema.safeParse({ ...base, isRecurring: true, recurringInterval: 'MONTHLY' }).success, true);
  assert.equal(createInvoiceSchema.safeParse({ ...base, isRecurring: false }).success, true);
});

test('the recurring job only selects and claims issued source invoices', async () => {
  const wheres = [];
  const client = {
    invoice: { findMany: async ({ where }) => { wheres.push(where); return []; } },
  };
  await processRecurringInvoices(client, async () => ({}), { now: new Date('2026-10-01T00:00:00.000Z') });
  assert.deepEqual(wheres[0].status, { in: ['SENT', 'VIEWED', 'OVERDUE', 'PAID'] });
  assert.equal(wheres[0].isRecurring, true);
});

function paymentDb(invoice, payments = []) {
  const state = { invoice: { ...invoice }, payments: [...payments] };
  const outbox = outboxStore();
  /** @type {any} */
  const tx = {
    invoice: {
      updateMany: async ({ where, data }) => {
        if (!statusMatches(state.invoice.status, where.status)) return { count: 0 };
        applyInvoiceData(state.invoice, data);
        return { count: 1 };
      },
      findUnique: async () => ({ ...state.invoice }),
      update: async ({ data }) => ({ ...applyInvoiceData(state.invoice, data) }),
    },
    invoicePayment: {
      aggregate: async () => ({ _sum: { amount: state.payments.reduce((sum, p) => sum + p.amount, 0) || null } }),
      create: async ({ data }) => { const row = { id: `pay-${state.payments.length + 1}`, ...data }; state.payments.push(row); return row; },
    },
    client: { findUnique: async () => ({ organizationId: 'org-1' }) },
    domainEvent: outbox.domainEvent,
    $executeRaw: outbox.$executeRaw,
  };
  return { state, outbox, db: { $transaction: (fn) => fn(tx) } };
}

test('a partial payment keeps the invoice open and writes no invoice.paid event', async () => {
  const invoice = { id: 'inv-1', clientId: 'client-1', status: 'SENT', total: 113, currency: 'CAD' };
  const { state, outbox, db } = paymentDb(invoice);
  const first = await recordManualPayment(db, { invoice, method: 'BANK', amount: 40, paidAt: new Date() });
  assert.deepEqual([first.fullyPaid, first.invoice.status, first.invoice.amountPaid, first.invoice.balanceDue], [false, 'SENT', 40, 73]);
  assert.equal(outbox.events.length, 0);

  await assert.rejects(
    recordManualPayment(db, { invoice, method: 'BANK', amount: 73.01, paidAt: new Date() }),
    (error) => error instanceof InvoiceOverpaymentError && error.balanceDue === 73,
  );
  assert.equal(state.payments.length, 1);

  // Without an amount, the remaining balance is paid and the invoice settles.
  const rest = await recordManualPayment(db, { invoice, method: 'BANK', paidAt: new Date() });
  assert.deepEqual([rest.amount, rest.fullyPaid, rest.invoice.status, rest.invoice.balanceDue], [73, true, 'PAID', 0]);
  assert.deepEqual(outbox.events.map((event) => [event.type, event.payload.amount]), [['invoice.paid', 73]]);
  assert.equal(state.invoice.stripePaymentLink, null, 'a stored Checkout session for the old balance is forgotten');
  assert.equal(state.invoice.stripeCheckoutAttempt, 2, 'each payment bumps the attempt a stale Checkout store compares against');
});

test('a zero or negative payment is refused with its own error, and a draft takes no payment', async () => {
  const invoice = { id: 'inv-1', clientId: 'client-1', status: 'SENT', total: 113, currency: 'CAD' };
  const { state, db } = paymentDb(invoice);
  for (const amount of [0, -5]) {
    await assert.rejects(recordManualPayment(db, { invoice, method: 'BANK', amount, paidAt: new Date() }), (error) => error instanceof InvalidPaymentAmountError);
  }
  assert.equal(state.payments.length, 0);
  const draft = paymentDb({ ...invoice, status: 'DRAFT' });
  assert.equal(await recordManualPayment(draft.db, { invoice, method: 'BANK', amount: 10, paidAt: new Date() }), null);
  assert.equal(draft.state.payments.length, 0);
});

test('an invoice with nothing owed closes with a $0 record, and refuses any other amount', async () => {
  const invoice = { id: 'inv-0', clientId: 'client-1', status: 'SENT', total: 0, currency: 'CAD' };
  const refused = paymentDb(invoice);
  await assert.rejects(
    recordManualPayment(refused.db, { invoice, method: 'BANK', amount: 5, paidAt: new Date() }),
    (error) => error instanceof InvoiceOverpaymentError && error.balanceDue === 0,
  );
  assert.equal(refused.state.payments.length, 0);

  // Bulk mark-paid passes no amount; the single dialog sends 0.
  for (const amount of [undefined, 0]) {
    const { state, outbox, db } = paymentDb(invoice);
    const closed = await recordManualPayment(db, { invoice, method: 'BANK', amount, paidAt: new Date() });
    assert.deepEqual([closed.amount, closed.fullyPaid, closed.invoice.status], [0, true, 'PAID'], String(amount));
    assert.deepEqual(state.payments.map((payment) => payment.amount), [0]);
    assert.deepEqual(outbox.events.map((event) => event.type), ['invoice.paid']);
  }
});

test('balances and Checkout amounts follow the recorded payments', () => {
  assert.deepEqual(invoiceBalance(113, 40.004), { amountPaid: 40, balanceDue: 73 });
  assert.deepEqual(invoiceBalance(100, 120), { amountPaid: 120, balanceDue: 0 });
  assert.equal(checkoutAmountMinor({ total: 113 }), 11300);
  assert.equal(checkoutAmountMinor({ total: 113, balanceDue: 73 }), 7300);
});

test('the retainer billing period is the UTC month, or the one staff pass', () => {
  assert.equal(retainerBillingPeriod(new Date('2026-10-31T23:59:59.000Z')), '2026-10');
  assert.equal(retainerBillingPeriod(new Date('2026-11-01T00:00:00.000Z')), '2026-11');
  assert.equal(retainerGenerateInvoiceSchema.parse({ period: '2026-09' }).period, '2026-09');
  for (const period of ['2026-13', '2026-9', 'September']) {
    assert.equal(retainerGenerateInvoiceSchema.safeParse({ period }).success, false, period);
  }
});

test('mark-paid expires the Checkout session cleared under the row lock, not the one it read first', async (t) => {
  const { default: invoiceRoutes } = await import('../../routes/invoice.routes.js');
  const { createFakeInvoiceDb, buildInvoiceApp } = await import('../helpers/fake-invoice-db.js');
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A' }],
    invoices: [{ id: 'invoice-a', clientId: 'client-a', status: 'SENT', invoiceNumber: 'INV-1', total: 113, stripeCheckoutSessionId: 'cs_late', stripeCheckoutAttempt: 1 }],
  });
  // The route's own read predates a pay-link request that stored cs_late.
  const findUnique = db.invoice.findUnique;
  let reads = 0;
  db.invoice.findUnique = async (args) => {
    const row = await findUnique(args);
    reads += 1;
    return reads === 1 && row ? { ...row, stripeCheckoutSessionId: 'cs_old' } : row;
  };
  const expired = [];
  const app = await buildInvoiceApp(t, invoiceRoutes, db, {
    routeOptions: { expireCheckoutSession: async (sessionId) => { expired.push(sessionId); return true; } },
  });
  const response = await app.inject({ method: 'POST', url: '/invoice-a/mark-paid', payload: { amount: 50, paymentMethod: 'BANK' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(expired, ['cs_late']);
  assert.equal(db.state.invoices[0].stripeCheckoutSessionId, null);
});

test('sending a recurring draft without a next date starts its schedule', async (t) => {
  const { default: invoiceRoutes } = await import('../../routes/invoice.routes.js');
  const { createFakeInvoiceDb, buildInvoiceApp } = await import('../helpers/fake-invoice-db.js');
  const issueDate = new Date('2026-01-31T09:00:00.000Z');
  const db = createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A' }],
    invoices: [
      { id: 'legacy', clientId: 'client-a', status: 'DRAFT', invoiceNumber: 'INV-1', total: 10, issueDate, isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: null },
      { id: 'plain', clientId: 'client-a', status: 'DRAFT', invoiceNumber: 'INV-2', total: 10, issueDate, isRecurring: false, recurringNextDate: null },
    ],
  });
  const app = await buildInvoiceApp(t, invoiceRoutes, db, {
    routeOptions: { createPaymentLink: async () => null, sendInvoiceDeliveryEmail: async () => ({ ok: true }) },
  });
  for (const id of ['legacy', 'plain']) {
    const response = await app.inject({ method: 'POST', url: `/${id}/send`, payload: {} });
    assert.equal(response.statusCode, 200, response.body);
  }
  const [legacy, plain] = db.state.invoices;
  assert.equal(legacy.status, 'SENT');
  assert.equal(legacy.recurringNextDate.toISOString(), firstRecurringDate(issueDate, 'MONTHLY').toISOString());
  assert.ok(legacy.recurringNextDate > new Date());
  assert.equal(plain.recurringNextDate, null);
});
