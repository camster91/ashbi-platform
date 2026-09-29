// Invoice currency rules and money formatting shared by routes, PDFs and
// emails.
//
// Currency is stored per invoice (ISO 4217 code) and is what Stripe charges.
// Organizations do not carry a currency setting yet, so new invoices default
// to CAD unless the request names one; defaultInvoiceCurrency() is the single
// place to change once an organization currency setting exists.

export const INVOICE_CURRENCIES = Object.freeze(['CAD', 'USD', 'EUR', 'GBP']);
export const DEFAULT_INVOICE_CURRENCY = 'CAD';

/** Upper-cased supported code, or null. */
export function normalizeInvoiceCurrency(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return INVOICE_CURRENCIES.includes(code) ? code : null;
}

/** Currency for a new invoice when the request does not name one. */
export function defaultInvoiceCurrency() {
  return DEFAULT_INVOICE_CURRENCY;
}

/**
 * "$1,250.00 CAD", "$99.00 USD", "€10.00 EUR". The code is always appended so
 * dollar amounts are never ambiguous between CAD and USD.
 */
export function formatMoney(amount, currency) {
  const code = normalizeInvoiceCurrency(currency) || (typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : DEFAULT_INVOICE_CURRENCY);
  const value = Number(amount) || 0;
  let formatted;
  try {
    formatted = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    formatted = value.toFixed(2);
  }
  return `${formatted} ${code}`;
}
