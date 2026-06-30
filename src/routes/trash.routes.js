// Trash routes — soft deleted items management

import ENTITY_MAP from '../utils/entity-map.js';

export default async function trashRoutes(fastify) {
  // GET /api/trash — list recently deleted items grouped by entity
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { entity } = request.query;

    const where = {};
    if (entity) where.entity = entity;
    where.restoredAt = null;

    const items = await fastify.prisma.trashedItem.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
    });

    const grouped = {};
    for (const item of items) {
      if (!grouped[item.entity]) grouped[item.entity] = [];
      grouped[item.entity].push(item);
    }

    return { items, grouped };
  });

  // POST /api/trash/:id/restore — restore item to original table, clear deletedAt
  fastify.post('/:id/restore', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    const trashed = await fastify.prisma.trashedItem.findUnique({ where: { id } });
    if (!trashed) return reply.status(404).send({ error: 'Trashed item not found' });
    if (trashed.restoredAt) return reply.status(400).send({ error: 'Item already restored' });

    const modelName = ENTITY_MAP[trashed.entity];
    const prismaModel = fastify.prisma[modelName];
    if (!prismaModel) return reply.status(500).send({ error: 'Unknown entity type' });

    // Check if parent record still exists (not permanently deleted)
    // Use explicit deletedAt filter to bypass soft-delete auto-filtering
    const existing = await prismaModel.findUnique({
      where: { id: trashed.recordId, deletedAt: { not: null } }
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Original record no longer exists' });
    }

    await fastify.prisma.$transaction([
      prismaModel.update({
        where: { id: trashed.recordId },
        data: { deletedAt: null },
      }),
      fastify.prisma.trashedItem.update({
        where: { id: trashed.id },
        data: { restoredAt: new Date() },
      }),
    ]);

    return { success: true, restoredId: trashed.recordId };
  });

  // DELETE /api/trash/:id/permanent — permanently delete (db + cascade)
  fastify.delete('/:id/permanent', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const { id } = request.params;

    const trashed = await fastify.prisma.trashedItem.findUnique({ where: { id } });
    if (!trashed) return reply.status(404).send({ error: 'Trashed item not found' });

    const modelName = ENTITY_MAP[trashed.entity];
    const prismaModel = fastify.prisma[modelName];
    if (!prismaModel) return reply.status(500).send({ error: 'Unknown entity type' });

    // Check if parent record still exists — if so, delete it
    const existing = await prismaModel.findUnique({ where: { id: trashed.recordId } });
    if (existing) {
      await prismaModel.delete({ where: { id: trashed.recordId } });
    }

    await fastify.prisma.trashedItem.delete({ where: { id: trashed.id } });

    return { success: true };
  });
}
