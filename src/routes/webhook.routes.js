// Webhook routes (email + Stripe)

import { parseEmail } from '../utils/emailParser.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { clearExpiredCheckout, handleCheckoutFailure, handleWebhook, recordCheckoutAuditEvents, recordCompletedCheckout } from '../services/stripe.service.js';
import env from '../config/env.js';
import {validateBody, webhookEmailTestSchema} from '../validators/schemas.js';
import { runTenantJob } from '../jobs/tenant-iteration.js';
import { prisma as backgroundPrisma } from '../config/db.js';
import {
  EMAIL_WEBHOOK_CLAIM_RENEW_MS, claimEmailWebhookSignature, markEmailWebhookProcessed, releaseEmailWebhookSignature,
  renewEmailWebhookClaim, verifyEmailWebhook,
} from '../webhooks/email-webhook-signature.js';

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
    // Signed over the raw body with a timestamp, accepted once (replay-safe):
    // see src/webhooks/email-webhook-signature.js for the header contract.
    const verification = verifyEmailWebhook({
      secret: env.webhookSecret,
      timestamp: request.headers['x-webhook-timestamp'],
      signature: request.headers['x-webhook-signature'],
      rawBody: request.rawBody,
    });
    if (!verification.ok) {
      if (verification.reason === 'missing') {
        return reply.status(401).send({ error: 'Missing webhook signature or timestamp' });
      }
      if (verification.reason === 'stale') {
        return reply.status(401).send({ error: 'Webhook timestamp is outside the accepted window' });
      }
      return reply.status(401).send({ error: 'Invalid webhook signature' });
    }
    // /api/webhooks is tenancy-exempt: request.prisma is the unscoped client.
    const receipts = request.prisma ?? backgroundPrisma;
    const claimToken = await claimEmailWebhookSignature(receipts, verification.signature);
    if (!claimToken) {
      return reply.status(409).send({ error: 'Webhook delivery was already processed' });
    }
    // Keep the claim live while the (possibly slow, AI-backed) pipeline runs,
    // so a provider retry cannot take it over from a handler still working.
    const renewal = setInterval(() => {
      renewEmailWebhookClaim(receipts, verification.signature, claimToken).catch(() => {});
    }, EMAIL_WEBHOOK_CLAIM_RENEW_MS);
    renewal.unref?.();

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
      // Finished: a later delivery with this signature is a replay. Until
      // this runs, an interrupted claim is retryable after its lease.
      await markEmailWebhookProcessed(receipts, verification.signature, claimToken).catch((err) => {
        fastify.log.warn({ errorName: err?.name }, 'Could not mark the email webhook processed');
      });

      return {
        success: true,
        threadId: result.threadId,
        matched: result.matched,
        needsTriage: result.needsTriage
      };
    } catch (error) {
      // Release the signature so the sender's retry of this delivery is accepted.
      await releaseEmailWebhookSignature(receipts, verification.signature, claimToken);
      fastify.log.error({ errorName: error?.name }, 'Email processing error');
      return reply.status(500).send({ error: 'Email processing failed' });
    } finally {
      clearInterval(renewal);
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

    // /api/webhooks is tenancy-exempt, so run the pipeline in the admin's own
    // organization explicitly; otherwise its threads land outside any tenant.
    if (!request.user.organizationId) {
      return reply.status(403).send({ error: 'Organization context required' });
    }
    const result = await runTenantJob(
      fastify.prisma,
      request.user.organizationId,
      () => processEmailPipeline(emailData),
      backgroundPrisma,
    );

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

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        try {
          const result = await recordCompletedCheckout(fastify.prisma, event, { correlationId: request.id });
          await recordCheckoutAuditEvents(fastify.prisma, request, event, result);
          fastify.log.info({ invoiceId: result.invoiceId, duplicate: result.duplicate }, 'Stripe checkout processed');
        } catch (error) {
          const failure = handleCheckoutFailure(error, { event, route: '/api/webhooks/stripe', log: fastify.log });
          // Permanent rejections are acknowledged so Stripe stops retrying them.
          if (failure.acknowledged) return reply.status(200).send({ received: true, recorded: false, code: failure.code });
          return reply.status(failure.statusCode).send({ error: failure.error, code: failure.code });
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        await clearExpiredCheckout(fastify.prisma, session);
        break;
      }

      default:
        fastify.log.info(`Unhandled Stripe event type: ${event.type}`);
    }

    // Stripe expects a 200 response
    return { received: true };
  });
}
