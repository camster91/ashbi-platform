// Shared display formatters (dates and money) so every screen renders the same
// shape: "Sep 27, 2026", "Sep 27, 2026, 3:04 PM" and "$10,170.00".
//
// There is no per-organization locale setting yet, so the workspace locale is
// a single module-level value (en-US by default, matching the USD default currency of the data model). Call
// setFormatLocale() once an organization locale exists; every helper reads it.
//
// Invoice, client-portal, PDF and email currency rendering still use their own
// formatting and should adopt formatMoney() in a follow-up.

export const DEFAULT_LOCALE = 'en-US';
export const DEFAULT_CURRENCY = 'USD';

let activeLocale = DEFAULT_LOCALE;

export function setFormatLocale(locale) {
  activeLocale = locale || DEFAULT_LOCALE;
}

export function getFormatLocale() {
  return activeLocale;
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Sep 27, 2026" — empty string for missing/invalid input. */
export function formatDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(activeLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date);
}

/** "Sep 27, 2026, 3:04 PM" — empty string for missing/invalid input. */
export function formatDateTime(value, options = {}) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(activeLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(date);
}

/**
 * "$10,170.00" (or "CA$10,170.00" when the currency differs from the locale's
 * own). `compact: true` gives "$12.2K" for KPI tiles. Non-numeric input renders
 * as a zero amount so a missing total never shows "NaN".
 */
export function formatMoney(amount, currency = DEFAULT_CURRENCY, { compact = false, ...options } = {}) {
  const numeric = Number(amount);
  const value = Number.isFinite(numeric) ? numeric : 0;
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : DEFAULT_CURRENCY;
  return new Intl.NumberFormat(activeLocale, {
    style: 'currency',
    currency: code,
    ...(compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ...options,
  }).format(value);
}
