// Stripe integration service for payment links and webhooks
import crypto from 'node:crypto';
import Stripe from 'stripe';
import env from '../config/env.js';

const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD']);
let stripe = null;

export function getStripeClient() {
  if (!stripe && env.stripeSecretKey) {
    stripe = new Stripe(env.stripeSecretKey, { apiVersion: '2026-07-29.dahlia' });
  }
  return stripe;
}

function integrationIdentifier(invoiceId, attempt) {
  const digest = crypto.createHash('sha256').update(`${invoiceId}:${attempt}`).digest();
  const suffix = [...digest.subarray(0, 8)]
    .map(byte => String.fromCharCode(97 + (byte % 26)))
    .join('');
  return `ashbi_invoice_${suffix}`;
}

function payableInvoice(invoice, now = new Date()) {
  if (!invoice?.id || !invoice.invoiceNumber || !invoice.viewToken) {
    throw new Error('Invoice checkout identity is incomplete');
  }
  if (invoice.status !== 'SENT') throw new Error('Only sent invoices can be paid');
  if (!SUPPORTED_CURRENCIES.has(invoice.currency)) throw new Error('Invoice currency is unassigned or unsupported');
  if (!Number.isFinite(invoice.total) || invoice.total <= 0) throw new Error('Invoice total must be positive');
  if (invoice.publicAccessRevokedAt) throw new Error('Invoice public access is revoked');
  if (!invoice.publicAccessExpiresAt || new Date(invoice.publicAccessExpiresAt) <= now) {
    throw new Error('Invoice public access is expired');
  }
  if (!Number.isInteger(invoice.stripeCheckoutAttempt) || invoice.stripeCheckoutAttempt < 0) {
    throw new Error('Invoice checkout attempt is invalid');
  }
  return {
    amountMinor: Math.round(invoice.total * 100),
    currency: invoice.currency.toLowerCase(),
    attempt: invoice.stripeCheckoutAttempt,
  };
}

function assertMatchingCheckout(invoice, session, { requirePaid = false } = {}) {
  if (!invoice) throw new Error('Stripe invoice metadata is invalid');
  if (!['SENT', 'PAID'].includes(invoice.status)) {
    throw new Error('Invoice is not in a payable state');
  }
  const expectedAmount = Math.round(invoice.total * 100);
  const expectedCurrency = invoice.currency?.toLowerCase();
  if (session.id !== invoice.stripeCheckoutSessionId) {
    throw new Error('Stripe session is not the invoice active checkout session');
  }
  if (requirePaid && session.payment_status !== 'paid') throw new Error('Stripe session is not paid');
  if (session.amount_total !== expectedAmount) throw new Error('Stripe paid amount does not match invoice');
  if (session.currency?.toLowerCase() !== expectedCurrency) throw new Error('Stripe currency does not match invoice');
  if (session.metadata?.invoiceNumber !== invoice.invoiceNumber) throw new Error('Stripe invoice number does not match');
}

export async function createPaymentLink(invoice) {
  const stripeClient = getStripeClient();
  if (!stripeClient) return null;

  return createPaymentLinkWithClient(invoice, stripeClient);
}

