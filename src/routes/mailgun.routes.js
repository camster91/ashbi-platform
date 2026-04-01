// Mailgun webhook route

import crypto from 'crypto';
import { processEmailPipeline } from '../services/pipeline.service.js';

export default async function mailgunRoutes(fastify) {
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
