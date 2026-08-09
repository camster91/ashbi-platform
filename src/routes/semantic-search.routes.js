// Semantic Search / Client Brain routes
// RAG-powered search across client memories
// Migrated from ashbi-hub with Prisma and auth decorators

import {
  validateBody,
  validateParams,
  validateQuery,
  semanticSearchEmbedSchema,
  semanticSearchClientParamsSchema,
  semanticSearchDeleteParamsSchema,
  semanticSearchQuerySchema,
} from '../validators/schemas.js';
import {
  searchSimilar,
  storeEmbedding,
  rebuildClientBrain,
  deleteEmbeddings
} from '../services/embedding.service.js';

export default async function semanticSearchRoutes(fastify) {
  // Search across all client memories
  fastify.get('/search', {
    onRequest: [fastify.authenticate],
    preHandler: validateQuery(semanticSearchQuerySchema),
  }, async (request) => {
    const { q, limit, clientId } = request.query;

    // SECURITY: enforce tenant scoping by passing the JWT-derived
    // organizationId into the embedding search. Without this, the
    // pgvector cosine-similarity query would return cross-tenant
    // matches when no clientId is provided.
    return searchSimilar(
      q,
      limit,
      clientId || null,
      request.organizationId
    );
  });

  // Embedding stats — counts grouped by source (for the Client Brain dashboard)
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const bySource = await request.prisma.clientEmbedding.groupBy({
      by: ['source'],
      _count: { _all: true },
    });
    return bySource.map((r) => ({ source: r.source, count: r._count._all }));
  });

  // Add an embedding manually
  fastify.post('/embed', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(semanticSearchEmbedSchema),
  }, async (request, reply) => {
    const { clientId, content, source, sourceId, metadata } = request.body;

    if (!clientId || !content || !source) {
      return reply.status(400).send({ error: 'clientId, content, and source are required' });
    }

    const result = await storeEmbedding(clientId, content, source, sourceId, metadata, {
      prismaClient: request.prisma,
    });
    return reply.status(201).send(result);
  });

  // Rebuild Client Brain for a specific client
  fastify.post('/rebuild/:clientId', {
    onRequest: [fastify.authenticate],
    preHandler: validateParams(semanticSearchClientParamsSchema),
  }, async (request) => {
    const { clientId } = request.params;
    const result = await rebuildClientBrain(clientId, { prismaClient: request.prisma });
    return result;
  });

  // Delete embeddings for a specific source
  fastify.delete('/embeddings/:source/:sourceId', {
    onRequest: [fastify.authenticate],
    preHandler: validateParams(semanticSearchDeleteParamsSchema),
  }, async (request) => {
    const { source, sourceId } = request.params;
    const deleted = await deleteEmbeddings(source, sourceId, request.organizationId, request.prisma);
    return { success: true, deleted };
  });
}
