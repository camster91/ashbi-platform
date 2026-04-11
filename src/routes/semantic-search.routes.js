// Semantic Search / Client Brain routes
// RAG-powered search across client memories
// Migrated from ashbi-hub with Prisma and auth decorators

import {
  searchSimilar,
  storeEmbedding,
  rebuildClientBrain,
  deleteEmbeddings
} from '../services/embedding.service.js';

export default async function semanticSearchRoutes(fastify) {
  // Search across all client memories
  fastify.get('/search', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { q, limit, clientId } = request.query;

    if (!q) {
      return { error: 'Query parameter "q" is required' };
    }

    return searchSimilar(q, parseInt(limit) || 5, clientId || null);
  });

  // Add an embedding manually
  fastify.post('/embed', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId, content, source, sourceId, metadata } = request.body;

    if (!clientId || !content || !source) {
      return reply.status(400).send({ error: 'clientId, content, and source are required' });
    }

    const result = await storeEmbedding(clientId, content, source, sourceId, metadata);
    return reply.status(201).send(result);
  });

  // Rebuild Client Brain for a specific client
  fastify.post('/rebuild/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { clientId } = request.params;
    const result = await rebuildClientBrain(clientId);
    return result;
  });

  // Delete embeddings for a specific source
  fastify.delete('/embeddings/:source/:sourceId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { source, sourceId } = request.params;
    await deleteEmbeddings(source, sourceId);
    return { success: true };
  });
}