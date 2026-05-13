import prisma from '../config/db.js';
import logger from '../utils/logger.js';

/**
 * Trash API
 * Returns all items with deletedAt across soft-deletable entities.
 * Provides restore and permanent-delete operations.
 */
export default async function trashRoutes(fastify, opts) {
  // ─── GET /api/trash — list all deleted items ──────────────────────
  fastify.get('/api/trash', async (request, reply) => {
    const p = request.prisma || prisma;
    
    // Fetch deleted items from all soft-deletable models
    // Use raw prisma (not scoped) to bypass deletedAt: null filter, then apply org filter
    const models = [
      { key: 'clients',    query: p.client.findMany({ where: { deletedAt: { not: null }, organizationId: request.organizationId || undefined }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'projects',   query: p.project.findMany({ where: { deletedAt: { not: null } }, include: { client: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'tasks',      query: p.task.findMany({ where: { deletedAt: { not: null } }, include: { project: { select: { name: true, client: { select: { name: true } } } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'invoices',   query: p.invoice.findMany({ where: { deletedAt: { not: null } }, include: { client: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'proposals',  query: p.proposal.findMany({ where: { deletedAt: { not: null } }, include: { client: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'contracts',  query: p.contract.findMany({ where: { deletedAt: { not: null } }, include: { client: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'expenses',   query: p.expense.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
      { key: 'estimates',  query: p.estimate.findMany({ where: { deletedAt: { not: null } }, include: { client: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 50 }) },
    ];
    
    const results = await Promise.all(models.map(m => m.query));
    
    // Flatten with entity type
    const items = [];
    for (let i = 0; i < models.length; i++) {
      for (const item of results[i]) {
        items.push({
          id: item.id,
          type: models[i].key.slice(0, -1), // Remove trailing 's'
          typeLabel: models[i].key.charAt(0).toUpperCase() + models[i].key.slice(1, -1),
          title: item.title || item.name || item.invoiceNumber || '(untitled)',
          clientName: item.client?.name || item.project?.client?.name || item.project?.name || '-',
          deletedAt: item.deletedAt,
          amount: item.total || item.amount || null,
          status: item.status || null,
        });
      }
    }
    
    // Sort by deletedAt descending
    items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    
    return {
      total: items.length,
      items,
    };
  });

  // ─── POST /api/trash/restore — restore a deleted item ─────────────
  fastify.post('/api/trash/restore', async (request, reply) => {
    const { id, type } = request.body;
    const p = request.prisma || prisma;

    if (!id || !type) {
      return reply.status(400).send({ error: 'id and type are required' });
    }

    try {
      // Map type to model
      const modelMap = {
        client: p.client,
        project: p.project,
        task: p.task,
        invoice: p.invoice,
        proposal: p.proposal,
        contract: p.contract,
        expense: p.expense,
        estimate: p.estimate,
      };

      const model = modelMap[type];
      if (!model) {
        return reply.status(400).send({ error: `Unknown type: ${type}` });
      }

      await model.update({
        where: { id },
        data: { deletedAt: null },
      });

      return { success: true };
    } catch (err) {
      logger.error({ err, id, type }, 'Failed to restore item');
      return reply.status(500).send({ error: 'Failed to restore item' });
    }
  });

  // ─── DELETE /api/trash/permanent — permanently delete an item ────
  fastify.delete('/api/trash/permanent', async (request, reply) => {
    const { id, type } = request.body;
    const p = request.prisma || prisma;

    if (!id || !type) {
      return reply.status(400).send({ error: 'id and type are required' });
    }

    try {
      const modelMap = {
        client: p.client,
        project: p.project,
        task: p.task,
        invoice: p.invoice,
        proposal: p.proposal,
        contract: p.contract,
        expense: p.expense,
        estimate: p.estimate,
      };

      const model = modelMap[type];
      if (!model) {
        return reply.status(400).send({ error: `Unknown type: ${type}` });
      }

      await model.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error({ err, id, type }, 'Failed to permanently delete item');
      return reply.status(500).send({ error: 'Failed to permanently delete item' });
    }
  });

  // ─── POST /api/trash/empty — permanently delete ALL trash ──────
  fastify.post('/api/trash/empty', async (request, reply) => {
    const p = request.prisma || prisma;
    const orgFilter = request.organizationId ? { organizationId: request.organizationId } : {};

    try {
      const operations = [
        p.client.deleteMany({ where: { deletedAt: { not: null }, ...orgFilter } }),
        p.project.deleteMany({ where: { deletedAt: { not: null }, ...orgFilter } }),
        p.task.deleteMany({ where: { deletedAt: { not: null } } }),
        p.invoice.deleteMany({ where: { deletedAt: { not: null } } }),
        p.proposal.deleteMany({ where: { deletedAt: { not: null } } }),
        p.contract.deleteMany({ where: { deletedAt: { not: null } } }),
        p.expense.deleteMany({ where: { deletedAt: { not: null } } }),
        p.estimate.deleteMany({ where: { deletedAt: { not: null } } }),
      ];

      const results = await Promise.all(operations);
      const totalDeleted = results.reduce((sum, r) => sum + (r.count || 0), 0);

      return { success: true, totalDeleted };
    } catch (err) {
      logger.error({ err }, 'Failed to empty trash');
      return reply.status(500).send({ error: 'Failed to empty trash' });
    }
  });
}
