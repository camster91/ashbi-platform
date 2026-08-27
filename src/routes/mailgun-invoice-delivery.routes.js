import env from '../config/env.js';
import {
  reconcileInvoiceDeliveryProviderEvent,
  verifyMailgunDeliverySignature,
} from '../services/invoiceDeliveryProviderEvent.service.js';

export default async function mailgunInvoiceDeliveryRoutes(fastify, options = {}) {
  const signingKey = options.signingKey ?? env.mailgunSigningKey;
  const now = options.now ?? (() => new Date());

  fastify.post('/mailgun/invoice-delivery', {
    config: { public: true, skipValidation: true },
  }, async (request, reply) => {
    if (!signingKey) {
      return reply.status(503).send({ error: 'Mailgun webhook signing is not configured' });
    }
    if (!verifyMailgunDeliverySignature({
      signingKey,
      signature: request.body?.signature,
      now: now(),
    })) {
      return reply.status(401).send({ error: 'Invalid Mailgun webhook signature' });
    }

    try {
      const result = await reconcileInvoiceDeliveryProviderEvent({
        prisma: fastify.prisma,
        eventData: request.body?.['event-data'],
      });
      return {
        received: true,
        duplicate: result.duplicate,
        type: result.type,
      };
    } catch (error) {
      if (error?.nonRetryable) {
        request.log.warn({ errorCode: error.code }, 'Mailgun invoice delivery event was rejected');
        return reply.status(406).send({ error: 'Invoice delivery event was not accepted' });
      }
      request.log.error({ errorCode: 'PERSISTENCE_FAILURE' }, 'Mailgun invoice delivery event could not be recorded');
      return reply.status(500).send({ error: 'Invoice delivery event could not be recorded' });
    }
  });
}
