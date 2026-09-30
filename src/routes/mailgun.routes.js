// Mailgun webhook + send routes

import crypto from 'crypto';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { mailgunInboundDeliveryKey } from '../services/inbound-delivery-key.js';
import { safeEqual } from '../utils/crypto.js';
import env from '../config/env.js';
import {validateBody, mailgunSendSchema} from '../validators/schemas.js';
import { runTenantJob } from '../jobs/tenant-iteration.js';
import { prisma as backgroundPrisma } from '../config/db.js';
import {
  claimWebhookToken,
  recordDeliveryEvent,
  releaseWebhookToken,
  verifyMailgunSignature,
} from '../services/mailgun-delivery.service.js';

/**
 * Map a Mailgun inbound route POST (multipart fields) to the pipeline's email
 * shape, the same one `parseEmail` produces for the generic webhook
 * (senderEmail, senderName, subject, bodyText, bodyHtml, receivedAt). The
 * pipeline requires these names; Mailgun's own (`sender`, `body-plain`, ...)
 * would leave them undefined and the thread or unmatched email could not be
 * created.
 * @param {Record<string, any>} body
 */
export function mailgunInboundEmailData(body = {}) {
  const fromHeader = typeof body.from === 'string' ? body.from : '';
  const named = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(fromHeader);
  const senderEmail = String(body.sender || named?.[2] || fromHeader || '').trim() || 'unknown@unknown.com';
  const senderName = named?.[1]?.trim() || null;
  const seconds = Number(body.timestamp);
  return {
    senderEmail,
    senderName,
    recipient: body.recipient || null,
    subject: body.subject || '(No Subject)',
    bodyText: body['stripped-text'] || body['body-plain'] || '',
    bodyHtml: body['body-html'] || null,
    rawEmail: null,
    messageId: body['Message-Id'] || null,
    receivedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
  };
}

export default async function mailgunRoutes(fastify) {
  // POST /mailgun/send — manually send an email (admin only)
  fastify.post('/send', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(mailgunSendSchema),
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { to, subject, text, html } = request.body || {};
    if (!to || !subject || (!text && !html)) {
      return reply.status(400).send({ error: 'to, subject, and text or html are required' });
    }

    if (!env.mailgunApiKey || !env.mailgunDomain) {
      return reply.status(503).send({ error: 'Mailgun not configured' });
    }

    try {
      const mg = new Mailgun(FormData);
      const client = mg.client({ username: 'api', key: env.mailgunApiKey });
      await client.messages.create(env.mailgunDomain, {
        from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
        to,
        subject,
        text,
        html: html || `<pre style="font-family:sans-serif">${text}</pre>`,
      });
      return { sent: true, to, subject };
    } catch (err) {
      fastify.log.error('Mailgun send error:', err);
      return reply.status(500).send({ error: 'Failed to send email' });
    }
  });

  // POST /mailgun/events — signed delivery webhook (delivered / permanent
  // failure / bounce / complaint). Mailgun signs HMAC(timestamp + token) in
  // the JSON body, so the parsed body is sufficient (no raw body needed).
  // 406 tells Mailgun not to retry a request that can never be accepted.
  fastify.post('/events', { config: { public: true } }, async (request, reply) => {
    const signingKey = env.mailgunWebhookSigningKey;
    if (!signingKey) return reply.status(503).send({ error: 'Mailgun webhook signing key not configured' });

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const verification = verifyMailgunSignature(body.signature, signingKey);
    if (!verification.ok) {
      if (verification.reason === 'stale') return reply.status(406).send({ error: 'Mailgun webhook timestamp is outside the accepted window' });
      fastify.log.warn({ reason: verification.reason }, 'Rejected Mailgun events webhook');
      return reply.status(401).send({ error: 'Invalid Mailgun webhook signature' });
    }

    const prisma = request.prisma || fastify.prisma;
    const { token } = body.signature;
    if (!(await claimWebhookToken(prisma, token))) {
      return reply.status(406).send({ error: 'Mailgun webhook token was already used' });
    }

    try {
      const result = await recordDeliveryEvent(prisma, body['event-data']);
      if (result.recorded) {
        fastify.log.info({ documentType: result.documentType, documentId: result.documentId, status: result.status }, 'Recorded email delivery status');
      }
      return { received: true, recorded: result.recorded, ...(result.reason ? { reason: result.reason } : {}) };
    } catch (err) {
      // Release the token so Mailgun's retry of this same payload is accepted.
      await releaseWebhookToken(prisma, token);
      fastify.log.error({ err }, 'Mailgun delivery event processing failed');
      return reply.status(500).send({ error: 'Failed to record delivery event' });
    }
  });

  fastify.post('/', { config: { public: true } }, async (request, reply) => {
    if (!env.botOrganizationId) {
      return reply.status(503).send({ error: 'Webhook tenant is not configured' });
    }
    try {
      const body = request.body;

      // Validate Mailgun webhook signature (fail closed)
      const signingKey = env.mailgunSigningKey;
      if (!signingKey) {
        if (!env.isDev) {
          return reply.status(500).send({ error: 'Mailgun signing key not configured' });
        }
        // Dev mode: skip validation
      } else {
        const timestamp = body.timestamp;
        const token = body.token;
        const signature = body.signature;

        if (!timestamp || !token || !signature) {
          return reply.status(401).send({ error: 'Missing Mailgun signature fields' });
        }

        const expectedSignature = crypto
          .createHmac('sha256', signingKey)
          .update(timestamp + token)
          .digest('hex');

        if (!safeEqual(expectedSignature, signature)) {
          fastify.log.warn('Invalid Mailgun webhook signature');
          return reply.status(401).send({ error: 'Invalid Mailgun webhook signature' });
        }
      }

      await runTenantJob(fastify.prisma, env.botOrganizationId, () => processEmailPipeline({
        ...mailgunInboundEmailData(body),
        // Stable per delivery (Message-Id, or a hash of the delivery), so a
        // redelivery resumes the first attempt's thread instead of adding one.
        inboundDeliveryKey: mailgunInboundDeliveryKey(body),
      }), backgroundPrisma);
    } catch (err) {
      fastify.log.error(err, 'Mailgun webhook processing error');
    }

    return reply.status(200).send({ status: 'ok' });
  });
}
