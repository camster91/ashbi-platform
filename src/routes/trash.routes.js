import { authorizeNote } from '../services/note-access.service.js';
import { rawPrisma } from '../config/db.js';
import { permanentlyDeleteTrashedItem, restoreTrashedItem, isResourceLinkRetention } from '../services/trash-purge.service.js';

export default async function trashRoutes(fastify) {
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const where = { restoredAt: null };
    if (request.query.entity) where.entity = request.query.entity;

    const candidates = await request.prisma.trashedItem.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      take: 100,
    });
    const items = [];
    for (const item of candidates) {
      if (item.entity === 'NOTE') {
        try { await authorizeNote(request.prisma, item.recordId, request.user, { includeDeleted: true }); }
        catch (error) { if ([403, 404].includes(error.statusCode)) continue; throw error; }
      }
      items.push(item);
    }
    const grouped = {};
    for (const item of items) (grouped[item.entity] ??= []).push(item);
    return { items, grouped };
  });

  fastify.post('/:id/restore', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await restoreTrashedItem({
        actor: request.user,
        scopedPrisma: request.prisma,
        rawPrisma,
        trashId: request.params.id,
      });
      return { success: true, ...result };
    } catch (error) {
      if (error.statusCode >= 400 && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message, ...(isResourceLinkRetention(error) ? { code: error.code } : {}) });
      throw error;
    }
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
      if (error.statusCode >= 400 && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message, ...(isResourceLinkRetention(error) ? { code: error.code } : {}) });
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
        // Only the service's own 4xx messages are caller-safe.
        const safe = error.statusCode >= 400 && error.statusCode < 500;
        if (!safe) request.log.error({ errorName: error?.name, trashId: item.id }, 'Permanent deletion failed');
        failures.push({ id: item.id, error: safe ? error.message : 'Permanent deletion failed', ...(isResourceLinkRetention(error) ? { code: error.code } : {}) });
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
