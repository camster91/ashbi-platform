// Stripe integration service for payment links and webhooks
import crypto from 'crypto';
import Stripe from 'stripe';
import env from '../config/env.js';
import { recordAuditEvent } from './audit-event.service.js';

let stripe = null;

function getStripe() {
  if (!stripe && env.stripeSecretKey) {
    stripe = new Stripe(env.stripeSecretKey);
  }
  return stripe;
}

export async function createPaymentLink(invoice) {
  const stripeClient = getStripe();
  if (!stripeClient) return null;

  return createPaymentLinkWithClient(invoice, stripeClient);
}

// Reuse an open session only while it has at least this long left, so a
// client is never redirected to a Checkout page that expires mid-payment.
const CHECKOUT_REUSE_MARGIN_MS = 5 * 60 * 1000;

export function checkoutAmountMinor(invoice) {
  return Math.round(Number(invoice.total || 0) * 100);
}

export function checkoutCurrency(invoice) {
  return (invoice.currency || 'CAD').toLowerCase();
}

/**
 * Stripe idempotency key for one Checkout creation request.
 *
 * Stripe caches a key for 24h and rejects (or replays) any later request that
 * reuses it. A single per-invoice key therefore broke every legitimate new
 * session: an edited total, a rotated public link, or a session that expired
 * inside that window. The key now covers everything that makes the request
 * distinct — the attempt counter (bumped after each stored session), the
 * amount/currency, and a digest of the remaining request parameters — while
 * rapid duplicate retries of the *same* request still share one key and so
 * cannot create two sessions.
 */
export function checkoutIdempotencyKey(invoice, params) {
  const attempt = Number.isInteger(invoice.stripeCheckoutAttempt) ? invoice.stripeCheckoutAttempt : 0;
  const digest = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  return `ashbi:invoice:${invoice.id}:checkout:${attempt}:${params.currency}:${params.amountMinor}:${digest}`;
}

/**
 * Return the stored Checkout URL when it is still safe to hand out: same
 * amount and currency as the invoice now has, and not expired (or about to).
 */
export function reusableCheckoutLink(invoice, now = new Date()) {
  if (!invoice.stripePaymentLink || !invoice.stripeCheckoutSessionId) return null;
  if (invoice.stripeCheckoutAmountMinor !== checkoutAmountMinor(invoice)) return null;
  if ((invoice.stripeCheckoutCurrency || '').toLowerCase() !== checkoutCurrency(invoice)) return null;
  if (!invoice.stripeCheckoutExpiresAt) return null;
  if (new Date(invoice.stripeCheckoutExpiresAt).getTime() - now.getTime() <= CHECKOUT_REUSE_MARGIN_MS) return null;
  return invoice.stripePaymentLink;
}

