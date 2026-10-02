// What a retainer plan bills each month, and in which currency. A plan may
// hold a USD rate, a CAD rate, or both (the same price quoted twice); it is
// counted once, in the currency the Retainers page invoices it in: USD when a
// USD rate is set, otherwise CAD. MRR is reported per currency, because
// adding CAD to USD means nothing.

import { defaultInvoiceCurrency } from './money.js';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** @returns {{ amount: number, currency: 'USD' | 'CAD' } | null} */
export function retainerMonthlyCharge(plan) {
  const usd = Number(plan?.monthlyAmountUsd) || 0;
  if (usd > 0) return { amount: roundMoney(usd), currency: 'USD' };
  const cad = Number(plan?.monthlyAmountCad) || 0;
  if (cad > 0) return { amount: roundMoney(cad), currency: 'CAD' };
  return null;
}

/**
 * The single-number MRR fields from per-currency totals: `mrr` and
 * `mrrCurrency` are filled when at most one currency is in use (no retainers
 * reads as 0 in the workspace default currency); with several, `mrr` and
 * `mrrCurrency` are null and only `mrrByCurrency` carries amounts.
 * @param {Record<string, number>} byCurrency
 */
export function mrrSummary(byCurrency) {
  const entries = Object.entries(byCurrency || {}).filter(([, amount]) => amount > 0);
  const mrrByCurrency = Object.fromEntries(entries.map(([code, amount]) => [code, roundMoney(amount)]));
  if (entries.length === 0) return { mrr: 0, mrrCurrency: defaultInvoiceCurrency(), mrrByCurrency };
  if (entries.length === 1) return { mrr: mrrByCurrency[entries[0][0]], mrrCurrency: entries[0][0], mrrByCurrency };
  return { mrr: null, mrrCurrency: null, mrrByCurrency };
}
