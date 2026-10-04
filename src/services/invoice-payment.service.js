// Manual invoice payments: mark paid, single and bulk (#412).
//
// The balance is the invoice total minus the sum of its InvoicePayment rows;
// nothing else stores it. A payment that leaves a balance keeps the invoice
// open (SENT/VIEWED/OVERDUE) and only a payment that covers the total moves it to
// PAID and writes the invoice.paid outbox event. A payment larger than the
// balance, or of zero or less, is refused. A DRAFT is not payable: it has to
// be sent first.
//
// Every payment, manual or Stripe Checkout, goes through the same locked path
// (src/services/invoice-settlement.js): concurrent payments run one after the
// other and there is never a double settlement or an unnoticed overpayment.
import { CLEARED_CHECKOUT_FIELDS } from './stripe.service.js';
import {
  applyInvoicePayment,
  claimPayableInvoice,
  InvalidPaymentAmountError,
  InvoiceOverpaymentError,
  PAYABLE_INVOICE_STATUSES,
} from './invoice-settlement.js';

export { invoiceAmountPaid, invoiceBalance, withInvoiceBalance } from '../utils/invoice-balance.js';
export { InvalidPaymentAmountError, InvoiceOverpaymentError, PAYABLE_INVOICE_STATUSES };

export const UNPAYABLE_STATUSES = Object.freeze(['PAID', 'VOID']);

/**
 * Record one manual payment. `amount` defaults to the remaining balance.
 * @param {any} db Prisma client (request-scoped in tenant routes)
 * @param {{
 *   invoice: { id: string, clientId: string, total: number, currency?: string | null },
 *   method: string, amount?: number | null, paidAt: Date,
 *   invoiceFields?: Record<string, unknown>, paymentFields?: Record<string, unknown>,
 *   correlationId?: string | null,
 * }} input
 * @returns {Promise<{ invoice: any, paidInvoice: any, payment: any, fullyPaid: boolean, amount: number, clearedCheckoutSessionId: string | null } | null>}
 *   null when the invoice was not payable (not SENT/VIEWED/OVERDUE) at write time
 *   (nothing was written). Throws InvoiceOverpaymentError or
 *   InvalidPaymentAmountError (nothing written).
 */
export async function recordManualPayment(db, input) {
  const { invoice, method, paidAt, invoiceFields = {}, paymentFields = {}, correlationId = null } = input;
  return db.$transaction(async (tx) => {
    const current = await claimPayableInvoice(tx, invoice.id);
    if (!current) return null;
    // Any stored Checkout session was priced for the old balance; forget it
    // so the next pay link charges what is still owed.
    const result = await applyInvoicePayment(tx, {
      invoice: current,
      amount: input.amount ?? null,
      method,
      paidAt,
      invoiceFields: { ...invoiceFields, ...CLEARED_CHECKOUT_FIELDS },
      paymentFields,
      source: 'manual',
      correlationId,
    });
    // The Checkout session cleared here, read under the row lock: the caller
    // expires this one (a session stored after its own read included).
    return { ...result, paidInvoice: result.invoice, clearedCheckoutSessionId: current.stripeCheckoutSessionId ?? null };
  });
}

/**
 * Settle an invoice in full (bulk mark-paid and older callers): records a
 * payment for the remaining balance.
 * @param {any} db
 * @param {Parameters<typeof recordManualPayment>[1]} input
 */
export async function settleInvoiceManually(db, input) {
  return recordManualPayment(db, input);
}
