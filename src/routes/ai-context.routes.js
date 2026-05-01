// AI Context settings routes

import prisma from '../config/db.js';

export default async function aiContextRoutes(fastify) {
  // Get all AI context key/value pairs
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const rows = await prisma.aiContext.findMany({
      orderBy: { key: 'asc' }
    });
    return rows;
  });

  // Update or create a key/value pair
  fastify.post('/', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { key, value } = request.body;

    if (!key || value === undefined) {
      return reply.status(400).send({ error: 'key and value are required' });
    }

    const row = await prisma.aiContext.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });

    return row;
  });

  // Delete a key
  fastify.delete('/:key', {
    onRequest: [fastify.adminOnly]
  }, async (request, reply) => {
    const { key } = request.params;

    try {
      await prisma.aiContext.delete({ where: { key } });
      return { success: true };
    } catch {
      return reply.status(404).send({ error: 'Key not found' });
    }
  });

  // Get context as a formatted system prompt prefix (used by AI agents)
  fastify.get('/prompt', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const rows = await prisma.aiContext.findMany();
    const context = rows.reduce((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {});

    const prompt = Object.entries(context)
      .map(([k, v]) => `[${k.replace(/_/g, ' ').toUpperCase()}]: ${v}`)
      .join('\n');

    return { prompt, context };
  });
}
