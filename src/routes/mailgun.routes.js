// Mailgun webhook + send routes

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { processEmailPipeline } from '../services/pipeline.service.js';
import { mailgunInboundDeliveryKey } from '../services/inbound-delivery-key.js';
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
import {
  addMailgunFormParser,
  authenticateMailgunWebhook,
  MAILGUN_WEBHOOK_BODY_LIMIT,
  readMailgunWebhookFields,
} from '../services/mailgun-webhook-request.js';

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

/**
 * Run one verified inbound delivery through the email pipeline, in the
 * webhook tenant (BOT_ORGANIZATION_ID).
 * @param {any} fastify
 * @param {Record<string, any>} body
 */
export function processMailgunInboundEmail(fastify, body) {
  return runTenantJob(fastify.prisma, env.botOrganizationId, () => processEmailPipeline({
    ...mailgunInboundEmailData(body),
    // Stable per delivery (Message-Id, or a hash of the delivery), so a
    // redelivery resumes the first attempt's thread instead of adding one.
    inboundDeliveryKey: mailgunInboundDeliveryKey(body),
  }), backgroundPrisma);
}

/**
 * @param {any} fastify
 * @param {{ processInboundEmail?: typeof processMailgunInboundEmail }} [opts]
 *   Tests substitute the pipeline step; production uses the default.
 */
export default async function mailgunRoutes(fastify, opts = {}) {
  const processInboundEmail = opts.processInboundEmail || processMailgunInboundEmail;

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

  // POST /mailgun — Mailgun inbound route forward (a client email). Mailgun
  // posts form fields (urlencoded, or multipart with attachments), so this
  // route lives in its own scope with the form parser; the cookie-authenticated
  // routes above keep accepting JSON only.
  //
  // Responses follow Mailgun's retry rules: 406 is never retried (stale,
  // replayed or unusable deliveries); 401 and 5xx are retried. A processing
  // failure releases the token and answers 500 so the retry is accepted; the
  // pipeline's inbound delivery key makes that retry resume the first
  // attempt's thread instead of creating a second one.
  await fastify.register(async function mailgunInboundRoute(inbound) {
    addMailgunFormParser(inbound);

    inbound.post('/', { config: { public: true }, bodyLimit: MAILGUN_WEBHOOK_BODY_LIMIT }, async (request, reply) => {
      if (!env.botOrganizationId) {
        return reply.status(503).send({ error: 'Webhook tenant is not configured' });
      }

      let body;
      try {
        body = await readMailgunWebhookFields(request);
      } catch (err) {
        request.log.warn({ err }, 'Unreadable Mailgun inbound webhook body');
        return reply.status(400).send({ error: 'Unreadable webhook body' });
      }
      if (!body) return reply.status(406).send({ error: 'Webhook body must be Mailgun form fields' });

      // Signature, timestamp window and single-use token (fail closed outside
      // development).
      const prisma = request.prisma || fastify.prisma;
      const signingKey = env.mailgunSigningKey;
      let token = null;
      if (!signingKey) {
        if (!env.isDev) {
          return reply.status(503).send({ error: 'Mailgun signing key not configured' });
        }
        // Dev mode: skip validation
      } else {
        const auth = await authenticateMailgunWebhook({ fields: body, signingKey, prisma });
        if (!auth.ok) {
          request.log.warn({ reason: auth.reason }, 'Rejected Mailgun inbound webhook');
          return reply.status(auth.status).send({ error: auth.error });
        }
        token = auth.token;
      }

      try {
        await processInboundEmail(fastify, body);
      } catch (err) {
        // Let Mailgun's retry of this delivery through.
        if (token) await releaseWebhookToken(prisma, token);
        request.log.error({ err }, 'Mailgun webhook processing error');
        return reply.status(500).send({ error: 'Failed to process inbound email' });
      }

      return reply.status(200).send({ status: 'ok' });
    });
  });
}
