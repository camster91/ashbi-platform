// Money and invoice-date display shared by the staff invoice pages and the
// public invoice page. Mirrors src/utils/money.js on the server so the UI,
// PDFs and emails render the same "$1,250.00 CAD" form from the invoice's own
// currency instead of a hard-coded one.

export const DEFAULT_INVOICE_CURRENCY = 'CAD';

export function formatMoney(amount, currency) {
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
    ? currency.trim().toUpperCase()
    : DEFAULT_INVOICE_CURRENCY;
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

/**
 * Invoice due/issue dates are calendar dates stored in UTC (a date-only due
 * date is the end of that day, UTC), so render them in UTC to show the day
 * that was chosen regardless of the viewer's timezone.
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
