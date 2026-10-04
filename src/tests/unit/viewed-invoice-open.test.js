// A VIEWED invoice behaves exactly like a SENT
// one everywhere: it is payable (Stripe Checkout and manual payments, single
// and bulk), its public link stays open, it is listed and payable in the
// client portal, the chaser and work queue pick it up, the invoice stats count
// it as outstanding (and overdue once past due), and it can be voided.
import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import invoiceRoutes from '../../routes/invoice.routes.js';
import invoiceChaserRoutes from '../../routes/invoice-chaser.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { recordCompletedCheckout, SETTLEABLE_INVOICE_STATUSES } from '../../services/stripe.service.js';
import { PAYABLE_INVOICE_STATUSES } from '../../services/invoice-settlement.js';
import { recordManualPayment, settleInvoiceManually } from '../../services/invoice-payment.service.js';
import { WORK_QUEUE_SOURCES } from '../../services/work-queue.service.js';
import { SENT_INVOICE_STATUSES, UNPAID_INVOICE_STATUSES } from '../../utils/invoice-balance.js';
import { INVOICE_OPEN_STATUSES, invoicePublicAccessFailure } from '../../utils/public-document-access.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';
import { outboxStore } from '../helpers/domain-event-fake.js';
import { applyInvoiceData, statusMatches } from '../helpers/fake-invoice-row.js';

const DAY = 24 * 60 * 60 * 1000;

test('every open-invoice status list includes VIEWED', () => {
  assert.deepEqual([...UNPAID_INVOICE_STATUSES], ['SENT', 'VIEWED', 'OVERDUE']);
  assert.deepEqual([...SENT_INVOICE_STATUSES], ['SENT', 'VIEWED']);
  for (const list of [PAYABLE_INVOICE_STATUSES, SETTLEABLE_INVOICE_STATUSES, INVOICE_OPEN_STATUSES]) {
    assert.deepEqual([...list], [...UNPAID_INVOICE_STATUSES]);
  }
});

test('a VIEWED invoice link stays open past its recorded expiry, like SENT', () => {
  const lapsed = { viewToken: 't', publicAccessExpiresAt: new Date(Date.now() - DAY), publicAccessRevokedAt: null };
  assert.equal(invoicePublicAccessFailure({ ...lapsed, status: 'SENT' }), null);
  assert.equal(invoicePublicAccessFailure({ ...lapsed, status: 'VIEWED' }), null);
  assert.equal(invoicePublicAccessFailure({ ...lapsed, status: 'VIEWED', publicAccessRevokedAt: new Date() })?.statusCode, 410);
});

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
      aggregate: async () => ({ _sum: { amount: state.payments.reduce((sum, p) => sum + p.amount, 0) || null } }),
      findUnique: async () => null,
      create: async ({ data }) => { const row = { id: `pay-${state.payments.length + 1}`, ...data }; state.payments.push(row); return row; },
    },
    client: { findUnique: async () => ({ organizationId: 'org-1' }) },
    domainEvent: outbox.domainEvent,
    $executeRaw: outbox.$executeRaw,
  };
  return { state, prisma: { $transaction: (callback) => callback(tx) } };
}

test('a completed Stripe checkout settles a VIEWED invoice', async () => {
  const { state, prisma } = settlementHarness('VIEWED');
  const result = await recordCompletedCheckout(prisma, {
    id: 'evt_viewed', created: 1_786_240_000,
    data: { object: {
      id: 'cs_viewed', payment_intent: 'pi_viewed', payment_status: 'paid', amount_total: 11300, currency: 'cad',
      metadata: { invoiceId: 'invoice-1', invoiceNumber: 'INV-001' },
    } },
  });
  assert.deepEqual(result, { duplicate: false, invoiceId: 'invoice-1', fullyPaid: true });
  assert.equal(state.invoice.status, 'PAID');
  assert.equal(state.payments.length, 1);
  assert.deepEqual(state.events.map((event) => event.type), ['invoice.paid']);
});

test('a VIEWED invoice takes manual partial and full payments', async () => {
  const { state, prisma } = settlementHarness('VIEWED');
  const partial = await recordManualPayment(prisma, { invoice: { ...state.invoice }, method: 'BANK', amount: 13, paidAt: new Date() });
  assert.deepEqual([partial.fullyPaid, state.invoice.status], [false, 'VIEWED'], 'a partial payment keeps it open as VIEWED');
  const settled = await settleInvoiceManually(prisma, { invoice: { ...state.invoice }, method: 'BANK', paidAt: new Date() });
  assert.ok(settled);
  assert.equal(state.invoice.status, 'PAID');
  assert.deepEqual(state.payments.map((p) => p.amount), [13, 100]);
});

function viewedInvoiceDb() {
  const past = new Date(Date.now() - 3 * DAY);
  const future = new Date(Date.now() + 10 * DAY);
  return createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A' }],
    invoices: [
      { id: 'sent', clientId: 'client-a', status: 'SENT', invoiceNumber: 'INV-1', total: 100, dueDate: future },
      { id: 'viewed', clientId: 'client-a', status: 'VIEWED', invoiceNumber: 'INV-2', total: 200, dueDate: future },
      { id: 'viewed-late', clientId: 'client-a', status: 'VIEWED', invoiceNumber: 'INV-3', total: 50, dueDate: past },
      { id: 'draft', clientId: 'client-a', status: 'DRAFT', invoiceNumber: 'INV-4', total: 999, dueDate: past },
    ],
  });
}

