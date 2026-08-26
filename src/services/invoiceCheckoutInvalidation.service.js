import { createPublicAccessWindow } from '../utils/public-document-access.js';
import { getStripeClient } from './stripe.service.js';

const ACTIONS = new Set(['REVOKE', 'ROTATE', 'VOID']);

export class InvoiceCheckoutInvalidationError extends Error {
  constructor(message, code, statusCode, { providerStatus = null } = {}) {
    super(message);
    this.name = 'InvoiceCheckoutInvalidationError';
    this.code = code;
    this.statusCode = statusCode;
    this.reconciliationRequired = true;
    this.providerStatus = providerStatus;
  }
}

function unknownOutcome() {
  return new InvoiceCheckoutInvalidationError(
    'Stripe checkout invalidation could not be confirmed',
    'CHECKOUT_INVALIDATION_OUTCOME_UNKNOWN',
    503,
  );
}

export async function expireInvoiceCheckoutWithClient(invoice, stripeClient) {
  if (!invoice.stripeCheckoutSessionId) {
    return { state: 'not_required', providerStatus: null, paymentStatus: null };
  }
  if (!stripeClient) throw unknownOutcome();

  try {
    const session = await stripeClient.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
    if (session.status === 'expired') {
      return { state: 'expired', providerStatus: session.status, paymentStatus: session.payment_status };
    }
    if (session.status === 'complete') {
      if (invoice.status === 'PAID') {
        return { state: 'completed', providerStatus: session.status, paymentStatus: session.payment_status };
      }
      throw new InvoiceCheckoutInvalidationError(
        'Stripe checkout completed before invalidation and must be reconciled',
        'CHECKOUT_COMPLETED_RECONCILIATION_REQUIRED',
        409,
        { providerStatus: session.status },
      );
    }
    if (session.status !== 'open') throw unknownOutcome();

    const expired = await stripeClient.checkout.sessions.expire(
      invoice.stripeCheckoutSessionId,
      {},
      { idempotencyKey: `ashbi:invoice:${invoice.id}:checkout:${invoice.stripeCheckoutAttempt}:invalidate` },
    );
    if (expired.status !== 'expired') throw unknownOutcome();
    return { state: 'expired', providerStatus: expired.status, paymentStatus: expired.payment_status };
  } catch (error) {
    if (error instanceof InvoiceCheckoutInvalidationError) throw error;
    throw unknownOutcome();
  }
}

async function recordReconciliationRequired({ prisma, invoice, action, actorUserId, error, now }) {
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        stripeCheckoutReconciliationRequiredAt: now,
        stripeCheckoutReconciliationReason: error.code,
      },
    });
    await tx.invoiceCheckoutAudit.create({
      data: {
        invoiceId: invoice.id,
        checkoutSessionId: invoice.stripeCheckoutSessionId,
        checkoutAttempt: invoice.stripeCheckoutAttempt,
        action,
        outcome: 'RECONCILIATION_REQUIRED',
        providerStatus: error.providerStatus,
        reasonCode: error.code,
        actorUserId,
        createdAt: now,
      },
    });
  });
}

function confirmedData({ invoice, action, now, accessFactory }) {
  const data = {
    stripePaymentLink: null,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeCheckoutReconciliationRequiredAt: null,
    stripeCheckoutReconciliationReason: null,
    ...(invoice.stripeCheckoutSessionId && { stripeCheckoutAttempt: { increment: 1 } }),
  };

  if (action === 'REVOKE') data.publicAccessRevokedAt = now;
  if (action === 'ROTATE') {
    const access = accessFactory();
    data.viewToken = access.token;
    data.publicAccessExpiresAt = access.expiresAt;
    data.publicAccessRevokedAt = access.revokedAt;
  }
  if (action === 'VOID') {
    data.status = 'VOID';
    data.voidedAt = now;
    data.voidedFromStatus = invoice.status;
    data.publicAccessRevokedAt = now;
  }
  return data;
}

export async function invalidateInvoiceCheckout({
  prisma,
  invoice,
  action,
  actorUserId,
  stripeClient = getStripeClient(),
  now = new Date(),
  accessFactory = createPublicAccessWindow,
}) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported invoice checkout invalidation action');

  let providerResult = { state: 'not_required', providerStatus: null, paymentStatus: null };
  if (invoice.stripeCheckoutSessionId) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { publicAccessRevokedAt: now, stripePaymentLink: null },
    });
    try {
      providerResult = await expireInvoiceCheckoutWithClient(invoice, stripeClient);
    } catch (error) {
      await recordReconciliationRequired({ prisma, invoice, action, actorUserId, error, now });
      throw error;
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: confirmedData({ invoice, action, now, accessFactory }),
    });
    await tx.invoiceCheckoutAudit.create({
      data: {
        invoiceId: invoice.id,
        checkoutSessionId: invoice.stripeCheckoutSessionId,
        checkoutAttempt: invoice.stripeCheckoutAttempt,
        action,
        outcome: 'CONFIRMED',
        providerStatus: providerResult.providerStatus,
        reasonCode: null,
        actorUserId,
        createdAt: now,
      },
    });
    return updated;
  });
}
