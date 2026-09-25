// Stripe integration service for payment links and webhooks
import Stripe from 'stripe';
import env from '../config/env.js';

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

export async function createPaymentLinkWithClient(invoice, stripeClient) {
  const currency = (invoice.currency || 'CAD').toLowerCase();
  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description: invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`,
        },
        unit_amount: Math.round(invoice.total * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=success`,
    cancel_url: `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=cancelled`,
    client_reference_id: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: currency.toUpperCase(),
      amountMinor: String(Math.round(invoice.total * 100)),
    },
  }, { idempotencyKey: `ashbi:invoice:${invoice.id}:checkout` });

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

export async function clearExpiredCheckout(prisma, session) {
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return false;
  await prisma.invoice.updateMany({
    where: { id: invoiceId, stripeCheckoutSessionId: session.id, status: { not: 'PAID' } },
    data: { stripePaymentLink: null, stripeCheckoutSessionId: null },
  });
  return true;
}
