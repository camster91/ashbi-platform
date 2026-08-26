// Webhook routes (email + Stripe)

import { parseEmail } from '../utils/emailParser.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { handleWebhook, reconcileCheckoutEvent, reconcileRefundEvent } from '../services/stripe.service.js';
import env from '../config/env.js';
import crypto from 'crypto';
import {validateBody, webhookEmailTestSchema} from '../validators/schemas.js';
import { runTenantJob } from '../jobs/tenant-iteration.js';
import { prisma as backgroundPrisma } from '../config/db.js';

export default async function webhookRoutes(fastify) {
  // Email webhook endpoint
  fastify.post('/email', { config: { skipValidation: true } }, async (request, reply) => {
    // Verify webhook secret (fail closed)
    if (!env.webhookSecret) {
      return reply.status(500).send({ error: 'Webhook secret not configured' });
    }
    if (!env.botOrganizationId) {
      return reply.status(503).send({ error: 'Webhook tenant is not configured' });
    }
    const signature = request.headers['x-webhook-signature'];
    if (!signature) {
      return reply.status(401).send({ error: 'Missing webhook signature' });
    }
    const expectedSig = crypto
      .createHmac('sha256', env.webhookSecret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    // SECURITY: timing-safe compare — string `!==` short-circuits on first
    // byte mismatch and leaks the matching prefix length to a network
    // attacker. `crypto.timingSafeEqual` is constant-time per byte.
    let sigBuf, expectedBuf;
    try {
      sigBuf = Buffer.from(signature, 'hex');
      expectedBuf = Buffer.from(expectedSig, 'hex');
    } catch {
      return reply.status(401).send({ error: 'Invalid webhook signature' });
    }
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return reply.status(401).send({ error: 'Invalid webhook signature' });
    }

    try {
      // Parse the incoming email
      const emailData = await parseEmail(request.body);

      // Process through AI pipeline (async in production, sync for simplicity here)
      const result = await runTenantJob(
        fastify.prisma,
        env.botOrganizationId,
        () => processEmailPipeline(emailData),
        backgroundPrisma,
      );

      return {
        success: true,
        threadId: result.threadId,
        matched: result.matched,
        needsTriage: result.needsTriage
      };
    } catch (error) {
      fastify.log.error('Email processing error:', error);
      return reply.status(500).send({ error: 'Email processing failed' });
    }
  });

  // Manual email submission (for testing)
  fastify.post('/email/test', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(webhookEmailTestSchema),
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
      fastify.log.error('Stripe webhook signature verification failed');
      return reply.status(400).send({ error: 'Invalid webhook signature' });
    }

    // Handle every Checkout lifecycle event through one reconciliation boundary.
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        try {
          const result = await reconcileCheckoutEvent(fastify.prisma, event);
          fastify.log.info({
            invoiceId: result.invoiceId,
            state: result.state,
            duplicate: result.duplicate,
          }, 'Stripe checkout reconciled');
        } catch (error) {
          fastify.log.error({ error }, 'Error reconciling Stripe checkout');
          return reply.status(400).send({ error: 'Stripe checkout did not match an active invoice attempt' });
        }
        break;
      }

      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        try {
          const result = await reconcileRefundEvent(fastify.prisma, event);
          fastify.log.info({
            invoiceId: result.invoiceId,
            stripeRefundId: result.stripeRefundId,
            state: result.state,
            duplicate: result.duplicate,
          }, 'Stripe refund reconciled');
        } catch (error) {
          fastify.log.error({ error }, 'Error reconciling Stripe refund');
          return reply.status(400).send({ error: 'Stripe refund did not match a recorded payment' });
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
