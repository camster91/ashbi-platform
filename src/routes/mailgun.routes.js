// Mailgun webhook + send routes

import crypto from 'crypto';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { processEmailPipeline } from '../services/pipeline.service.js';

export default async function mailgunRoutes(fastify) {
  // POST /mailgun/send — manually send an email (admin only)
  fastify.post('/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { to, subject, text, html } = request.body || {};
    if (!to || !subject || (!text && !html)) {
      return reply.status(400).send({ error: 'to, subject, and text or html are required' });
    }

    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      return reply.status(503).send({ error: 'Mailgun not configured' });
    }

    try {
      const mg = new Mailgun(FormData);
      const client = mg.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
      await client.messages.create(process.env.MAILGUN_DOMAIN, {
        from: `Ashbi Design <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to,
        subject,
        text,
        html: html || `<pre style="font-family:sans-serif">${text}</pre>`,
      });
      return { sent: true, to, subject };
    } catch (err) {
      fastify.log.error('Mailgun send error:', err);
      return reply.status(500).send({ error: 'Failed to send email', message: err.message });
    }
  });

  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body;

      // Validate Mailgun webhook signature
      const signingKey = process.env.MAILGUN_SIGNING_KEY;
      if (signingKey) {
        const timestamp = body.timestamp;
        const token = body.token;
        const signature = body.signature;

        const expectedSignature = crypto
          .createHmac('sha256', signingKey)
          .update(timestamp + token)
          .digest('hex');

        if (expectedSignature !== signature) {
          fastify.log.warn('Invalid Mailgun webhook signature');
          return reply.status(200).send({ status: 'ok' });
        }
      }

      // Parse multipart form data fields
      const sender = body.sender;
      const recipient = body.recipient;
      const subject = body.subject;
      const bodyPlain = body['body-plain'];
      const bodyHtml = body['body-html'];
      const messageId = body['Message-Id'];

      await processEmailPipeline({
        from: sender,
        to: recipient,
        subject,
        text: bodyPlain,
        html: bodyHtml,
        messageId
      });
    } catch (err) {
      fastify.log.error(err, 'Mailgun webhook processing error');
    }

    return reply.status(200).send({ status: 'ok' });
  });
}
