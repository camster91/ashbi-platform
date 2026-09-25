// Governed public inquiry API for ashbi.ca (issue #426).
//
//   GET  /api/client-acquisition/config   public, non-secret intake settings
//   POST /api/client-acquisition/intake   public, idempotent inquiry acceptance
//   GET  /api/client-acquisition/inquiries        staff, organization-scoped
//   DELETE /api/client-acquisition/inquiries/:id  admin, retention deletion
//
// Success from /intake means only that the Hub accepted (or re-used) the
// inquiry. Nothing consequential happens automatically.

import logger from '../utils/logger.js';
import {
  INTAKE_BODY_LIMIT_BYTES,
  canonicalPayloadHash,
  intakeSchema,
  loadClientAcquisitionConfig,
  publicConfig,
} from '../services/client-acquisition.contract.js';

const UNAVAILABLE = { error: 'Inquiries are not being accepted right now', code: 'INTAKE_UNAVAILABLE' };

function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

export default async function clientAcquisitionRoutes(fastify, options = {}) {
  const getConfig = () => options.config ?? loadClientAcquisitionConfig();

  fastify.get('/config', {
    config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return publicConfig(getConfig());
  });

  fastify.post('/intake', {
    bodyLimit: INTAKE_BODY_LIMIT_BYTES,
    config: { public: true, rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const config = getConfig();
    if (!config.enabled) return reply.status(503).send(UNAVAILABLE);

    // CORS headers only instruct browsers; enforce the allowlist here too so a
    // cross-site form post cannot write an inquiry.
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin)) {
      return reply.status(403).send({ error: 'Origin not allowed', code: 'ORIGIN_NOT_ALLOWED' });
    }

    const parsed = intakeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))];
      return reply.status(400).send({ error: 'Inquiry is invalid', code: 'INVALID_INQUIRY', fields });
    }
    const input = parsed.data;

    // Honeypot tripped: answer like a success so automation learns nothing,
    // but store nothing.
    if (input.website) {
      return reply.status(202).send({ accepted: true, replayed: false });
    }

    const prisma = fastify.prisma;
    const payloadHash = canonicalPayloadHash(input);
    const replayOf = (existing) => (
      existing.payloadHash === payloadHash
        ? reply.status(200).send({ accepted: true, replayed: true })
        : reply.status(409).send({
          error: 'This idempotency key was already used for a different inquiry',
          code: 'IDEMPOTENCY_CONFLICT',
        })
    );

    const findExisting = () => prisma.publicInquiry.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: config.organizationId, idempotencyKey: input.idempotencyKey } },
      select: { payloadHash: true },
    });

    // A retry of an inquiry that was already accepted stays accepted, even if
    // the privacy notice changed in between.
    const existing = await findExisting();
    if (existing) return replayOf(existing);

    if (input.privacyVersion !== config.privacyVersion) {
      return reply.status(409).send({
        error: 'The privacy notice has changed. Please review it and submit again.',
        code: 'PRIVACY_VERSION_CHANGED',
        privacyVersion: config.privacyVersion,
      });
    }
    if (!config.serviceLines.includes(input.serviceLine)) {
      return reply.status(400).send({ error: 'Inquiry is invalid', code: 'INVALID_INQUIRY', fields: ['serviceLine'] });
    }

    // The configured owner must be an active staff member of the configured
    // organization; otherwise the gate is misconfigured and fails closed.
    const owner = await prisma.user.findFirst({
      where: { id: config.ownerId, organizationId: config.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } },
      select: { id: true },
    });
    if (!owner) {
      logger.error('[client-acquisition] Configured intake owner is not an active staff member of the intake organization');
      return reply.status(503).send(UNAVAILABLE);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const inquiry = await tx.publicInquiry.create({
          data: {
            organizationId: config.organizationId,
            ownerId: owner.id,
            idempotencyKey: input.idempotencyKey,
            payloadHash,
            name: input.name,
            email: input.email,
            company: input.company,
            phone: input.phone,
            serviceLine: input.serviceLine,
            businessContext: input.businessContext,
            requestedOutcome: input.requestedOutcome,
            timing: input.timing,
            budgetBand: input.budgetBand,
            budgetCurrency: input.budgetCurrency,
            privacyVersion: input.privacyVersion,
            consentedAt: new Date(),
            attribution: input.attribution,
          },
          select: { id: true },
        });
        // Created in the same transaction as the inquiry, so a replay can never
        // produce a second notification and a failed insert leaves none behind.
        await tx.notification.create({
          data: {
            userId: owner.id,
            type: 'inquiry.received',
            title: 'New website inquiry',
            message: `${input.name} asked about ${input.serviceLine}`,
            data: { inquiryId: inquiry.id },
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent request with the same key won the insert.
        const raced = await findExisting();
        if (raced) return replayOf(raced);
      }
      throw err;
    }

    return reply.status(201).send({ accepted: true, replayed: false });
  });

  fastify.get('/inquiries', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!['ADMIN', 'TEAM'].includes(request.user.role)) {
      return reply.status(403).send({ error: 'Staff access required' });
    }
    return fastify.prisma.publicInquiry.findMany({
      where: { organizationId: request.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  fastify.delete('/inquiries/:id', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const { count } = await fastify.prisma.publicInquiry.deleteMany({
      where: { id: request.params.id, organizationId: request.user.organizationId },
    });
    if (count === 0) return reply.status(404).send({ error: 'Inquiry not found' });
    return reply.status(204).send();
  });
}
