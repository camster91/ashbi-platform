import { prisma } from '../index.js';

export default async function rateCardRoutes(fastify) {
  // List rate cards
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { clientId } = request.query;
    const where = {};
    if (clientId) where.clientId = clientId;

    const rateCards = await prisma.rateCard.findMany({
      where: {
        OR: [
          where,
          { isDefault: true }
        ]
      },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    });

    return { rateCards };
  });

  // Get single rate card
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const rateCard = await prisma.rateCard.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { id: true, name: true } } }
    });
    if (!rateCard) return reply.status(404).send({ error: 'Rate card not found' });
    return rateCard;
  });

  // Create rate card
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, clientId, rates, isDefault } = request.body;
    if (!name) return reply.status(400).send({ error: 'Name is required' });

    // If setting as default, unset any existing default
    if (isDefault) {
      await prisma.rateCard.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    const rateCard = await prisma.rateCard.create({
      data: {
        name,
        clientId: clientId || null,
        rates: rates || [],
        isDefault: isDefault || false
      },
      include: { client: { select: { id: true, name: true } } }
    });

    return reply.status(201).send(rateCard);
  });

  // Update rate card
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.rateCard.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Rate card not found' });

    const { name, rates, isDefault, clientId } = request.body;

    if (isDefault && !existing.isDefault) {
      await prisma.rateCard.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    const rateCard = await prisma.rateCard.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(rates !== undefined && { rates }),
        ...(isDefault !== undefined && { isDefault }),
        ...(clientId !== undefined && { clientId: clientId || null })
      },
      include: { client: { select: { id: true, name: true } } }
    });

    return rateCard;
  });

  // Delete rate card
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.rateCard.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Rate card not found' });
    await prisma.rateCard.delete({ where: { id } });
    return { success: true };
  });
}