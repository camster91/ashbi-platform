// Weekly report routes

import { generateWeeklyReport } from '../services/weeklyReport.service.js';

export default async function reportRoutes(fastify) {
  // POST /reports/weekly/:clientId — generate a weekly report for a client
  fastify.post('/reports/weekly/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    try {
      const report = await generateWeeklyReport(request.params.clientId);

      // Save the report
      const saved = await fastify.prisma.report.create({
        data: {
          type: 'WEEKLY',
          subject: report.subject,
          body: report.body,
          clientId: report.clientId
        }
      });

      return { ...report, reportId: saved.id };
    } catch (err) {
      if (err.message === 'Client not found') {
        return reply.status(404).send({ error: 'Client not found' });
      }
      throw err;
    }
  });

  // POST /reports/weekly/all — generate reports for all active clients
  fastify.post('/reports/weekly/all', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    const clients = await fastify.prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true }
    });

    const results = [];
    for (const client of clients) {
      try {
        const report = await generateWeeklyReport(client.id);
        const saved = await fastify.prisma.report.create({
          data: {
            type: 'WEEKLY',
            subject: report.subject,
            body: report.body,
            clientId: client.id
          }
        });
        results.push({ clientId: client.id, clientName: client.name, reportId: saved.id, status: 'generated' });
      } catch (err) {
        results.push({ clientId: client.id, clientName: client.name, status: 'failed', error: err.message });
      }
    }

    return { total: clients.length, results };
  });

  // GET /reports/history/:clientId — past generated reports
  fastify.get('/reports/history/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const reports = await fastify.prisma.report.findMany({
      where: { clientId: request.params.clientId },
      orderBy: { generatedAt: 'desc' },
      take: 20
    });
    return reports;
  });
}
