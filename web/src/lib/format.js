// Shared display formatters (dates and money) so every screen renders the same
// shape: "Sep 27, 2026", "Sep 27, 2026, 3:04 p.m." and "$10,170.00".
//
// There is no per-organization locale setting yet, so the workspace locale is
// a single module-level value: Canadian English, matching the CAD invoice
// default (CAD renders as "$", other currencies get their prefix, e.g.
// "US$"). Call setFormatLocale() once an organization locale exists.
//
// Invoice, client-portal, PDF and email currency rendering live on the payments
// branch (its own money helper) and will be unified with formatMoney() later.

export const DEFAULT_LOCALE = 'en-CA';
// Matches the app's invoice default. The payments branch keeps its own
// money helper for invoice/portal/PDF/email; the two will be unified later.
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
