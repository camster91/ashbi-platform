import { createPublicInquiry, PublicInquiryError } from '../services/public-inquiry.service.js';
import { summarizeLeadAcquisition } from '../services/lead-acquisition-summary.service.js';
import {
  convertQualifiedLead,
  LeadQualificationError,
  promoteQualifiedLeadToDeal,
  updateLeadQualification,
} from '../services/lead-qualification.service.js';
import {
  leadIdParamsSchema,
  leadListQuerySchema,
  leadQualificationSchema,
  leadPromotionSchema,
  PUBLIC_SERVICE_LINES,
  publicInquirySchema,
  validateBody,
  validateParams,
  validateQuery,
} from '../validators/schemas.js';

function normalizedOrigins(values = []) {
  return new Set(values.map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }).filter(Boolean));
}

export default async function clientAcquisitionRoutes(fastify, options) {
  const organizationId = String(options.organizationId ?? '').trim();
  const ownerUserId = String(options.ownerUserId ?? '').trim();
  const privacyVersion = String(options.privacyVersion ?? '').trim();
  const allowedOrigins = normalizedOrigins(options.allowedOrigins);
  const enabled = Boolean(organizationId && ownerUserId && privacyVersion && allowedOrigins.size > 0);

  fastify.get('/config', { config: { public: true } }, async () => ({
    enabled,
    privacyVersion: enabled ? privacyVersion : null,
    serviceLines: PUBLIC_SERVICE_LINES,
  }));

  fastify.post('/intake', {
    config: {
      public: true,
      rateLimit: { max: 8, timeWindow: '1 minute' },
    },
    preHandler: validateBody(publicInquirySchema),
  }, async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({ error: 'Inquiry service is temporarily unavailable', code: 'INTAKE_DISABLED' });
    }
    const requestOrigin = request.headers.origin;
    if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
      return reply.status(403).send({ error: 'Inquiry origin is not allowed', code: 'ORIGIN_NOT_ALLOWED' });
    }
    if (request.body.privacyVersion !== privacyVersion) {
      return reply.status(409).send({ error: 'Privacy notice changed; refresh and review it again', code: 'PRIVACY_VERSION_CHANGED' });
    }
    if (request.body.website) {
      return reply.status(202).send({ received: true });
    }

    try {
      const result = await createPublicInquiry({
        prisma: request.prisma ?? fastify.prisma,
        organizationId,
        ownerUserId,
        inquiry: request.body,
      });
      return reply.status(result.idempotent ? 200 : 202).send({
        received: true,
        inquiryId: result.id,
        idempotent: result.idempotent,
      });
    } catch (error) {
      if (error instanceof PublicInquiryError && error.code === 'IDEMPOTENCY_CONFLICT') {
        return reply.status(409).send({ error: 'Inquiry key conflict', code: error.code });
      }
      if (error instanceof PublicInquiryError && error.code === 'INTAKE_DISABLED') {
        return reply.status(503).send({ error: 'Inquiry service is temporarily unavailable', code: error.code });
      }
      request.log.error({ errorName: error.name, code: error.code }, 'Public inquiry persistence failed');
      return reply.status(503).send({ error: 'Inquiry could not be saved', code: 'INTAKE_UNAVAILABLE' });
    }
  });

  const staffOnly = async (request, reply) => {
    if (!['ADMIN', 'TEAM'].includes(request.user?.role)) {
      return reply.status(403).send({ error: 'Staff access required', code: 'STAFF_ACCESS_REQUIRED' });
    }
  };

  const qualificationError = (error, reply) => {
    if (!(error instanceof LeadQualificationError)) return false;
    const statuses = {
      LEAD_NOT_FOUND: 404,
      LEAD_ALREADY_CONVERTED: 409,
      LEAD_CONVERSION_INCOMPLETE: 409,
      LEAD_NOT_QUALIFIED: 409,
      LEAD_CONVERSION_IN_PROGRESS: 409,
      PIPELINE_STAGE_NOT_FOUND: 404,
    };
    reply.status(statuses[error.code] ?? 400).send({ error: error.message, code: error.code });
    return true;
  };

  fastify.get('/leads', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly, validateQuery(leadListQuerySchema)],
  }, async (request) => {
    const leads = await request.prisma.lead.findMany({
      where: request.query.status ? { status: request.query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: request.query.limit,
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        serviceLine: true,
        timing: true,
        budgetBand: true,
        budgetCurrency: true,
        status: true,
        source: true,
        campaign: true,
        qualificationNotes: true,
        qualificationReasonCode: true,
        nextAction: true,
        nextActionDueAt: true,
        accountOwner: { select: { id: true, name: true } },
        qualifiedAt: true,
        convertedClientId: true,
        convertedDealId: true,
        convertedAt: true,
        createdAt: true,
      },
    });
    return { leads };
  });

  fastify.get('/leads/summary', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly],
  }, async (request) => summarizeLeadAcquisition({ prisma: request.prisma ?? fastify.prisma }));

  fastify.get('/leads/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly, validateParams(leadIdParamsSchema)],
  }, async (request, reply) => {
    const lead = await request.prisma.lead.findFirst({
      where: { id: request.params.id },
      include: {
        events: { orderBy: { occurredAt: 'desc' }, take: 50 },
        accountOwner: { select: { id: true, name: true } },
        convertedClient: { select: { id: true, name: true } },
        convertedDeal: { select: { id: true, title: true, currency: true, value: true, stageId: true } },
      },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
    return lead;
  });

  fastify.patch('/leads/:id/qualification', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly, validateParams(leadIdParamsSchema), validateBody(leadQualificationSchema)],
  }, async (request, reply) => {
    try {
      return await updateLeadQualification({
        prisma: request.prisma,
        leadId: request.params.id,
        status: request.body.status,
        qualificationNotes: request.body.qualificationNotes,
        qualificationReasonCode: request.body.qualificationReasonCode,
        nextAction: request.body.nextAction,
        nextActionDueAt: request.body.nextActionDueAt,
        actorUserId: request.user.id,
      });
    } catch (error) {
      if (qualificationError(error, reply)) return reply;
      throw error;
    }
  });

  fastify.post('/leads/:id/convert', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly, validateParams(leadIdParamsSchema)],
  }, async (request, reply) => {
    try {
      const result = await convertQualifiedLead({
        prisma: request.prisma,
        leadId: request.params.id,
        actorUserId: request.user.id,
      });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (error) {
      if (qualificationError(error, reply)) return reply;
      throw error;
    }
  });

  fastify.post('/leads/:id/promote', {
    onRequest: [fastify.authenticate],
    preHandler: [staffOnly, validateParams(leadIdParamsSchema), validateBody(leadPromotionSchema)],
  }, async (request, reply) => {
    try {
      const result = await promoteQualifiedLeadToDeal({
        prisma: request.prisma,
        leadId: request.params.id,
        actorUserId: request.user.id,
        deal: request.body,
      });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (error) {
      if (qualificationError(error, reply)) return reply;
      throw error;
    }
  });
}
