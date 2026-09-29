// Invoice public links and the OVERDUE status (C5), plus collection stats
// (M-stats): a sent invoice's link must keep working until it is paid or
// voided (then for a receipt grace period), OVERDUE must be accepted wherever
// SENT is, the OVERDUE filter must find stored OVERDUE rows, and stats must
// not double count overdue money or add different currencies together.
import assert from 'node:assert/strict';
import test from 'node:test';
import invoiceRoutes from '../../routes/invoice.routes.js';
import portalRoutes from '../../routes/portal.routes.js';
import { INVOICE_RECEIPT_GRACE_DAYS, invoicePublicAccessFailure } from '../../utils/public-document-access.js';
import { createFakeInvoiceDb, buildInvoiceApp } from '../helpers/fake-invoice-db.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const past = (days) => new Date(now - days * DAY);
const future = (days) => new Date(now + days * DAY);

// A link issued on send whose legacy window ended on the (past) due date.
function overdueInvoice(overrides = {}) {
  return {
    id: 'invoice-a', invoiceNumber: 'INV-2026-0001', clientId: 'client-a', status: 'OVERDUE', total: 113, currency: 'CAD',
    dueDate: past(10), sentAt: past(40), viewToken: 'token-a', publicAccessExpiresAt: past(10), publicAccessRevokedAt: null,
    createdBy: { name: 'Staff' }, ...overrides,
  };
}

function db(invoices) {
  return createFakeInvoiceDb({
    clients: [{ id: 'client-a', name: 'Client A', contacts: [{ email: 'a@example.test', name: 'A', isPrimary: true }] }],
    invoices,
  });
}

test('an overdue invoice link keeps working past its due date', async (t) => {
  const store = db([overdueInvoice()]);
  const app = await buildInvoiceApp(t, invoiceRoutes, store);
  const staffView = await app.inject({ method: 'GET', url: '/client/token-a' });
  assert.equal(staffView.statusCode, 200, staffView.body);

  const portal = await buildInvoiceApp(t, portalRoutes, store);
  const publicView = await portal.inject({ method: 'GET', url: '/invoice/token-a' });
  assert.equal(publicView.statusCode, 200, publicView.body);
  const pay = await portal.inject({ method: 'POST', url: '/invoice/token-a/pay' });
  assert.notEqual(pay.statusCode, 410, 'an overdue invoice can still be paid');
  assert.notEqual(pay.statusCode, 409);
});

test('OVERDUE is accepted wherever SENT is: resend and payment link', async (t) => {
  const app = await buildInvoiceApp(t, invoiceRoutes, db([overdueInvoice()]));
  const resend = await app.inject({ method: 'POST', url: '/invoice-a/resend' });
  assert.notEqual(resend.statusCode, 409, resend.body);
  assert.notEqual(resend.statusCode, 410, resend.body);
  const link = await app.inject({ method: 'POST', url: '/invoice-a/payment-link' });
  assert.notEqual(link.statusCode, 409, link.body);
  assert.notEqual(link.statusCode, 410, link.body);
});

test('sending issues a link that is not tied to the due date', async (t) => {
  const store = db([{ ...overdueInvoice(), status: 'DRAFT', dueDate: future(2), publicAccessExpiresAt: null, sentAt: null }]);
  const app = await buildInvoiceApp(t, invoiceRoutes, store);
  const sent = await app.inject({ method: 'POST', url: '/invoice-a/send' });
  assert.equal(sent.statusCode, 200, sent.body);
  const [invoice] = store.state.invoices;
  // Three weeks after the due date the link still opens.
  assert.equal(invoicePublicAccessFailure({ ...invoice, status: 'OVERDUE' }, future(23)), null);
});

