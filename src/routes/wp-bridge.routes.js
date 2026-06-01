import env from '../config/env.js';
import {
  registerSite,
  updateSiteHealth,
  listSites,
  deleteSite,
  verifySecret,
  recordBackup,
  recordReport,
  recordAlert,
  getAlerts,
  getBackups,
  getReports,
  logSupportHours,
  getSupportHoursSummary
} from '../services/wpBridge.service.js';

export default async function wpBridgeRoutes(fastify) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return listSites(request.user.id);
  });

  fastify.post('/', async (request, reply) => {
    const { siteUrl, siteName, secretKey } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    const site = await registerSite(request.body);
    return reply.status(201).send({ success: true, site });
  });

  fastify.put('/', async (request, reply) => {
    const { siteUrl, secretKey, ...healthData } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
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

  // Bridge plugin backup event (v1.7.0+)
  fastify.post('/backup', async (request, reply) => {
    const { siteUrl, secretKey, report } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    try {
      const backup = await recordBackup(siteUrl, report || {});
      return reply.status(201).send({ success: true, backup });
    } catch (error) {
      return reply.status(404).send({ error: error.message });
    }
  });

  // Bridge plugin monthly maintenance report (v1.7.0+)
  fastify.post('/report', async (request, reply) => {
    const { siteUrl, secretKey, report } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
    try {
      const r = await recordReport(siteUrl, report || {});
      return reply.status(201).send({ success: true, report: r });
    } catch (error) {
      return reply.status(404).send({ error: error.message });
    }
  });

  // Bridge plugin alert: new admin, admin promoted, security event (v1.7.0+)
  fastify.post('/alert', async (request, reply) => {
    const { siteUrl, secretKey, alertType, details } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl || !alertType) {
      return reply.status(400).send({ error: 'siteUrl and alertType required' });
    }
    const alert = await recordAlert(siteUrl, alertType, details || {});
    return reply.status(201).send({ success: true, alert });
  });

  // Log support hours (retainer tracking) from plugin or manual entry
  fastify.post('/hours', async (request, reply) => {
    const { siteUrl, secretKey, hours, description, month } = request.body;
    if (!secretKey || !verifySecret(secretKey)) {
      return reply.status(401).send({ error: 'Invalid secret key' });
    }
    if (!siteUrl || typeof hours !== 'number') {
      return reply.status(400).send({ error: 'siteUrl and hours required' });
    }
    const entry = await logSupportHours(siteUrl, hours, description, month);
    return reply.status(201).send({ success: true, entry });
  });

  // Read endpoints (require authenticated user, not plugin secret)
  fastify.get('/alerts', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, limit } = request.query;
    return getAlerts(siteUrl, limit ? Number(limit) : 50);
  });

  fastify.get('/backups', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, limit } = request.query;
    return getBackups(siteUrl, limit ? Number(limit) : 20);
  });

  fastify.get('/reports', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl } = request.query;
    return getReports(siteUrl);
  });

  fastify.get('/hours/summary', { onRequest: [fastify.authenticate] }, async (request) => {
    const { siteUrl, clientId, month } = request.query;
    return getSupportHoursSummary({ siteUrl, clientId, month });
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.adminOnly]
  }, async (request, reply) => {
    const { id } = request.params;
    await deleteSite(id);
    return reply.status(204).send();
  });
}
