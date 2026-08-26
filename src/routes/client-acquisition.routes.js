import { createPublicInquiry, PublicInquiryError } from '../services/public-inquiry.service.js';
import { PUBLIC_SERVICE_LINES, publicInquirySchema, validateBody } from '../validators/schemas.js';

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
}