test('paid and void invoice links stay viewable for the receipt grace period, then expire', () => {
  assert.equal(INVOICE_RECEIPT_GRACE_DAYS, 30);
  const paid = overdueInvoice({ status: 'PAID', paidAt: past(5) });
  assert.equal(invoicePublicAccessFailure(paid), null);
  assert.equal(invoicePublicAccessFailure({ ...paid, paidAt: past(31) })?.statusCode, 410);
  const voided = overdueInvoice({ status: 'VOID', voidedAt: past(1) });
  assert.equal(invoicePublicAccessFailure(voided), null);
  assert.equal(invoicePublicAccessFailure({ ...voided, voidedAt: past(40), updatedAt: past(40) })?.statusCode, 410);
  // Revocation and never-issued links still fail closed.
  assert.equal(invoicePublicAccessFailure(overdueInvoice({ publicAccessRevokedAt: past(1) }))?.statusCode, 410);
  assert.equal(invoicePublicAccessFailure(overdueInvoice({ status: 'DRAFT', publicAccessExpiresAt: null, sentAt: null }))?.statusCode, 410);
  assert.equal(invoicePublicAccessFailure(null)?.statusCode, 404);
});

test('a void invoice can be viewed but never paid', async (t) => {
  const portal = await buildInvoiceApp(t, portalRoutes, db([overdueInvoice({ status: 'VOID', voidedAt: past(1) })]));
  const view = await portal.inject({ method: 'GET', url: '/invoice/token-a' });
  assert.equal(view.statusCode, 200, view.body);
  const pay = await portal.inject({ method: 'POST', url: '/invoice/token-a/pay' });
  assert.equal(pay.statusCode, 400);
});

test('?status=OVERDUE lists stored OVERDUE invoices and sent invoices past due', async (t) => {
  const app = await buildInvoiceApp(t, invoiceRoutes, db([
    overdueInvoice({ id: 'stored-overdue' }),
    overdueInvoice({ id: 'sent-past-due', status: 'SENT', viewToken: 't2' }),
    overdueInvoice({ id: 'sent-not-due', status: 'SENT', dueDate: future(5), viewToken: 't3' }),
  ]));
  const response = await app.inject({ method: 'GET', url: '/?status=OVERDUE' });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.invoices.map((invoice) => invoice.id).sort(), ['sent-past-due', 'stored-overdue']);
  assert.ok(body.invoices.every((invoice) => invoice.isOverdue));
});

test('stats count overdue money once and group totals by currency', async (t) => {
  const app = await buildInvoiceApp(t, invoiceRoutes, db([
    overdueInvoice({ id: 'o1', status: 'OVERDUE', total: 100 }),
    overdueInvoice({ id: 'o2', status: 'SENT', total: 50 }), // past due
    overdueInvoice({ id: 's1', status: 'SENT', dueDate: future(5), total: 30 }),
    overdueInvoice({ id: 'p1', status: 'PAID', total: 70 }),
    overdueInvoice({ id: 'd1', status: 'DRAFT', total: 5 }),
  ]));
  const stats = (await app.inject({ method: 'GET', url: '/stats' })).json();
  assert.equal(stats.overdue.count, 2);
  assert.equal(stats.overdue.amount, 150);
  assert.equal(stats.sent.count, 1);
  assert.equal(stats.sent.amount, 30);
  assert.equal(stats.totalOutstanding, 180, 'SENT + OVERDUE, each invoice once');
  assert.deepEqual(stats.currencies, ['CAD']);
  assert.equal(stats.byCurrency.CAD.totalOutstanding, 180);

  const mixed = await buildInvoiceApp(t, invoiceRoutes, db([
    overdueInvoice({ id: 'c1', status: 'SENT', dueDate: future(5), total: 100, currency: 'CAD' }),
    overdueInvoice({ id: 'u1', status: 'SENT', dueDate: future(5), total: 40, currency: 'USD' }),
  ]));
  const mixedStats = (await mixed.inject({ method: 'GET', url: '/stats' })).json();
  assert.deepEqual(mixedStats.currencies, ['CAD', 'USD']);
  assert.equal(mixedStats.mixedCurrency, true);
  assert.equal(mixedStats.totalOutstanding, null, 'no single total across currencies');
  assert.equal(mixedStats.sent.count, 2, 'counts stay meaningful across currencies');
  assert.equal(mixedStats.byCurrency.CAD.totalOutstanding, 100);
  assert.equal(mixedStats.byCurrency.USD.totalOutstanding, 40);
});
