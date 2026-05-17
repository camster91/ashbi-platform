import env from '../config/env.js';
import { registerSite, updateSiteHealth, listSites, deleteSite } from '../services/wpBridge.service.js';

export default async function wpBridgeRoutes(fastify) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return listSites(request.user.id);
  });

  fastify.post('/', async (request, reply) => {
    const { siteUrl, siteName, secretKey } = request.body;
    if (!secretKey || secretKey !== env.wpBridgeSecret) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    const site = await registerSite(request.body);
    return reply.status(201).send({ success: true, site });
  });

  fastify.put('/', async (request, reply) => {
    const { siteUrl, secretKey, ...healthData } = request.body;
    if (!secretKey || secretKey !== env.wpBridgeSecret) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    try {
      const result = await updateSiteHealth(siteUrl, healthData);
      return { success: true, health: result };
    } catch (error) {
      return reply.status(404).send({ error: error.message });
    }
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    await deleteSite(id);
    return reply.status(204).send();
  });
}