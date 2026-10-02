// An invoice's balance is its total minus the sum of its InvoicePayment rows;
// nothing else stores it. Shared by manual payments, Stripe Checkout (which
// charges the balance), overdue reminders and the invoice API.

// Invoices the client still owes on: sent (or viewed) and not yet paid, or
// overdue. One list for every "outstanding" and "unpaid" figure (client
// page, dashboard). Paying through the public link is governed separately
// by INVOICE_OPEN_STATUSES in public-document-access.js.
export const UNPAID_INVOICE_STATUSES = Object.freeze(['SENT', 'VIEWED', 'OVERDUE']);

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
