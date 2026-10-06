// Mirrors src/utils/money-totals.js: the one line, tax and total arithmetic,
// rounded half-up to cents, so form previews show exactly what the API
// stores and bills. (toFixed(2) rounds some half cents down.)

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function lineTotal(quantity, unitPrice) {
  return roundMoney((Number(quantity) || 0) * (Number(unitPrice) || 0));
}

/** @returns {{ subtotal: number, preTax: number, tax: number, total: number }} */
export function invoiceTotals(lines, taxRate, discount = 0) {
  const subtotal = roundMoney((lines || []).reduce((sum, line) => sum + (Number(line?.total) || 0), 0));
  const preTax = roundMoney(Math.max(0, subtotal - (Number(discount) || 0)));
  const tax = roundMoney((preTax * (Number(taxRate) || 0)) / 100);
  return { subtotal, preTax, tax, total: roundMoney(preTax + tax) };
}
