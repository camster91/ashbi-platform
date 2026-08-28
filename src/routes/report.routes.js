import { createWeeklyReportOnce } from '../services/reportGeneration.service.js';
import { validateBody, reportGenerationSchema } from '../validators/schemas.js';

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

export default async function reportRoutes(fastify) {
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const take = boundedInteger(request.query?.limit, 50, 100);
    const skip = boundedInteger(request.query?.offset, 0, 100000);
    const where = {
      ...(request.query?.clientId ? { clientId: String(request.query.clientId) } : {}),
      ...(request.query?.status === 'PENDING' ? { sentAt: null } : {}),
      ...(request.query?.status === 'SENT' ? { sentAt: { not: null } } : {}),
    };
    const [reports, total] = await Promise.all([
      request.prisma.report.findMany({
        where,
        include: { client: { select: { id: true, name: true } } },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
      }),
      request.prisma.report.count({ where }),
    ]);
    return { reports, total, limit: take, offset: skip };
  });

  fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const report = await request.prisma.report.findFirst({
      where: { id: request.params.id },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!report) return reply.status(404).send({ error: 'Report not found' });
    return report;
  });

  fastify.post('/generate/:clientId', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(reportGenerationSchema),
  }, async (request, reply) => {
    try {
      const result = await createWeeklyReportOnce({
        prisma: request.prisma,
        clientId: request.params.clientId,
        requestId: request.body?.requestId,
      });
      return reply.status(result.reused ? 200 : 201).send(result);
    } catch (error) {
      if (error?.code === 'CLIENT_NOT_FOUND') return reply.status(404).send({ error: 'Client not found' });
      if (error instanceof TypeError) return reply.status(400).send({ error: error.message });
      request.log.error({ code: error?.code ?? 'REPORT_GENERATION_FAILED' }, 'Weekly report generation failed');
      return reply.status(502).send({ error: 'Report generation failed without creating a report' });
    }
  });
}
