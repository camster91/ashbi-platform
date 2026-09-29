// Shared display formatters (dates and money) so every screen renders the same
// shape: "Sep 27, 2026", "Sep 27, 2026, 3:04 p.m." and "$10,170.00".
//
// There is no per-organization locale setting yet, so the workspace locale is
// a single module-level value: Canadian English, matching the CAD invoice
// default (CAD renders as "$", other currencies get their prefix, e.g.
// "US$"). Call setFormatLocale() once an organization locale exists.
//
// Invoice documents (staff invoice pages, the public invoice page and the
// client portal) use formatInvoiceMoney(), the "$1,250.00 CAD" form that the
// server's PDFs and emails also render (src/utils/money.js).

export const DEFAULT_LOCALE = 'en-CA';
// Matches the app's invoice default.
export const DEFAULT_CURRENCY = 'CAD';

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

/**
 * "Sep 27, 2026" — empty string for missing/invalid input.
 * `dateOnly: true` is for calendar dates stored as midnight UTC (a project's
 * start/end date): it formats in UTC so viewers west of UTC do not see the
 * previous day.
 */
export function formatDate(value, { dateOnly = false, ...options } = {}) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(activeLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
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
 * "$10,170.00" for CAD in the default en-CA locale ("US$10,170.00" for USD).
 * Pass the record's currency when known; the default is CAD. `compact: true`
 * gives "$12.2K" for KPI tiles. Non-numeric input renders as a zero amount so
 * a missing total never shows "NaN".
 */
export function formatMoney(amount, currency = DEFAULT_CURRENCY, { compact = false, ...options } = {}) {
  const numeric = Number(amount);
  const value = Number.isFinite(numeric) ? numeric : 0;
  const code = currencyCode(currency);
  return new Intl.NumberFormat(activeLocale, {
    style: 'currency',
    currency: code,
    ...(compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ...options,
  }).format(value);
}

function currencyCode(currency) {
  return typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
    ? currency.trim().toUpperCase()
    : DEFAULT_CURRENCY;
}

/**
 * "$1,250.00 CAD" — the invoice-document form, with the currency code always
 * spelled out. Mirrors src/utils/money.js on the server (fixed en-CA locale,
 * narrow symbol) so the UI, PDFs and emails render an invoice identically.
 */
export function formatInvoiceMoney(amount, currency) {
  const code = currencyCode(currency);
  const value = Number(amount) || 0;
  let formatted;
  try {
    formatted = new Intl.NumberFormat(DEFAULT_LOCALE, {
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

/**
 * Invoice due/issue dates are calendar dates stored in UTC (a date-only due
 * date is the end of that day, UTC), so render them in UTC to show the day
 * that was chosen regardless of the viewer's timezone. "—" when missing.
 */
export function formatInvoiceDate(date, { month = 'short' } = {}) {
  if (!date) return '—';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  return value.toLocaleDateString(undefined, { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' });
}

/** "YYYY-MM-DD" for an <input type="date"> from a stored invoice date. */
export function toDateInputValue(date) {
  if (!date) return '';
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}
