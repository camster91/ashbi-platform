// Ad Copy Generator routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  generateAdCopy,
  getAdCopies,
  getAdCopy,
  updateAdCopyStatus,
  deleteAdCopy
} from '../services/adCopy.service.js';

export default async function adCopyRoutes(fastify) {
  // Generate ad copy variants using AI
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const result = await generateAdCopy(request.body);
    return reply.status(201).send(result);
  });

  // List ad copies with optional filters
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { platform, status, clientId } = request.query;
    return getAdCopies({ platform, status, clientId });
  });

  // Get a single ad copy
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const adCopy = await getAdCopy(request.params.id);
    if (!adCopy) return reply.status(404).send({ error: 'Ad copy not found' });
    return adCopy;
  });

  // Update ad copy status
  fastify.patch('/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status } = request.body;
    return updateAdCopyStatus(request.params.id, status);
  });

  // Delete an ad copy
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteAdCopy(request.params.id);
    return { success: true };
  });
}