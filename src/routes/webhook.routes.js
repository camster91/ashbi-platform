// Webhook routes (email + Stripe)

import { prisma } from '../index.js';
import { parseEmail } from '../utils/emailParser.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { handleWebhook } from '../services/stripe.service.js';
import env from '../config/env.js';
import crypto from 'crypto';

export default async function webhookRoutes(fastify) {
  // Email webhook endpoint
  fastify.post('/email', async (request, reply) => {
    // Verify webhook secret
    const signature = request.headers['x-webhook-signature'];
    if (env.webhookSecret && signature) {
      const expectedSig = crypto
        .createHmac('sha256', env.webhookSecret)
        .update(JSON.stringify(request.body))
        .digest('hex');

      if (signature !== expectedSig) {
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }
    }

    try {
      // Parse the incoming email
      const emailData = await parseEmail(request.body);

      // Process through AI pipeline (async in production, sync for simplicity here)
      const result = await processEmailPipeline(emailData);

      return {
        success: true,
        threadId: result.threadId,
        matched: result.matched,
        needsTriage: result.needsTriage
      };
    } catch (error) {
      fastify.log.error('Email processing error:', error);
      return reply.status(500).send({
        error: 'Email processing failed',
        message: error.message
      });
    }
  });

  // Manual email submission (for testing)
  fastify.post('/email/test', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { from, subject, body, html } = request.body;

    const emailData = {
      senderEmail: from,
      senderName: from.split('@')[0],
      subject,
      bodyText: body,
      bodyHtml: html || null,
      receivedAt: new Date()
    };

    const result = await processEmailPipeline(emailData);

    return {
      success: true,
      threadId: result.threadId,
      analysis: result.analysis,
      matched: result.matched
    };
  });

  // Webhook status check
  fastify.get('/email/status', async () => {
    return {
      status: 'active',
      timestamp: new Date().toISOString()
    };
  });

  // ==================== STRIPE WEBHOOK ====================

  // Stripe sends raw body — must configure Fastify to provide it
  fastify.post('/stripe', {
    config: {
      rawBody: true
    }
  }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    let event;
    try {
      // Use raw body for Stripe signature verification (set by content type parser in index.js)
      const rawBody = request.rawBody || request.raw.rawBody || JSON.stringify(request.body);
      event = await handleWebhook(rawBody, signature);
    } catch (err) {
      fastify.log.error('Stripe webhook signature verification failed:', err.message);
      return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoiceId;

        if (!invoiceId) {
          fastify.log.warn('Stripe checkout completed but no invoiceId in metadata');
          break;
        }

        try {
          const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId }
          });

          if (!invoice) {
            fastify.log.warn(`Invoice ${invoiceId} not found for Stripe payment`);
            break;
          }

          if (invoice.status === 'PAID') {
            fastify.log.info(`Invoice ${invoiceId} already marked as paid`);
            break;
          }

          const now = new Date();

          // Update invoice and create payment record in a transaction
          await prisma.$transaction([
            prisma.invoice.update({
              where: { id: invoiceId },
              data: {
                status: 'PAID',
                paidAt: now,
                paymentMethod: 'STRIPE',
                stripePaymentIntentId: session.payment_intent || session.id,
                paymentNotes: `Stripe checkout session ${session.id}`
              }
            }),
            prisma.invoicePayment.create({
              data: {
                amount: (session.amount_total || 0) / 100,
                method: 'STRIPE',
                transactionId: session.payment_intent || session.id,
                notes: `Stripe checkout ${session.id}`,
                paidAt: now,
                invoiceId
              }
            })
          ]);

          fastify.log.info(`Invoice ${invoice.invoiceNumber} marked as PAID via Stripe`);
        } catch (error) {
          fastify.log.error(`Error processing Stripe payment for invoice ${invoiceId}:`, error);
          // Return 200 anyway so Stripe doesn't retry
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoiceId;
        if (invoiceId) {
          // Clear the expired payment link so a new one can be generated
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: { stripePaymentLink: null }
          }).catch(err => {
            fastify.log.error(`Error clearing expired payment link for ${invoiceId}:`, err);
          });
        }
        break;
      }

      default:
        fastify.log.info(`Unhandled Stripe event type: ${event.type}`);
    }

    // Stripe expects a 200 response
    return { received: true };
  });
}
