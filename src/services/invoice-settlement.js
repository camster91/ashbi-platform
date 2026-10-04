// The one locked path every invoice payment takes, manual (mark-paid) or
// Stripe Checkout. Callers run it inside a transaction:
//
//   1. claimPayableInvoice: an UPDATE that only matches while the invoice is
//      payable (SENT, VIEWED or OVERDUE). Its row lock is held until commit, so
//      concurrent payments run one after the other and each reads the
//      balance only after the previous one committed.
//   2. applyInvoicePayment: reads the balance (total minus the payment
//      rows), refuses a non-positive amount (unless nothing is owed, when a
//      $0 record closes the invoice) or one above the balance, writes
//      the payment, and moves the invoice to PAID (with the invoice.paid
//      outbox event) only when the payments cover the total.
//
// Every payment also bumps stripeCheckoutAttempt: a Checkout session priced
// from the old balance can then no longer be stored (ensureCheckoutSession
// compare-and-sets on the attempt) and the next pay link uses a fresh key.
import { recordInvoicePaid } from './domain-event-producers.js';
import { CENT_TOLERANCE, invoiceAmountPaid, invoiceBalance, roundMoney, UNPAID_INVOICE_STATUSES } from '../utils/invoice-balance.js';

// Only an issued, open invoice (SENT, VIEWED or OVERDUE) takes payments: a
// DRAFT has not been sent, a PAID one is settled and a VOID one was
// cancelled. A client opening their invoice link must not make it unpayable.
export const PAYABLE_INVOICE_STATUSES = UNPAID_INVOICE_STATUSES;

export class InvoiceOverpaymentError extends Error {
  /** @param {number} balanceDue */
  constructor(balanceDue) {
    super(`Payment exceeds the balance due (${balanceDue.toFixed(2)})`);
    this.name = 'InvoiceOverpaymentError';
    this.code = 'PAYMENT_EXCEEDS_BALANCE';
    this.statusCode = 400;
    this.balanceDue = balanceDue;
  }
}

export class InvalidPaymentAmountError extends Error {
  constructor() {
    super('Payment amount must be greater than zero');
    this.name = 'InvalidPaymentAmountError';
    this.code = 'PAYMENT_AMOUNT_INVALID';
    this.statusCode = 400;
  }
}

/**
 * Claim (and lock) the invoice row while it is payable. Returns the current
 * invoice, or null when it is not payable (nothing written).
 */
export async function claimPayableInvoice(tx, invoiceId) {
  const claimed = await tx.invoice.updateMany({
    where: { id: invoiceId, status: { in: [...PAYABLE_INVOICE_STATUSES] } },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return tx.invoice.findUnique({ where: { id: invoiceId } });
}

/**
 * Apply one payment to a claimed invoice (see claimPayableInvoice).
 * `amount` defaults to the remaining balance. Throws InvalidPaymentAmountError
 * or InvoiceOverpaymentError (the caller's transaction then rolls back).
 * @param {any} tx
 * @param {{
 *   invoice: any, amount?: number | null, method: string, paidAt: Date,
 *   invoiceFields?: Record<string, unknown>, paymentFields?: Record<string, unknown>,
 *   source: 'manual' | 'stripe_checkout', correlationId?: string | null, causationId?: string | null,
 * }} input
 */
export async function applyInvoicePayment(tx, input) {
  const { invoice, method, paidAt, invoiceFields = {}, paymentFields = {}, source, correlationId = null, causationId = null } = input;
  const paidBefore = await invoiceAmountPaid(tx, invoice.id);
  const { balanceDue } = invoiceBalance(invoice.total, paidBefore);
  const amount = roundMoney(input.amount ?? balanceDue);
  // Nothing owed (a $0 invoice, or one already covered): a $0 record closes
  // it as PAID. Otherwise the amount must be positive and within the balance.
  const nothingOwed = balanceDue <= CENT_TOLERANCE;
  if (nothingOwed ? amount !== 0 : !(amount > 0)) {
    if (amount > 0) throw new InvoiceOverpaymentError(balanceDue);
    throw new InvalidPaymentAmountError();
  }
  if (amount > balanceDue + CENT_TOLERANCE) throw new InvoiceOverpaymentError(balanceDue);

  const payment = await tx.invoicePayment.create({
    data: { invoiceId: invoice.id, amount, method, paidAt, ...paymentFields },
  });
  const fullyPaid = paidBefore + amount >= roundMoney(invoice.total) - CENT_TOLERANCE;
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      paymentMethod: method,
      ...invoiceFields,
      stripeCheckoutAttempt: { increment: 1 },
      ...(fullyPaid ? { status: 'PAID', paidAt } : {}),
    },
  });
  if (fullyPaid) {
    await recordInvoicePaid(tx, {
      invoice, paymentId: payment.id, amount: payment.amount, method, source, paidAt, correlationId, causationId,
    });
  }
  return {
    payment,
    amount,
    fullyPaid,
    invoice: { ...updated, ...invoiceBalance(updated.total, paidBefore + amount) },
  };
}
