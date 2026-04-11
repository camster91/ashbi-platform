// Creative Brief Generator routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  generateCreativeBrief,
  getBriefs,
  getBrief,
  updateBrief,
  deleteBrief
} from '../services/creativeBrief.service.js';

export default async function creativeBriefRoutes(fastify) {
  // Generate a creative brief using AI with RAG context
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId, projectType, notes } = request.body;
    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });
    const result = await generateCreativeBrief({ clientId, projectType, notes });
    return reply.status(201).send(result);
  });

  // List briefs for a client
  fastify.get('/client/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return getBriefs(request.params.clientId);
  });

  // Get a single brief
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const brief = await getBrief(request.params.id);
    if (!brief) return reply.status(404).send({ error: 'Brief not found' });
    return brief;
  });

  // Update a brief
  fastify.patch('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updateBrief(request.params.id, request.body);
  });

  // Delete a brief
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteBrief(request.params.id);
    return { success: true };
  });
}