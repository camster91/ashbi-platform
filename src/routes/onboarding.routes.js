// Client Onboarding API routes

import { onboardClient } from '../services/onboarding.service.js';

export default async function onboardingRoutes(fastify) {
  // POST /onboarding/client — create client with full onboarding setup
  fastify.post('/onboarding/client', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    const { name, email, contactName, retainerTier, notes } = request.body;

    if (!name || !email || !contactName || !retainerTier) {
      return reply.status(400).send({ error: 'name, email, contactName, and retainerTier are required' });
    }

    if (!['999', '1999', '3999'].includes(String(retainerTier))) {
      return reply.status(400).send({ error: 'retainerTier must be 999, 1999, or 3999' });
    }

    const result = await onboardClient(fastify, { name, email, contactName, retainerTier: String(retainerTier), notes });
    return result;
  });
}
