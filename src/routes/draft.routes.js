import { validateBody, draftUpsertSchema } from '../validators/schemas.js';

const ALLOWED_ENTITIES = new Set([
  'proposal',
  'invoice',
  'contract',
  'estimate',
  'project',
  'retainerPlan',
  'expense',
]);

const RETENTION_DAYS = 30;

function ownerWhere(request, entity, entityId) {
  return {
    organizationId: request.user.organizationId,
    userId: request.user.id,
    entity,
    entityId,
  };
}

function expiresAt() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + RETENTION_DAYS);
  return date;
}

function ensureValidRequest(request, reply) {
  if (!ALLOWED_ENTITIES.has(request.params.entity)) {
    reply.status(400).send({ error: 'Invalid entity type' });
    return false;
  }
  if (!request.user?.id || !request.user?.organizationId) {
    reply.status(403).send({ error: 'Organization context required', code: 'ORG_CONTEXT_REQUIRED' });
    return false;
  }
  return true;
}

function responseFor(record) {
  return {
    draft: record.data,
    revision: record.revision,
    draftSavedAt: record.updatedAt,
    baseUpdatedAt: record.baseUpdatedAt,
    expiresAt: record.expiresAt,
  };
}

export default async function draftRoutes(fastify) {
  fastify.put('/:entity/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(draftUpsertSchema),
  }, async (request, reply) => {
    if (!ensureValidRequest(request, reply)) return;
    const { entity, id: entityId } = request.params;
    const { data, expectedRevision, baseUpdatedAt } = request.body;
    const where = ownerWhere(request, entity, entityId);

    try {
      const current = await request.prisma.formDraft.findFirst({ where });
      if (!current) {
        if (expectedRevision !== undefined) {
          return reply.status(409).send({ error: 'Draft changed or was removed', code: 'DRAFT_CONFLICT' });
        }
        const created = await request.prisma.formDraft.create({
          data: {
            ...where,
            data,
            baseUpdatedAt: baseUpdatedAt ? new Date(baseUpdatedAt) : null,
            expiresAt: expiresAt(),
          },
        });
        return { saved: true, ...responseFor(created) };
      }

      if (expectedRevision !== current.revision) {
        return reply.status(409).send({
          error: 'A newer draft exists',
          code: 'DRAFT_CONFLICT',
          currentRevision: current.revision,
          draftSavedAt: current.updatedAt,
        });
      }

      const result = await request.prisma.formDraft.updateMany({
        where: { ...where, revision: expectedRevision },
        data: {
          data,
          revision: { increment: 1 },
          baseUpdatedAt: baseUpdatedAt ? new Date(baseUpdatedAt) : current.baseUpdatedAt,
          expiresAt: expiresAt(),
        },
      });
      if (result.count !== 1) {
        return reply.status(409).send({ error: 'A newer draft exists', code: 'DRAFT_CONFLICT' });
      }
      const updated = await request.prisma.formDraft.findFirst({ where });
      return { saved: true, ...responseFor(updated) };
    } catch (err) {
      fastify.log.error({ err }, 'Draft save failed');
      return reply.status(500).send({ error: 'Failed to save draft' });
    }
  });

  fastify.get('/:entity/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!ensureValidRequest(request, reply)) return;
    const where = ownerWhere(request, request.params.entity, request.params.id);
    try {
      const record = await request.prisma.formDraft.findFirst({ where });
      if (!record || record.expiresAt <= new Date()) return { draft: null, revision: null };
      return responseFor(record);
    } catch (err) {
      fastify.log.error({ err }, 'Draft load failed');
      return reply.status(500).send({ error: 'Failed to load draft' });
    }
  });

  fastify.delete('/:entity/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!ensureValidRequest(request, reply)) return;
    const expectedRevision = request.query?.revision ? Number(request.query.revision) : undefined;
    const where = ownerWhere(request, request.params.entity, request.params.id);
    if (expectedRevision) where.revision = expectedRevision;
    try {
      const result = await request.prisma.formDraft.deleteMany({ where });
      if (expectedRevision && result.count !== 1) {
        return reply.status(409).send({ error: 'Draft changed before it could be cleared', code: 'DRAFT_CONFLICT' });
      }
      return { cleared: result.count === 1 };
    } catch (err) {
      fastify.log.error({ err }, 'Draft clear failed');
      return reply.status(500).send({ error: 'Failed to clear draft' });
    }
  });
}
