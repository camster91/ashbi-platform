// Email webhook routes

import { prisma } from '../index.js';
import { parseEmail } from '../utils/emailParser.js';
import { processEmailPipeline } from '../services/pipeline.service.js';
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
}
