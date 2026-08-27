import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reporting = await import('../../services/financialReporting.service.js').catch(() => ({}));

test('invoice status totals stay separated by currency and do not double-count overdue sent invoices', () => {
  assert.equal(typeof reporting.buildInvoiceStats, 'function');
  const stats = reporting.buildInvoiceStats({
    statusRows: [
      { status: 'SENT', currency: 'CAD', _count: { _all: 2 }, _sum: { total: 300 } },
      { status: 'SENT', currency: 'USD', _count: { _all: 1 }, _sum: { total: 90 } },
      { status: 'PAID', currency: 'CAD', _count: { _all: 1 }, _sum: { total: 200 } },
    ],
    overdueSentRows: [
      { currency: 'CAD', _count: { _all: 1 }, _sum: { total: 100 } },
    ],
  });

  assert.deepEqual(stats.sent.byCurrency, { CAD: 300, USD: 90 });
  assert.deepEqual(stats.overdue.byCurrency, { CAD: 100 });
  assert.deepEqual(stats.totalOutstandingByCurrency, { CAD: 300, USD: 90 });
  assert.equal('amount' in stats.sent, false);
  assert.equal('totalOutstanding' in stats, false);
});

test('ledger summary reports gross refunds and net before fees without inventing settlement or profit', () => {
  assert.equal(typeof reporting.buildCollectionSummary, 'function');
  const result = reporting.buildCollectionSummary([
    {
      amountMinor: 10000,
      currency: 'CAD',
      method: 'STRIPE',
      settlementEvidenceStatus: 'VERIFIED',
      settlementGrossMinor: 10000,
      providerFeeMinor: 320,
      settlementNetMinor: 9680,
      settlementCurrency: 'CAD',
      refunds: [
        { amountMinor: 2500, currency: 'CAD', status: 'succeeded' },
        { amountMinor: 1000, currency: 'CAD', status: 'failed' },
      ],
    },
    { amountMinor: 5000, currency: 'USD', method: 'STRIPE', settlementEvidenceStatus: 'PENDING', refunds: [] },
  ]);

  assert.deepEqual(result.byCurrency.CAD, {
    grossPaidMinor: 10000,
    successfulRefundsMinor: 2500,
    netCollectedBeforeFeesMinor: 7500,
    providerFeesMinor: null,
    netSettlementMinor: null,
    feeEvidenceComplete: false,
    paymentCount: 1,
  });
  assert.equal(result.byCurrency.USD.netCollectedBeforeFeesMinor, 5000);
  assert.deepEqual(result.settlementByCurrency.CAD, {
    grossSettlementMinor: 10000,
    providerFeesMinor: 320,
    netSettlementMinor: 9680,
    paymentCount: 1,
  });
  assert.equal(result.settlementEvidencePendingCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /profit/i);
});

test('legacy payment evidence is counted but excluded from money totals', () => {
  const result = reporting.buildCollectionSummary([
    { amount: 100, amountMinor: null, currency: null, refunds: [] },
  ]);
  assert.equal(result.unresolvedPaymentCount, 1);
  assert.deepEqual(result.byCurrency, {});
});

test('refund currency mismatch fails closed', () => {
  assert.throws(() => reporting.buildCollectionSummary([
    {
      amountMinor: 10000,
      currency: 'CAD',
      refunds: [{ amountMinor: 2500, currency: 'USD', status: 'succeeded' }],
    },
  ]), /currency/i);
});

test('invoice stats and collection summary routes use tenant-scoped Prisma', () => {
  const routes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const list = routes.slice(routes.indexOf("fastify.get('/',"), routes.indexOf('// ─── GET /templates'));
  assert.match(list, /request\.prisma\.invoice\.findMany/);
  assert.match(list, /getStats\(request\.prisma\)/);
  assert.match(list, /by: \['status', 'currency'\]/);
  assert.match(routes, /fastify\.get\('\/collection-summary'/);
  assert.match(routes, /request\.prisma\.invoicePayment\.findMany/);
});

test('dashboard and collections UI never render mixed-currency dollar totals', () => {
  const dashboardRoute = readFileSync('src/routes/dashboard.routes.js', 'utf8');
  const dashboard = readFileSync('web/src/pages/Dashboard.jsx', 'utf8');
  const widget = readFileSync('web/src/components/widgets/RevenueSparklineWidget.jsx', 'utf8');
  const invoices = readFileSync('web/src/pages/Invoices.jsx', 'utf8');
  const chaser = readFileSync('web/src/pages/InvoiceChaser.jsx', 'utf8');

  assert.match(dashboardRoute, /GROUP BY month, i\.currency/);
  assert.match(dashboardRoute, /totalOutstandingByCurrency/);
  assert.match(widget, /currency/);
  assert.match(invoices, /totalOutstandingByCurrency/);
  assert.match(chaser, /outstandingByCurrency/);
  assert.doesNotMatch(dashboard, /stats\?\.totalOutstanding \|\| 0/);
  assert.doesNotMatch(chaser, /const totalOutstanding = overdueInvoices\.reduce/);
});

test('financial report copy distinguishes net before fees from net settlement', () => {
  const invoices = readFileSync('web/src/pages/Invoices.jsx', 'utf8');
  assert.match(invoices, /Net collected before fees/);
  assert.match(invoices, /Verified Stripe charge settlement/);
  assert.match(invoices, /Refunds and disputes are separate/);
  assert.match(invoices, /still awaiting fee evidence/);
  assert.doesNotMatch(invoices, /Net Profit|Gross Profit/);
});
