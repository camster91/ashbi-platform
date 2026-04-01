// Upwork Messages API - retrieve full message threads synced by the upwork-agent

export default async function upworkMessagesRoutes(fastify) {
  const BOT_SECRET = process.env.BOT_SECRET;

  function requireAuth(request, reply, done) {
    // Accept bot bearer token OR JWT
    const auth = request.headers.authorization;
    if (auth === `Bearer ${BOT_SECRET}`) {
      done();
      return;
    }
    // Fall back to JWT auth
    fastify.authenticate(request, reply, done);
  }

  // GET /api/upwork/messages — list all message threads
  fastify.get('/messages', { preHandler: requireAuth }, async (request) => {
    const { prisma } = fastify;
    const { roomId, limit } = request.query;

    const where = {
      tags: { contains: 'message-thread' },
      properties: { path: '$.source', equals: 'upwork' },
    };

    if (roomId) {
      where.properties = {
        AND: [
          { path: '$.source', equals: 'upwork' },
          { path: '$.roomId', equals: roomId },
        ],
      };
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) || 50,
    });

    return tasks.map(t => {
      const props = typeof t.properties === 'string' ? JSON.parse(t.properties) : (t.properties || {});
      let messages = [];
      try {
        messages = props.messages ? JSON.parse(props.messages) : [];
      } catch { /* ignore */ }

      return {
        id: t.id,
        roomId: props.roomId,
        participants: props.participants || [],
        messageCount: props.messageCount || 0,
        messages,
        syncedAt: t.createdAt,
        description: t.description,
      };
    });
  });

  // GET /api/upwork/messages/:roomId — get full thread for a specific room
  fastify.get('/messages/:roomId', { preHandler: requireAuth }, async (request, reply) => {
    const { prisma } = fastify;
    const { roomId } = request.params;

    const task = await prisma.task.findFirst({
      where: {
        tags: { contains: 'message-thread' },
        properties: {
          path: '$.roomId',
          equals: roomId,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!task) {
      return reply.status(404).send({ error: 'Thread not found', roomId });
    }

    const props = typeof task.properties === 'string' ? JSON.parse(task.properties) : (task.properties || {});
    let messages = [];
    try {
      messages = props.messages ? JSON.parse(props.messages) : [];
    } catch { /* ignore */ }

    return {
      id: task.id,
      roomId: props.roomId,
      participants: props.participants || [],
      messageCount: props.messageCount || 0,
      messages,
      syncedAt: task.createdAt,
      description: task.description,
    };
  });
}
