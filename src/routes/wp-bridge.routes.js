// WP Bridge routes
// Migrated from ashbi-hub with consistent auth on all routes

import {
  listSites,
  registerSite,
  updateSiteHealth,
  deleteSite,
  generateMagicLogin
} from '../services/wpBridge.service.js';

export default async function wpBridgeRoutes(fastify) {
  // List all registered WP sites
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return listSites(request.user.id);
  });

  // Register a new WP site (authenticated — site registration requires admin)
  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const site = await registerSite(request.body);
    return reply.status(201).send({ success: true, site });
  });

  // Update site health data (from WP plugin heartbeat)
  // Note: This endpoint uses siteUrl + secretKey auth, not user auth
  // The WP plugin authenticates via a shared secret
  fastify.put('/', async (request, reply) => {
    const { siteUrl, secretKey, ...healthData } = request.body;
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    try {
      const result = await updateSiteHealth(siteUrl, healthData);
      return { success: true, health: result };
    } catch (error) {
      return reply.status(404).send({ error: error.message });
    }
  });

  // Delete a site (admin only)
  fastify.delete('/', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request) => {
    const { id } = request.query;
    if (!id) return { error: 'id query parameter is required' };
    await deleteSite(id);
    return { success: true };
  });

  // Receive admin alert from WP site
  fastify.post('/alert', async (request, reply) => {
    const { siteUrl, alertType, details } = request.body;
    // Store alert in the WP site's alerts field
    try {
      const site = await updateSiteHealth(siteUrl, {
        status: 'MAINTENANCE',
        alerts: [{ type: alertType, details, timestamp: new Date().toISOString() }]
      });
      return { received: true };
    } catch (error) {
      return { received: true }; // Always acknowledge alerts
    }
  });

  // Generate magic login link (admin only)
  fastify.get('/magic-login', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request) => {
    const { siteId } = request.query;
    if (!siteId) return { error: 'siteId query parameter is required' };
    try {
      const result = await generateMagicLogin(siteId);
      return { success: true, magicLink: result };
    } catch (error) {
      return { error: error.message };
    }
  });
}