test('invoice stats count VIEWED as sent, and as overdue once past due', async (t) => {
  const db = viewedInvoiceDb();
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const response = await app.inject({ method: 'GET', url: '/stats' });
  assert.equal(response.statusCode, 200, response.body);
  const stats = response.json();
  assert.deepEqual([stats.sent.count, stats.sent.amount], [2, 300]);
  assert.deepEqual([stats.overdue.count, stats.overdue.amount], [1, 50]);
  assert.equal(stats.totalOutstanding, 350);
});

test('the SENT filter lists VIEWED invoices and the OVERDUE filter lists past-due VIEWED ones', async (t) => {
  const db = viewedInvoiceDb();
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const sent = await app.inject({ method: 'GET', url: '/?status=SENT' });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.deepEqual(sent.json().invoices.map((i) => i.id).sort(), ['sent', 'viewed', 'viewed-late']);
  const overdue = await app.inject({ method: 'GET', url: '/?status=OVERDUE' });
  const overdueRows = overdue.json().invoices;
  assert.deepEqual(overdueRows.map((i) => i.id), ['viewed-late']);
  assert.equal(overdueRows[0].isOverdue, true);
});

test('a VIEWED invoice can be marked paid, bulk marked paid and voided', async (t) => {
  const db = /** @type {any} */ (viewedInvoiceDb());
  // A full payment writes the invoice.paid outbox event in its transaction.
  const outbox = outboxStore();
  db.domainEvent = outbox.domainEvent;
  db.$executeRaw = outbox.$executeRaw;
  const app = await buildInvoiceApp(t, invoiceRoutes, db);
  const paid = await app.inject({ method: 'POST', url: '/viewed/mark-paid', payload: { paymentMethod: 'BANK' } });
  assert.equal(paid.statusCode, 200, paid.body);
  assert.equal(paid.json().status, 'PAID');

  const bulk = await app.inject({ method: 'POST', url: '/bulk/mark-paid', payload: { ids: ['viewed-late'], paymentMethod: 'CASH' } });
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.equal(bulk.json().updated, 1, bulk.body);
  assert.equal(db.state.invoices.find((i) => i.id === 'viewed-late').status, 'PAID');

  db.state.invoices.push({ id: 'viewed-void', clientId: 'client-a', status: 'VIEWED', invoiceNumber: 'INV-5', total: 10, lineItems: [], payments: [], currency: 'CAD' });
  const voided = await app.inject({ method: 'DELETE', url: '/viewed-void' });
  assert.equal(voided.statusCode, 200, voided.body);
  assert.deepEqual([voided.json().status, voided.json().voidedFromStatus], ['VOID', 'VIEWED']);
  const undone = await app.inject({ method: 'POST', url: '/viewed-void/undo-void' });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(undone.json().status, 'VIEWED');
});

test('the invoice chaser lists past-due VIEWED invoices', async (t) => {
  const db = viewedInvoiceDb();
  const app = await buildInvoiceApp(t, invoiceChaserRoutes, db);
  const response = await app.inject({ method: 'GET', url: '/overdue' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().map((i) => i.id), ['viewed-late']);
});

test('the work queue loads VIEWED invoices', async () => {
  const calls = [];
  const source = WORK_QUEUE_SOURCES.find((s) => s.key === 'invoices');
  await source.load({ invoice: { findMany: async (args) => { calls.push(args); return []; } } }, { filters: {}, user: { id: 'u' }, now: new Date() });
  assert.deepEqual(calls[0].where.status, { in: ['SENT', 'VIEWED', 'OVERDUE'] });
});

test('the client portal lists a VIEWED invoice with a Pay action', async (t) => {
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1,
  };
  const invoice = {
    id: 'viewed', clientId: 'client-a', invoiceNumber: 'INV-2', status: 'VIEWED', total: 200, currency: 'CAD',
    issueDate: new Date(), dueDate: null, title: null, notes: null, viewToken: 'tok-viewed',
    publicAccessExpiresAt: new Date(Date.now() - DAY), publicAccessRevokedAt: null, payments: [{ amount: 50 }],
  };
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(cookie);
  await app.register(jwt, { secret: 'viewed-invoice-test-secret', cookie: { cookieName: 'token', signed: false } });
  const prisma = {
    user: { findUnique: async ({ where }) => (where.id === user.id ? user : null) },
    contact: { findFirst: async () => ({ id: 'contact-a', clientId: 'client-a', email: user.email, name: user.name }) },
    client: { findFirst: async () => ({ id: 'client-a', organizationId: 'org-a', name: 'Client A' }) },
    invoice: {
      findMany: async ({ where, select }) => [invoice]
        .filter((row) => where.status.in.includes(row.status))
        .map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))),
    },
  };
  app.decorate('prisma', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
  await app.ready();

  const bearer = app.jwt.sign({ ...user, contactId: 'contact-a', typ: 'client_session' }, { expiresIn: '1h' });
  const response = await app.inject({ method: 'GET', url: '/api/client-portal/invoices', headers: { authorization: `Bearer ${bearer}` } });
  assert.equal(response.statusCode, 200, response.body);
  const [listed] = response.json();
  assert.equal(listed.id, 'viewed');
  assert.equal(listed.payUrl, '/portal/invoice/tok-viewed');
  assert.deepEqual([listed.amountPaid, listed.balanceDue], [50, 150]);
});
