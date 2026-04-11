// Asset Library routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  getAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  searchAssets,
  getBrandSettings,
  updateBrandSettings
} from '../services/assetLibrary.service.js';

export default async function assetLibraryRoutes(fastify) {
  // Get assets for a client
  fastify.get('/assets/client/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { type, category } = request.query;
    return getAssets(request.params.clientId, { type, category });
  });

  // Get a single asset
  fastify.get('/assets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const asset = await getAsset(request.params.id);
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });
    return asset;
  });

  // Create an asset
  fastify.post('/assets', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const asset = await createAsset(request.body);
    return reply.status(201).send(asset);
  });

  // Update an asset
  fastify.patch('/assets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updateAsset(request.params.id, request.body);
  });

  // Delete an asset
  fastify.delete('/assets/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteAsset(request.params.id);
    return { success: true };
  });

  // Search assets
  fastify.get('/assets/search', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { q, limit } = request.query;
    if (!q) return reply.status(400).send({ error: 'Query parameter "q" is required' });
    return searchAssets(q, parseInt(limit) || 20);
  });

  // Get brand settings
  fastify.get('/guidelines', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return getBrandSettings();
  });

  // Update brand settings
  fastify.post('/guidelines', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updateBrandSettings(request.body);
  });
}