import { safeEqual } from '../utils/crypto.js';
import env from '../config/env.js';
import { normalizeUptimeKumaEvent, redactMonitoringPayload, triageMonitoringIncident } from '../services/uptime-triage.service.js';

const secretHeader = 'x-ashbi-uptime-secret';

export default async function uptimeMonitoringRoutes(fastify, options = {}) {
  const prisma = options.prisma || fastify.prisma;
  const secret = options.secret ?? env.uptimeKumaWebhookSecret;
  const triage = options.triage || triageMonitoringIncident;

  fastify.post('/', { config: { public: true } }, async (request, reply) => {
    if (!secret) {
      return reply.status(503).send({ error: 'Uptime Kuma webhook is not configured', code: 'UPTIME_KUMA_WEBHOOK_UNAVAILABLE' });
    }
    const suppliedSecret = request.headers[secretHeader];
    if (typeof suppliedSecret !== 'string' || !safeEqual(suppliedSecret, secret)) {
      return reply.status(401).send({ error: 'Invalid monitoring webhook credential' });
    }

    let event;
    try {
      event = normalizeUptimeKumaEvent(request.body || {});
    } catch (error) {
      return reply.status(400).send({ error: error.message || 'Invalid Uptime Kuma event' });
    }

    const site = await prisma.wPSite.findFirst({
      where: { url: event.monitorUrl },
      select: { id: true, organizationId: true }
    });
    if (!site) {
      return reply.status(404).send({ error: 'No provisioned WordPress site matches monitorUrl', code: 'MONITORED_SITE_NOT_FOUND' });
    }

    const triageResult = await triage(event);
    const record = await prisma.monitoringIncident.upsert({
      where: { externalEventId: event.externalEventId },
      create: {
        organizationId: site.organizationId,
        siteId: site.id,
        source: 'UPTIME_KUMA',
        externalEventId: event.externalEventId,
        monitorName: event.monitorName,
        monitorUrl: event.monitorUrl,
        status: event.status,
        message: event.message,
        pingMs: event.pingMs,
        emittedAt: event.emittedAt,
        rawPayload: redactMonitoringPayload(request.body || {}),
        triageStatus: triageResult.status,
        triageReason: triageResult.reason || null,
        aiProvider: triageResult.provider || null,
        aiModel: triageResult.model || null,
        aiSeverity: triageResult.triage?.severity || null,
        aiConfidence: triageResult.triage?.confidence ?? null,
        aiSummary: triageResult.triage?.summary || null,
        recommendedAction: triageResult.triage?.recommendedAction || null,
        humanActionRequired: triageResult.triage?.humanActionRequired ?? true,
        aiTriage: triageResult.triage || null,
        triagedAt: triageResult.status === 'COMPLETED' ? new Date() : null,
        notificationDisposition: 'SHADOW'
      },
      update: {},
      select: { id: true, triageStatus: true, notificationDisposition: true }
    });

    return reply.status(202).send({
      accepted: true,
      incidentId: record.id,
      triageStatus: record.triageStatus,
      notificationDisposition: record.notificationDisposition
    });
  });
}
