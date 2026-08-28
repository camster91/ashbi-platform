import {
  getMigrationReviewPacket,
  importProjectLinkReviewPacket,
  importProjectDispositionReviewPacket,
  importFinancialExceptionReviewPacket,
  importActiveProjectOutcomeReviewPacket,
  importTaskDispositionReviewPacket,
  listMigrationReviewPackets,
  recordMigrationReviewDecision,
  exportMigrationReviewDecision,
} from '../services/migrationReview.service.js';
import {
  migrationReviewDecisionSchema,
  migrationReviewImportSchema,
  migrationProjectDispositionReviewImportSchema,
  migrationFinancialExceptionReviewImportSchema,
  migrationActiveProjectOutcomeReviewImportSchema,
  migrationTaskDispositionReviewImportSchema,
  validateBody,
} from '../validators/schemas.js';

function sendError(reply, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return reply.status(status).send({
    error: status >= 500 ? 'Migration review operation failed' : error.message,
  });
}

export default async function migrationReviewRoutes(fastify) {
  const adminOnly = { onRequest: [fastify.authenticate, fastify.adminOnly] };

  fastify.get('/', adminOnly, async (request) => ({
    packets: await listMigrationReviewPackets({ prismaClient: request.prisma }),
  }));

  fastify.get('/:id', adminOnly, async (request, reply) => {
    const packet = await getMigrationReviewPacket({ prismaClient: request.prisma, packetId: request.params.id });
    if (!packet) return reply.status(404).send({ error: 'Migration review packet not found' });
    return packet;
  });

  fastify.post('/project-links/import', {
    ...adminOnly,
    preHandler: [validateBody(migrationReviewImportSchema)],
  }, async (request, reply) => {
    try {
      const result = await importProjectLinkReviewPacket({
        prismaClient: request.prisma,
        input: request.body,
        importedBy: request.user.email,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Migration review import failed');
      return sendError(reply, error);
    }
  });

  fastify.post('/task-dispositions/import', {
    ...adminOnly,
    preHandler: [validateBody(migrationTaskDispositionReviewImportSchema)],
  }, async (request, reply) => {
    try {
      const result = await importTaskDispositionReviewPacket({
        prismaClient: request.prisma,
        input: request.body,
        importedBy: request.user.email,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Task-disposition migration review import failed');
      return sendError(reply, error);
    }
  });

  fastify.post('/project-dispositions/import', {
    ...adminOnly,
    preHandler: [validateBody(migrationProjectDispositionReviewImportSchema)],
  }, async (request, reply) => {
    try {
      const result = await importProjectDispositionReviewPacket({
        prismaClient: request.prisma,
        input: request.body,
        importedBy: request.user.email,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Project-disposition migration review import failed');
      return sendError(reply, error);
    }
  });

  fastify.post('/financial-exceptions/import', {
    ...adminOnly,
    preHandler: [validateBody(migrationFinancialExceptionReviewImportSchema)],
  }, async (request, reply) => {
    try {
      const result = await importFinancialExceptionReviewPacket({
        prismaClient: request.prisma,
        input: request.body,
        importedBy: request.user.email,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Financial-exception migration review import failed');
      return sendError(reply, error);
    }
  });

  fastify.post('/active-project-outcomes/import', {
    ...adminOnly,
    preHandler: [validateBody(migrationActiveProjectOutcomeReviewImportSchema)],
  }, async (request, reply) => {
    try {
      const result = await importActiveProjectOutcomeReviewPacket({
        prismaClient: request.prisma,
        input: request.body,
        importedBy: request.user.email,
      });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Active-project outcome migration review import failed');
      return sendError(reply, error);
    }
  });

  fastify.post('/:id/decisions/:candidateId', {
    ...adminOnly,
    preHandler: [validateBody(migrationReviewDecisionSchema)],
  }, async (request, reply) => {
    try {
      const result = await recordMigrationReviewDecision({
        prismaClient: request.prisma,
        packetId: request.params.id,
        candidateId: request.params.candidateId,
        requestId: request.body.requestId,
        decision: request.body.decision,
        reviewNote: request.body.reviewNote ?? null,
        reviewedBy: request.user.email,
      });
      if (!result) return reply.status(404).send({ error: 'Migration review packet not found' });
      return reply.status(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      request.log.error({ error: error.message }, 'Migration review decision failed');
      return sendError(reply, error);
    }
  });

  fastify.get('/:id/export', adminOnly, async (request, reply) => {
    try {
      const record = await exportMigrationReviewDecision({ prismaClient: request.prisma, packetId: request.params.id });
      if (!record) return reply.status(404).send({ error: 'Migration review packet not found' });
      reply.header('Content-Disposition', `attachment; filename="migration-review-decision-${request.params.id}.json"`);
      return record;
    } catch (error) {
      request.log.error({ error: error.message }, 'Migration review export failed');
      return sendError(reply, error);
    }
  });
}
