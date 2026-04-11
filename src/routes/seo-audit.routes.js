// SEO Audit routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  runSeoAudit,
  getAudits,
  getAudit,
  deleteAudit
} from '../services/seoAudit.service.js';

export default async function seoAuditRoutes(fastify) {
  // Run an SEO audit
  fastify.post('/audit', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { url, clientId, projectId } = request.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    const audit = await runSeoAudit({ url, clientId, projectId });
    return reply.status(201).send(audit);
  });

  // List audits for a client
  fastify.get('/client/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return getAudits(request.params.clientId);
  });

  // Get a single audit
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const audit = await getAudit(request.params.id);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    return audit;
  });

  // Delete an audit
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteAudit(request.params.id);
    return { success: true };
  });
}