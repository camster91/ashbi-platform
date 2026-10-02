// What an invoice's status pill and money line say, from the stored status
// plus the payment fields the API adds (amountPaid / balanceDue, see
// src/utils/invoice-balance.js). One helper so the invoice list, the invoice
// page, the client page and the client portal all agree.
import { formatDate } from './format';

// Money is stored as Float; amounts within half a cent are equal (as on the
// server).
const CENT = 0.005;
// Invoices the client still owes on (mirrors UNPAID_INVOICE_STATUSES in
// src/utils/invoice-balance.js): every "outstanding" / "unpaid" figure.
export const UNPAID_INVOICE_STATUSES = Object.freeze(['SENT', 'VIEWED', 'OVERDUE']);
const OPEN_STATUSES = UNPAID_INVOICE_STATUSES;

/** True when an open invoice has some payments recorded and a balance left. */
export function isPartlyPaid(invoice) {
  if (!invoice || !OPEN_STATUSES.includes(String(invoice.status || '').toUpperCase())) return false;
  return (Number(invoice.amountPaid) || 0) > CENT && (Number(invoice.balanceDue) || 0) > CENT;
}

/**
 * The status key to show: OVERDUE for an open invoice past its due date (the
 * API's isOverdue flag), PARTLY_PAID for an open invoice with payments and a
 * balance left, otherwise the stored status.
 */
export function invoiceDisplayStatus(invoice) {
  if (!invoice) return 'DRAFT';
  const status = String(invoice.status || '').toUpperCase();
  if (status === 'OVERDUE' || (invoice.isOverdue && OPEN_STATUSES.includes(status))) return 'OVERDUE';
  if (isPartlyPaid(invoice)) return 'PARTLY_PAID';
  return status;
}

/** What is still owed: the API's balanceDue, else the total. */
export function invoiceBalanceDue(invoice) {
  if (!invoice) return 0;
  const balance = Number(invoice.balanceDue);
  return invoice.balanceDue !== undefined && invoice.balanceDue !== null && Number.isFinite(balance)
    ? balance
    : (Number(invoice.total) || 0);
}

/**
 * The tax line's name: "HST", "GST", "PST", "Tax" (the neutral label the API
 * stores as TAX for a rate that is not a named Canadian tax) or "No tax".
 */
export function taxTypeLabel(taxType) {
  const key = String(taxType || '').toUpperCase();
  if (!key || key === 'TAX') return 'Tax';
  if (key === 'NONE') return 'No tax';
  return key;
}

const INTERVAL_WORDS = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'every 3 months',
  ANNUALLY: 'yearly',
  YEARLY: 'yearly',
};

/** "monthly", "every 3 months", "yearly"; null when there is no interval. */
export function recurrenceWord(interval) {
  if (!interval) return null;
  const key = String(interval).toUpperCase();
  return INTERVAL_WORDS[key] ?? key.toLowerCase().replace(/_/g, ' ');
}

/**
 * "Repeats monthly · next on Nov 2, 2026" for a recurring invoice, "Repeats
 * monthly" when no next date is set; null when the invoice does not repeat.
 * The next date is a calendar date stored in UTC, so it is shown in UTC.
 */
export function recurrenceSummary(invoice) {
  if (!invoice?.isRecurring) return null;
  const word = recurrenceWord(invoice.recurringInterval);
  const base = word ? `Repeats ${word}` : 'Repeats';
  const next = invoice.recurringNextDate ? formatDate(invoice.recurringNextDate, { dateOnly: true }) : '';
  return next ? `${base} · next on ${next}` : base;
}
