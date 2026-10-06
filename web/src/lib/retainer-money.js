// Retainer money, mirroring src/utils/retainer-money.js: a plan with a USD
// rate bills in USD, a plan with only a CAD rate in CAD (the currency the
// Retainers page invoices it in). Totals are kept per currency and never
// added across currencies.
import { DEFAULT_CURRENCY, formatMoney } from './format';

/** @returns {{ amount: number, currency: 'USD' | 'CAD' } | null} */
export function retainerMonthlyCharge(plan) {
  const usd = Number(plan?.monthlyAmountUsd) || 0;
  if (usd > 0) return { amount: usd, currency: 'USD' };
  const cad = Number(plan?.monthlyAmountCad) || 0;
  if (cad > 0) return { amount: cad, currency: 'CAD' };
  return null;
}

/** { CAD: 3000, USD: 999 } for the given plans. */
export function monthlyRevenueByCurrency(plans) {
  const totals = {};
  for (const plan of plans || []) {
    const charge = retainerMonthlyCharge(plan);
    if (!charge) continue;
    totals[charge.currency] = Math.round(((totals[charge.currency] || 0) + charge.amount) * 100) / 100;
  }
  return totals;
}

/**
 * "$3,000.00" for one currency, "$3,000.00 · US$999.00" for several, and a
 * zero in `fallbackCurrency` when there is nothing.
 */
export function formatByCurrency(byCurrency, { fallbackCurrency = DEFAULT_CURRENCY, ...options } = {}) {
  const entries = Object.entries(byCurrency || {}).filter(([, amount]) => Number(amount) > 0);
  if (entries.length === 0) return formatMoney(0, fallbackCurrency, options);
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoney(amount, currency, options))
    .join(' · ');
}

/**
 * The dashboard MRR figure from the stats API: per currency when the API
 * sends mrrByCurrency, else the single mrr in mrrCurrency.
 */
export function mrrLabel(stats) {
  if (stats?.mrrByCurrency && Object.keys(stats.mrrByCurrency).length > 0) {
    return formatByCurrency(stats.mrrByCurrency, { compact: true });
  }
  return formatMoney(stats?.mrr || 0, stats?.mrrCurrency || DEFAULT_CURRENCY, { compact: true });
}
