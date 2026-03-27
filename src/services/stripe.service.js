// Stripe integration service for payment links and webhooks
import Stripe from 'stripe';

let stripe = null;

function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export async function createPaymentLink(invoice) {
  const stripeClient = getStripe();
  if (!stripeClient) return null;

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description: invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`,
        },
        unit_amount: Math.round(invoice.total * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.APP_URL || 'https://hub.ashbi.ca'}/invoices?paid=${invoice.id}`,
    cancel_url: `${process.env.APP_URL || 'https://hub.ashbi.ca'}/invoices?cancelled=${invoice.id}`,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    },
  });

  return {
    paymentLink: session.url,
    paymentIntentId: session.payment_intent || session.id,
  };
}

export async function handleWebhook(payload, signature) {
  const stripeClient = getStripe();
  if (!stripeClient) throw new Error('Stripe not configured');

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const event = stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
  return event;
}
