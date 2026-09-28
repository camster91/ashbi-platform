// Manual invoice settlement (mark paid), single and bulk (#412).
//
// Compare-and-set: the invoice only moves to PAID if it is not already PAID
// or VOID at write time, and the payment row and the invoice.paid outbox
// event are written in the same transaction. Two concurrent mark-paid
// requests, or a mark-paid racing a Stripe checkout completion, therefore
// produce exactly one payment and one invoice.paid event.
import { recordInvoicePaid } from './domain-event-producers.js';

export const UNPAYABLE_STATUSES = Object.freeze(['PAID', 'VOID']);

/**
 * @param {any} db Prisma client (request-scoped in tenant routes)
 * @param {{
 *   invoice: { id: string, clientId: string, total: number, currency?: string | null },
 *   method: string, amount: number, paidAt: Date,
 *   invoiceFields?: Record<string, unknown>, paymentFields?: Record<string, unknown>,
 *   correlationId?: string | null,
 * }} input
 * @returns {Promise<{ paidInvoice: any, payment: any } | null>} null when the
 *   invoice was no longer payable at write time (nothing was written).
 */
export async function settleInvoiceManually(db, input) {
  const { invoice, method, amount, paidAt, invoiceFields = {}, paymentFields = {}, correlationId = null } = input;
  return db.$transaction(async (tx) => {
    const transitioned = await tx.invoice.updateMany({
      where: { id: invoice.id, status: { notIn: [...UNPAYABLE_STATUSES] } },
      data: { status: 'PAID', paidAt, paymentMethod: method, ...invoiceFields },
    });
    if (transitioned.count !== 1) return null;
    const payment = await tx.invoicePayment.create({
      data: { invoiceId: invoice.id, amount, method, paidAt, ...paymentFields },
    });
    await recordInvoicePaid(tx, {
      invoice, paymentId: payment.id, amount: payment.amount, method, source: 'manual', paidAt, correlationId,
    });
    const paidInvoice = await tx.invoice.findUnique({ where: { id: invoice.id } });
    return { paidInvoice, payment };
  });
}
