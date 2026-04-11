// Snippet Library routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  getSnippets,
  getSnippet,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  searchSnippets,
  getPopularSnippets,
  incrementUsage
} from '../services/snippetLibrary.service.js';

export default async function snippetLibraryRoutes(fastify) {
  // List snippets with optional filters
  fastify.get('/snippets', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { language, category, tag } = request.query;
    return getSnippets({ language, category, tag });
  });

  // Search snippets
  fastify.get('/snippets/search', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { q, limit } = request.query;
    if (!q) return reply.status(400).send({ error: 'Query parameter "q" is required' });
    return searchSnippets(q, parseInt(limit) || 20);
  });

  // Get popular snippets
  fastify.get('/snippets/popular', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { limit } = request.query;
    return getPopularSnippets(parseInt(limit) || 10);
  });

  // Get a single snippet (and increment usage count)
  fastify.get('/snippets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const snippet = await getSnippet(request.params.id);
    if (!snippet) return reply.status(404).send({ error: 'Snippet not found' });
    // Increment usage count (fire and forget)
    incrementUsage(request.params.id).catch(() => {});
    return snippet;
  });

  // Create a snippet
  fastify.post('/snippets', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const data = { ...request.body, createdById: request.user.id };
    const snippet = await createSnippet(data);
    return reply.status(201).send(snippet);
  });

  // Update a snippet
  fastify.patch('/snippets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updateSnippet(request.params.id, request.body);
  });

  // Delete a snippet
  fastify.delete('/snippets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteSnippet(request.params.id);
    return { success: true };
  });
}