const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD']);
const STATUS_KEYS = ['draft', 'sent', 'paid', 'overdue', 'void'];

function currencyKey(currency) {
  return SUPPORTED_CURRENCIES.has(currency) ? currency : 'UNASSIGNED';
}

function addAmount(target, currency, amount) {
  const key = currencyKey(currency);
  target[key] = Math.round(((target[key] || 0) + (Number(amount) || 0)) * 100) / 100;
}

function emptyStatus() {
  return { count: 0, byCurrency: {} };
}

export function buildInvoiceStats({ statusRows = [], overdueSentRows = [] }) {
  const stats = Object.fromEntries(STATUS_KEYS.map(status => [status, emptyStatus()]));

  for (const row of statusRows) {
    const key = row.status?.toLowerCase();
    if (!stats[key]) continue;
    stats[key].count += Number(row._count?._all) || 0;
    addAmount(stats[key].byCurrency, row.currency, row._sum?.total);
  }

  // Past-due SENT invoices are a view over SENT, not an additional outstanding
  // balance. They belong in the overdue display but must never be added twice.
  for (const row of overdueSentRows) {
    stats.overdue.count += Number(row._count?._all) || 0;
    addAmount(stats.overdue.byCurrency, row.currency, row._sum?.total);
  }

  const totalOutstandingByCurrency = {};
  for (const [currency, amount] of Object.entries(stats.sent.byCurrency)) {
    addAmount(totalOutstandingByCurrency, currency, amount);
  }
  // Only stored OVERDUE rows are additional to SENT. The derived past-due SENT
  // view is already inside stats.sent and must not be added again.
  for (const row of statusRows.filter(row => row.status === 'OVERDUE')) {
    addAmount(totalOutstandingByCurrency, row.currency, row._sum?.total);
  }

  const storedOverdueCount = statusRows
    .filter(row => row.status === 'OVERDUE')
    .reduce((sum, row) => sum + (Number(row._count?._all) || 0), 0);
  return {
    ...stats,
    totalOutstandingByCurrency,
    totalOutstandingCount: stats.sent.count + storedOverdueCount,
  };
}

function emptyCollectionCurrency() {
  return {
    grossPaidMinor: 0,
    successfulRefundsMinor: 0,
    netCollectedBeforeFeesMinor: 0,
    providerFeesMinor: null,
    netSettlementMinor: null,
    feeEvidenceComplete: false,
    paymentCount: 0,
  };
}

export function buildCollectionSummary(payments = []) {
  const byCurrency = {};
  let unresolvedPaymentCount = 0;

  for (const payment of payments) {
    if (!Number.isInteger(payment.amountMinor) || !SUPPORTED_CURRENCIES.has(payment.currency)) {
      unresolvedPaymentCount += 1;
      continue;
    }
    const currency = payment.currency;
    const summary = byCurrency[currency] || emptyCollectionCurrency();
    summary.grossPaidMinor += payment.amountMinor;
    summary.paymentCount += 1;

    for (const refund of payment.refunds || []) {
      if (refund.currency !== currency) throw new Error('Refund currency does not match its payment');
      if (refund.status === 'succeeded') summary.successfulRefundsMinor += refund.amountMinor;
    }
    summary.netCollectedBeforeFeesMinor = summary.grossPaidMinor - summary.successfulRefundsMinor;
    byCurrency[currency] = summary;
  }

  return {
    byCurrency,
    unresolvedPaymentCount,
    basis: 'RECORDED_PAYMENTS_LESS_SUCCESSFUL_REFUNDS_BEFORE_PROVIDER_FEES',
  };
}
