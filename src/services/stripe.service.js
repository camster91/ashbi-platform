// Stripe integration service for payment links and webhooks
import crypto from 'node:crypto';
import Stripe from 'stripe';
import env from '../config/env.js';

const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD']);
let stripe = null;

function getStripe() {
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
  const stripeClient = getStripe();
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
  const stripeClient = getStripe();
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
