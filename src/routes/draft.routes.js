import { validateBody, draftUpsertSchema } from '../validators/schemas.js';
// Draft (autosave) API routes
// Generic endpoints for saving/loading/clearing draft data on any entity
// Entities: proposal, invoice, contract, estimate, project, retainer

const ALLOWED_ENTITIES = new Set([
  'proposal',
  'invoice', 
  'contract',
  'estimate',
  'project',
  'retainerPlan',
]);

function getDraftField(entity) {
  return 'draftData';
}

export default async function draftRoutes(fastify) {
  // Save draft
  fastify.put('/:entity/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(draftUpsertSchema),
  }, async (request, reply) => {
    const { entity, id } = request.params;
    const { data } = request.body;

    if (!ALLOWED_ENTITIES.has(entity)) {
      return reply.status(400).send({ error: 'Invalid entity type' });
    }

    try {
      await request.prisma[entity].update({
        where: { id },
        data: { draftData: JSON.stringify(data) }
      });
      return { saved: true, at: new Date().toISOString() };
    } catch (err) {
      fastify.log.error({ err }, 'Draft save failed');
      return reply.status(500).send({ error: 'Failed to save draft' });
    }
  });

  // Load draft
  fastify.get('/:entity/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { entity, id } = request.params;

    if (!ALLOWED_ENTITIES.has(entity)) {
      return reply.status(400).send({ error: 'Invalid entity type' });
    }

    try {
      const record = await request.prisma[entity].findUnique({
        where: { id },
        select: { draftData: true, updatedAt: true }
      });
      
      if (!record || !record.draftData) {
        return { draft: null };
      }

      return {
        draft: JSON.parse(record.draftData),
        draftSavedAt: record.updatedAt
      };
    } catch (err) {
      fastify.log.error({ err }, 'Draft load failed');
      return reply.status(500).send({ error: 'Failed to load draft' });
    }
  });

  // Clear draft
  fastify.delete('/:entity/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(draftUpsertSchema),
  }, async (request, reply) => {
    const { entity, id } = request.params;

    if (!ALLOWED_ENTITIES.has(entity)) {
      return reply.status(400).send({ error: 'Invalid entity type' });
    }

    try {
      await request.prisma[entity].update({
        where: { id },
        data: { draftData: null }
      });
      return { cleared: true };
    } catch (err) {
      fastify.log.error({ err }, 'Draft clear failed');
      return reply.status(500).send({ error: 'Failed to clear draft' });
    }
  });
}
