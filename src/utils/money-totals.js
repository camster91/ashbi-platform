// The one place line, tax and total arithmetic is done, so an estimate, the
// proposal made from it, and the invoice made from that proposal always show
// and bill the same cents. Every amount is rounded with roundMoney
// (src/utils/invoice-balance.js: half-up to cents). Using toFixed(2) instead
// rounds a half cent down on some values (130.065 -> "130.06"), which made a
// proposal and its invoice a cent apart.

import { roundMoney } from './invoice-balance.js';

export { roundMoney };

/** A line's amount: round2(quantity * unit price). */
export function lineTotal(quantity, unitPrice) {
  return roundMoney((Number(quantity) || 0) * (Number(unitPrice) || 0));
}

/**
 * Subtotal, discount, tax and total for lines that already carry their
 * rounded `total`: subtotal = round2(sum of lines), the discount comes off
 * first (never below zero), tax = round2(pre-tax * rate / 100) and
 * total = round2(pre-tax + tax).
 * @param {Array<{ total: number }>} lines
 * @param {number} taxRate percent
 * @param {number} [discount]
 * @returns {{ subtotal: number, preTax: number, tax: number, total: number }}
 */
export function invoiceTotals(lines, taxRate, discount = 0) {
  const subtotal = roundMoney((lines || []).reduce((sum, line) => sum + (Number(line?.total) || 0), 0));
  const preTax = roundMoney(Math.max(0, subtotal - (Number(discount) || 0)));
  const tax = roundMoney((preTax * (Number(taxRate) || 0)) / 100);
  return { subtotal, preTax, tax, total: roundMoney(preTax + tax) };
}
