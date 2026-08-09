import { rawPrisma } from '../config/db.js';
import { permanentlyDeleteTrashedItem } from '../services/trash-purge.service.js';
import ENTITY_MAP from '../utils/entity-map.js';

export default async function trashRoutes(fastify) {
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const where = { restoredAt: null };
    if (request.query.entity) where.entity = request.query.entity;

    const items = await request.prisma.trashedItem.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      take: 100,
    });
    const grouped = {};
    for (const item of items) (grouped[item.entity] ??= []).push(item);
    return { items, grouped };
  });

  fastify.post('/:id/restore', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const trashed = await request.prisma.trashedItem.findFirst({
      where: { id: request.params.id },
    });
    if (!trashed) return reply.status(404).send({ error: 'Trashed item not found' });
    if (trashed.restoredAt) return reply.status(400).send({ error: 'Item already restored' });

    const modelName = ENTITY_MAP[trashed.entity];
    const model = modelName ? request.prisma[modelName] : null;
    if (!model) return reply.status(500).send({ error: 'Unknown entity type' });

    const existing = await model.findFirst({
      where: { id: trashed.recordId, deletedAt: { not: null } },
    });
    if (!existing) return reply.status(404).send({ error: 'Original record no longer exists' });

    await request.prisma.$transaction([
      model.update({ where: { id: trashed.recordId }, data: { deletedAt: null } }),
      request.prisma.trashedItem.update({
        where: { id: trashed.id },
        data: { restoredAt: new Date() },
      }),
    ]);
    return { success: true, restoredId: trashed.recordId };
  });

  fastify.delete('/:id/permanent', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    try {
      const result = await permanentlyDeleteTrashedItem({
        scopedPrisma: request.prisma,
        rawPrisma,
        trashId: request.params.id,
      });
      return { success: true, ...result };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  fastify.delete('/empty', { onRequest: [fastify.adminOnly] }, async (request) => {
    const items = await request.prisma.trashedItem.findMany({ where: { restoredAt: null } });
    const failures = [];
    let deleted = 0;

    for (const item of items) {
      try {
        await permanentlyDeleteTrashedItem({
          scopedPrisma: request.prisma,
          rawPrisma,
          trashId: item.id,
        });
        deleted++;
      } catch (error) {
        failures.push({ id: item.id, error: error.message });
      }
    }

    return {
      success: failures.length === 0,
      deleted,
      failed: failures.length,
      failures,
    };
  });
}
