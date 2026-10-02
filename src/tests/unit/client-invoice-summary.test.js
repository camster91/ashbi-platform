// The client page's "outstanding" is what the client still owes: each open
// invoice's balance after its payments (a $1,130 invoice with $300 paid is
// $830 outstanding), over SENT, VIEWED and OVERDUE invoices, per currency.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import clientRoutes, { CLIENT_OUTSTANDING_STATUSES, clientInvoiceSummary } from '../../routes/client.routes.js';

const DAY = 24 * 60 * 60 * 1000;

function invoice(id, status, total, { paid = [], currency = 'CAD', dueDate = null } = {}) {
  return { id, status, total, currency, dueDate, payments: paid.map((amount) => ({ amount })) };
}

test('outstanding is the balance after payments, not the total', () => {
  const summary = clientInvoiceSummary([invoice('a', 'SENT', 1130, { paid: [300] })]);
  assert.equal(summary.outstandingBalance, 830);
  assert.equal(summary.outstandingCurrency, 'CAD');
  assert.deepEqual([summary.invoices[0].amountPaid, summary.invoices[0].balanceDue], [300, 830]);
  assert.equal('payments' in summary.invoices[0], false, 'payment rows are not passed through');
});

test('outstanding counts SENT, VIEWED and OVERDUE; never drafts, paid or void', () => {
  assert.deepEqual([...CLIENT_OUTSTANDING_STATUSES].sort(), ['OVERDUE', 'SENT', 'VIEWED']);
  const summary = clientInvoiceSummary([
    invoice('sent', 'SENT', 100),
    invoice('viewed', 'VIEWED', 50),
    invoice('overdue', 'OVERDUE', 200, { paid: [25.5] }),
    invoice('draft', 'DRAFT', 999),
    invoice('paid', 'PAID', 500, { paid: [500] }),
    invoice('void', 'VOID', 777),
  ]);
  assert.equal(summary.outstandingBalance, 100 + 50 + 174.5);
  assert.equal(summary.totalRevenue, 500);
  assert.equal(summary.revenueCurrency, 'CAD');
});

test('several currencies are reported apart, never added', () => {
  const summary = clientInvoiceSummary([
    invoice('cad', 'SENT', 1130, { paid: [300] }),
    invoice('usd', 'OVERDUE', 99, { currency: 'USD' }),
  ]);
  assert.equal(summary.outstandingBalance, null);
  assert.equal(summary.outstandingCurrency, null);
  assert.deepEqual(summary.outstandingByCurrency, { CAD: 830, USD: 99 });
});

test('nothing owed reads as zero; a fully paid open invoice adds nothing', () => {
  const summary = clientInvoiceSummary([invoice('a', 'SENT', 100, { paid: [100] })]);
  assert.equal(summary.outstandingBalance, 0);
  assert.deepEqual(summary.outstandingByCurrency, {});
  assert.equal(summary.totalRevenue, 0);
});

test('a SENT invoice past its due date is flagged overdue', () => {
  const summary = clientInvoiceSummary([
    invoice('late', 'SENT', 10, { dueDate: new Date(Date.now() - DAY) }),
    invoice('stored', 'OVERDUE', 10),
    invoice('future', 'SENT', 10, { dueDate: new Date(Date.now() + DAY) }),
    invoice('viewed-late', 'VIEWED', 10, { dueDate: new Date(Date.now() - DAY) }),
  ]);
  assert.deepEqual(summary.invoices.map((row) => row.isOverdue), [true, true, false, true]);
});

test('GET /:id returns the balance-based outstanding amount', async (t) => {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'ADMIN', organizationId: 'org-1' }; });
  const prisma = {
    client: {
      findUnique: async ({ include }) => {
        assert.ok(include.invoices.include.payments, 'payments are loaded with the invoices');
        return {
          id: 'client-1', name: 'Acme', contacts: [], projects: [], threads: [],
          communicationPrefs: null, satisfactionSignals: null, knowledgeBase: null,
          invoices: [invoice('a', 'SENT', 1130, { paid: [300] }), invoice('b', 'VIEWED', 70)],
        };
      },
    },
  };
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(clientRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/client-1' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().outstandingBalance, 900);
  assert.deepEqual(response.json().outstandingByCurrency, { CAD: 900 });
});