export async function createPaymentLinkWithClient(invoice, stripeClient) {
  const currency = checkoutCurrency(invoice);
  const amountMinor = checkoutAmountMinor(invoice);
  const description = invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`;
  const successUrl = `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=success`;
  const cancelUrl = `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=cancelled`;
  const idempotencyKey = checkoutIdempotencyKey(invoice, {
    currency, amountMinor, invoiceNumber: invoice.invoiceNumber, description, successUrl, cancelUrl,
  });

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description,
        },
        unit_amount: amountMinor,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: currency.toUpperCase(),
      amountMinor: String(amountMinor),
    },
  }, { idempotencyKey });

  return {
    paymentLink: session.url,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
    amountMinor,
    currency,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    idempotencyKey,
  };
}

/**
 * Fields to persist on the invoice after a session was created. Bumping the
 * attempt counter here is what lets the *next* creation (after expiry or an
 * edit) use a fresh idempotency key.
 */
export function checkoutPersistenceData(invoice, result) {
  const attempt = Number.isInteger(invoice.stripeCheckoutAttempt) ? invoice.stripeCheckoutAttempt : 0;
  return {
    stripePaymentLink: result.paymentLink,
    stripeCheckoutSessionId: result.checkoutSessionId,
    stripePaymentIntentId: result.paymentIntentId,
    stripeCheckoutAmountMinor: result.amountMinor,
    stripeCheckoutCurrency: result.currency,
    stripeCheckoutExpiresAt: result.expiresAt,
    stripeCheckoutAttempt: attempt + 1,
  };
}

/**
 * Reuse the invoice's open Checkout session when it still matches, otherwise
 * create a new one and persist it. Returns null when Stripe is not configured.
 */
export async function ensureCheckoutSession(prisma, invoice, { stripeClient = getStripe(), now = new Date() } = {}) {
  const reusable = reusableCheckoutLink(invoice, now);
  if (reusable) return { paymentLink: reusable, reused: true };
  if (!stripeClient) return null;

  const result = await createPaymentLinkWithClient(invoice, stripeClient);
  const data = checkoutPersistenceData(invoice, result);
  await prisma.invoice.update({ where: { id: invoice.id }, data });
  return { paymentLink: result.paymentLink, reused: false, data };
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
      if (!invoice) throw new Error('Stripe invoice metadata is invalid');

      const expectedAmount = Math.round(invoice.total * 100);
      const expectedCurrency = (invoice.currency || 'CAD').toLowerCase();
      if (session.payment_status !== 'paid') throw new Error('Stripe session is not paid');
      if (session.amount_total !== expectedAmount) throw new Error('Stripe paid amount does not match invoice');
      if (session.currency?.toLowerCase() !== expectedCurrency) throw new Error('Stripe currency does not match invoice');
      if (session.metadata?.invoiceNumber !== invoice.invoiceNumber) throw new Error('Stripe invoice number does not match');

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

/**
 * Audit a newly settled Checkout (not a replayed delivery). Webhooks carry no
 * tenant context, so the owner is resolved from the invoice. Never throws.
 * @param {any} prisma
 * @param {any} request Fastify request (correlation id + network prefix)
 * @param {any} event Verified Stripe event
 * @param {{ duplicate: boolean, invoiceId: string } | undefined} result
 */
export async function recordCheckoutAuditEvents(prisma, request, event, result) {
  if (!result || result.duplicate) return;
  const session = event?.data?.object || {};
  const transactionId = session.payment_intent || session.id;
  let payment = null;
  try {
    payment = await prisma.invoicePayment.findUnique({
      where: { transactionId },
      select: { id: true, amount: true },
    });
  } catch {
    payment = null;
  }
  const shared = {
    ownerInvoiceId: result.invoiceId,
    actorType: 'WEBHOOK',
    actorUserId: null,
    requestId: request?.id ?? null,
    ip: null,
  };
  await recordAuditEvent(prisma, {
    ...shared,
    action: 'invoice.paid',
    entityId: result.invoiceId,
    metadata: { toStatus: 'PAID', method: 'STRIPE', stripeEventId: event?.id, currency: session.currency },
  });
  await recordAuditEvent(prisma, {
    ...shared,
    action: 'payment.recorded',
    entityId: payment?.id ?? null,
    metadata: {
      invoiceId: result.invoiceId,
      amount: payment?.amount,
      method: 'STRIPE',
      source: 'stripe_checkout',
      stripeEventId: event?.id,
      currency: session.currency,
    },
  });
}

// Fields that forget a stored Checkout session so the next payment request
// creates a fresh one (the attempt counter is deliberately kept).
export const CLEARED_CHECKOUT_FIELDS = Object.freeze({
  stripePaymentLink: null,
  stripeCheckoutSessionId: null,
  stripeCheckoutAmountMinor: null,
  stripeCheckoutCurrency: null,
  stripeCheckoutExpiresAt: null,
});

export async function clearExpiredCheckout(prisma, session) {
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return false;
  await prisma.invoice.updateMany({
    where: { id: invoiceId, stripeCheckoutSessionId: session.id, status: { not: 'PAID' } },
    data: { ...CLEARED_CHECKOUT_FIELDS },
  });
  return true;
}