export async function createPaymentLinkWithClient(invoice, stripeClient) {
  const { amountMinor, currency, attempt } = payableInvoice(invoice);
  const session = await stripeClient.checkout.sessions.create({
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description: invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`,
        },
        unit_amount: amountMinor,
      },
      quantity: 1,
    }],
    mode: 'payment',
    integration_identifier: integrationIdentifier(invoice.id, attempt),
    success_url: `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=success`,
    cancel_url: `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=cancelled`,
    client_reference_id: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: currency.toUpperCase(),
      amountMinor: String(amountMinor),
      checkoutAttempt: String(attempt),
    },
  }, { idempotencyKey: `ashbi:invoice:${invoice.id}:checkout:${attempt}` });

  return {
    paymentLink: session.url,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
  };
}

export async function handleWebhook(payload, signature) {
  const stripeClient = getStripeClient();
  if (!stripeClient) throw new Error('Stripe not configured');

  const webhookSecret = env.stripeWebhookSecret;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const event = stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
  return event;
}

export async function recordCompletedCheckout(prisma, event) {
  const session = event.data.object;
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) throw new Error('Stripe invoice metadata is missing');
  const transactionId = session.payment_intent || session.id;

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      assertMatchingCheckout(invoice, session, { requirePaid: true });

      const transitioned = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { not: 'PAID' } },
        data: {
          status: 'PAID',
          paidAt: new Date(event.created * 1000),
          paymentMethod: 'STRIPE',
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: transactionId,
          stripeCheckoutReconciliationRequiredAt: null,
          stripeCheckoutReconciliationReason: null,
        },
      });

      if (transitioned.count === 0) {
        const prior = await tx.invoicePayment.findUnique({ where: { transactionId } });
        if (prior?.invoiceId === invoiceId) return { duplicate: true, invoiceId };
        throw new Error('Invoice was already paid by another transaction');
      }

      await tx.invoicePayment.create({
        data: {
          invoiceId,
          amount: invoice.total,
          amountMinor: session.amount_total,
          currency: invoice.currency,
          method: 'STRIPE',
          transactionId,
          paidAt: new Date(event.created * 1000),
          notes: `Paid via Stripe Checkout event ${event.id}`,
        },
      });
      return { duplicate: false, invoiceId };
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      const prior = await prisma.invoicePayment.findUnique({ where: { transactionId } });
      if (prior?.invoiceId === invoiceId) return { duplicate: true, invoiceId };
    }
    throw err;
  }
}

const REFUND_EVENT_TYPES = new Set(['refund.created', 'refund.updated', 'refund.failed']);
const REFUND_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
const INACTIVE_REFUND_STATUSES = ['failed', 'canceled'];

function providerObjectId(value) {
  if (typeof value === 'string') return value;
  return value?.id || null;
}

function assertRefundProviderSnapshot(event, webhookRefund, refund) {
  if (!event?.id || !REFUND_EVENT_TYPES.has(event.type)) throw new Error('Stripe refund event type is unsupported');
  if (!webhookRefund?.id || refund?.id !== webhookRefund.id) throw new Error('Stripe refund identity does not match');
  if (!Number.isInteger(refund.amount) || refund.amount <= 0) throw new Error('Stripe refund amount is invalid');
  if (!SUPPORTED_CURRENCIES.has(refund.currency?.toUpperCase())) throw new Error('Stripe refund currency is unsupported');
  if (!REFUND_STATUSES.has(refund.status)) throw new Error('Stripe refund status is unsupported');
  if (!REFUND_STATUSES.has(webhookRefund.status)) throw new Error('Stripe signed event status is unsupported');

  const webhookPaymentIntentId = providerObjectId(webhookRefund.payment_intent);
  const paymentIntentId = providerObjectId(refund.payment_intent);
  if (!paymentIntentId) throw new Error('Stripe refund payment intent is missing');
  if (webhookPaymentIntentId && webhookPaymentIntentId !== paymentIntentId) {
    throw new Error('Stripe refund payment intent does not match its signed event');
  }
  if (Number.isInteger(webhookRefund.amount) && webhookRefund.amount !== refund.amount) {
    throw new Error('Stripe refund amount does not match its signed event');
  }
  if (webhookRefund.currency && webhookRefund.currency.toLowerCase() !== refund.currency.toLowerCase()) {
    throw new Error('Stripe refund currency does not match its signed event');
  }
  return paymentIntentId;
}

function assertRefundPaymentEvidence(payment, refund) {
  if (!payment?.invoice || payment.method !== 'STRIPE') {
    throw new Error('Stripe refund does not match a recorded Stripe payment');
  }
  if (!Number.isInteger(payment.amountMinor) || !SUPPORTED_CURRENCIES.has(payment.currency)) {
    throw new Error('Stripe payment currency and amount evidence is incomplete');
  }
  if (payment.amountMinor !== Math.round(payment.amount * 100)) {
    throw new Error('Stripe payment amount evidence does not reconcile');
  }
  const refundCurrency = refund.currency.toUpperCase();
  if (payment.currency !== refundCurrency || payment.invoice.currency !== refundCurrency) {
    throw new Error('Stripe refund currency does not match the payment and invoice currency');
  }
  if (refund.amount > payment.amountMinor) throw new Error('Stripe refund exceeds the recorded payment');
}

function duplicateRefundResult(eventRecord) {
  return {
    state: eventRecord.status,
    duplicate: true,
    invoiceId: eventRecord.invoiceId,
    stripeRefundId: eventRecord.stripeRefundId,
  };
}

export async function reconcileRefundEvent(prisma, event, { stripeClient = getStripeClient() } = {}) {
  if (!stripeClient) throw new Error('Stripe not configured');
  const webhookRefund = event?.data?.object;
  if (!webhookRefund?.id) throw new Error('Stripe refund identity is missing');

  const priorEvent = await prisma.invoiceRefundEvent.findUnique({ where: { stripeEventId: event.id } });
  if (priorEvent) return duplicateRefundResult(priorEvent);

  const refund = await stripeClient.refunds.retrieve(webhookRefund.id);
  const paymentIntentId = assertRefundProviderSnapshot(event, webhookRefund, refund);
  const providerEventAt = new Date(event.created * 1000);
  const providerCreatedAt = new Date(refund.created * 1000);

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.invoiceRefundEvent.findUnique({ where: { stripeEventId: event.id } });
      if (duplicate) return duplicateRefundResult(duplicate);

      const payment = await tx.invoicePayment.findUnique({
        where: { transactionId: paymentIntentId },
        include: { invoice: true },
      });
      assertRefundPaymentEvidence(payment, refund);

      const existing = await tx.invoiceRefund.findUnique({ where: { stripeRefundId: refund.id } });
      if (existing && (
        existing.paymentId !== payment.id
        || existing.invoiceId !== payment.invoiceId
        || existing.amountMinor !== refund.amount
        || existing.currency !== refund.currency.toUpperCase()
      )) {
        throw new Error('Stripe refund immutable evidence changed');
      }

      const otherActiveRefunds = await tx.invoiceRefund.findMany({
        where: {
          paymentId: payment.id,
          stripeRefundId: { not: refund.id },
          status: { notIn: INACTIVE_REFUND_STATUSES },
        },
        select: { amountMinor: true },
      });
      const activeTotal = otherActiveRefunds.reduce((sum, item) => sum + item.amountMinor, 0)
        + (INACTIVE_REFUND_STATUSES.includes(refund.status) ? 0 : refund.amount);
      if (activeTotal > payment.amountMinor) throw new Error('Stripe refund total exceeds the recorded payment');

      const currentEventAt = existing?.lastProviderEventAt ? new Date(existing.lastProviderEventAt) : null;
      const advancesEventClock = !currentEventAt || providerEventAt > currentEventAt;
      const refundData = {
        status: refund.status,
        failureReason: refund.failure_reason || null,
        ...(advancesEventClock && {
          lastProviderEventAt: providerEventAt,
          lastStripeEventId: event.id,
        }),
      };
      const storedRefund = existing
        ? await tx.invoiceRefund.update({ where: { id: existing.id }, data: refundData })
        : await tx.invoiceRefund.create({
          data: {
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            stripeRefundId: refund.id,
            amountMinor: refund.amount,
            currency: refund.currency.toUpperCase(),
            status: refund.status,
            failureReason: refund.failure_reason || null,
            providerCreatedAt,
            lastProviderEventAt: providerEventAt,
            lastStripeEventId: event.id,
          },
        });

      await tx.invoiceRefundEvent.create({
        data: {
          invoiceId: payment.invoiceId,
          refundId: storedRefund.id,
          stripeRefundId: refund.id,
          stripeEventId: event.id,
          eventType: event.type,
          paymentIntentId,
          amountMinor: refund.amount,
          currency: refund.currency.toUpperCase(),
          status: refund.status,
          signedStatus: webhookRefund.status,
          providerEventAt,
        },
      });

      return {
        state: refund.status,
        duplicate: false,
        invoiceId: payment.invoiceId,
        stripeRefundId: refund.id,
      };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2002') {
      const duplicate = await prisma.invoiceRefundEvent.findUnique({ where: { stripeEventId: event.id } });
      if (duplicate) return duplicateRefundResult(duplicate);
    }
    throw error;
  }
}

export async function clearExpiredCheckout(prisma, session) {
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return false;
  const cleared = await prisma.invoice.updateMany({
    where: { id: invoiceId, stripeCheckoutSessionId: session.id, status: { not: 'PAID' } },
    data: {
      stripePaymentLink: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeCheckoutAttempt: { increment: 1 },
    },
  });
  return cleared.count > 0;
}

async function recordPendingCheckout(prisma, event) {
  const session = event.data.object;
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) throw new Error('Stripe invoice metadata is missing');
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    assertMatchingCheckout(invoice, session);
    return { state: 'pending', invoiceId };
  });
}

export async function reconcileCheckoutEvent(prisma, event) {
  const session = event.data?.object;
  const invoiceId = session?.metadata?.invoiceId;

  switch (event.type) {
    case 'checkout.session.completed':
      if (session.payment_status !== 'paid') return recordPendingCheckout(prisma, event);
      return { state: 'paid', ...await recordCompletedCheckout(prisma, event) };
    case 'checkout.session.async_payment_succeeded':
      return { state: 'paid', ...await recordCompletedCheckout(prisma, event) };
    case 'checkout.session.async_payment_failed': {
      const cleared = await clearExpiredCheckout(prisma, session);
      return { state: 'failed', invoiceId, cleared };
    }
    case 'checkout.session.expired': {
      const cleared = await clearExpiredCheckout(prisma, session);
      return { state: 'expired', invoiceId, cleared };
    }
    default:
      return { state: 'ignored', eventType: event.type };
  }
}
