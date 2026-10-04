// An invoice's balance is its total minus the sum of its InvoicePayment rows;
// nothing else stores it. Shared by manual payments, Stripe Checkout (which
// charges the balance), overdue reminders and the invoice API.

// Invoices the client still owes on: sent (or viewed) and not yet paid, or
// overdue. VIEWED behaves exactly like SENT everywhere. This is the one list
// of open invoice statuses: every "outstanding" and "unpaid" figure (client
// page, dashboard, invoice stats), payability (manual and Stripe, see
// PAYABLE_INVOICE_STATUSES / SETTLEABLE_INVOICE_STATUSES), the public link
// (INVOICE_OPEN_STATUSES), the chaser and the overdue job all reuse it.
export const UNPAID_INVOICE_STATUSES = Object.freeze(['SENT', 'VIEWED', 'OVERDUE']);

// Issued and unpaid but not (yet) stored as OVERDUE: the overdue job moves
// these to OVERDUE once past due, and until it runs they count as overdue
// whenever their due date has passed.
export const SENT_INVOICE_STATUSES = Object.freeze(['SENT', 'VIEWED']);

// Money is stored as Float; amounts within half a cent are equal.
export const CENT_TOLERANCE = 0.005;

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * @param {number} total
 * @param {number} amountPaid
 * @returns {{ amountPaid: number, balanceDue: number }}
 */
export function invoiceBalance(total, amountPaid) {
  const paid = roundMoney(amountPaid);
  return { amountPaid: paid, balanceDue: roundMoney(Math.max(0, roundMoney(total) - paid)) };
}

/** Sum of the invoice's recorded payments. */
export async function invoiceAmountPaid(db, invoiceId) {
  const result = await db.invoicePayment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  return roundMoney(result?._sum?.amount ?? 0);
}

/** The invoice with amountPaid and balanceDue added (from its loaded payments when present). */
export async function withInvoiceBalance(db, invoice) {
  if (!invoice) return invoice;
  const paid = Array.isArray(invoice.payments)
    ? invoice.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
    : await invoiceAmountPaid(db, invoice.id);
  return { ...invoice, ...invoiceBalance(invoice.total, paid) };
}
