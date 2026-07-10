import { validateBody, timeSessionStartNewSchema } from '../validators/schemas.js';
// Time Session routes (live timer backend)

export default async function timeSessionRoutes(fastify) {
  // Start a new timer session
  fastify.post('/start', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeSessionStartNewSchema),
  }, async (request, reply) => {
    const { taskId, projectId, description, billable } = request.body;
    const userId = request.user.id;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    // Stop any currently running timer for this user first
    const running = await request.prisma.timeSession.findFirst({
      where: { userId, endTime: null, deletedAt: null }
    });

    if (running) {
      const now = new Date();
      let pausedMs = running.totalPausedMs || 0;
      if (running.pausedAt) {
        pausedMs += now - running.pausedAt;
      }
      const durationMs = now - running.startTime - pausedMs;
      const durationMinutes = Math.max(0, Math.round(durationMs / (1000 * 60)));

      await request.prisma.timeSession.update({
        where: { id: running.id },
        data: {
          endTime: now,
          duration: durationMinutes,
          totalPausedMs: pausedMs
        }
      });

      // Create a TimeEntry for the stopped session
      await request.prisma.timeEntry.create({
        data: {
          description: running.description,
          duration: durationMinutes,
          date: running.startTime,
          billable: running.billable ?? true,
          source: 'TIMER',
          taskId: running.taskId,
          projectId: running.projectId,
          userId: running.userId
        }
      });
    }

    const session = await request.prisma.timeSession.create({
      data: {
        userId,
        projectId,
        taskId: taskId || null,
        description: description || null,
        billable: billable !== undefined ? billable : true,
        startTime: new Date(),
        isRunning: true
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });

    return reply.status(201).send(session);
  });

  // Pause a running timer
  fastify.post('/:id/pause', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const session = await request.prisma.timeSession.findFirst({
      where: { id, userId, endTime: null, deletedAt: null }
    });

    if (!session) {
      return reply.status(404).send({ error: 'Active session not found' });
    }

    if (session.pausedAt) {
      return reply.status(400).send({ error: 'Session is already paused' });
    }

    const updated = await request.prisma.timeSession.update({
      where: { id },
      data: { pausedAt: new Date(), isRunning: false },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });

    return updated;
  });

  // Resume a paused timer
  fastify.post('/:id/resume', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const session = await request.prisma.timeSession.findFirst({
      where: { id, userId, endTime: null, deletedAt: null }
    });

    if (!session) {
      return reply.status(404).send({ error: 'Active session not found' });
    }

    if (!session.pausedAt) {
      return reply.status(400).send({ error: 'Session is not paused' });
    }

    const now = new Date();
    const additionalPausedMs = now - session.pausedAt;
    const totalPausedMs = (session.totalPausedMs || 0) + additionalPausedMs;

    const updated = await request.prisma.timeSession.update({
      where: { id },
      data: {
        pausedAt: null,
        totalPausedMs,
        isRunning: true
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });

    return updated;
  });

  // Stop a timer and create a TimeEntry
  fastify.post('/:id/stop', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const session = await request.prisma.timeSession.findFirst({
      where: { id, userId, endTime: null, deletedAt: null }
    });

    if (!session) {
      return reply.status(404).send({ error: 'Active session not found' });
    }

    const now = new Date();
    let pausedMs = session.totalPausedMs || 0;
    if (session.pausedAt) {
      pausedMs += now - session.pausedAt;
    }
    const durationMs = now - session.startTime - pausedMs;
    const durationMinutes = Math.max(0, Math.round(durationMs / (1000 * 60)));

    const updated = await request.prisma.timeSession.update({
      where: { id },
      data: {
        endTime: now,
        duration: durationMinutes,
        totalPausedMs: pausedMs,
        isRunning: false,
        pausedAt: null
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      }
    });

    // Create a TimeEntry for the stopped session
    await request.prisma.timeEntry.create({
      data: {
        description: session.description,
        duration: durationMinutes,
        date: session.startTime,
        billable: session.billable ?? true,
        source: 'TIMER',
        taskId: session.taskId,
        projectId: session.projectId,
        userId: session.userId
      }
    });

    return updated;
  });

  // Get active (running or paused) session for the current user
  fastify.get('/active', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;

    const session = await request.prisma.timeSession.findFirst({
      where: { userId, endTime: null, deletedAt: null },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      },
      orderBy: { startTime: 'desc' }
    });

    if (!session) {
      return null;
    }

    const now = new Date();
    let pausedMs = session.totalPausedMs || 0;
    if (session.pausedAt) {
      pausedMs += now - session.pausedAt;
    }
    const durationMs = now - session.startTime - pausedMs;
    const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));

    return {
      ...session,
      durationSeconds,
      durationMinutes: Math.floor(durationSeconds / 60),
      isPaused: !!session.pausedAt
    };
  });

  // List user's recent sessions with computed durations
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const { limit: limitParam = '20', offset: offsetParam = '0' } = request.query;

    const limit = Math.min(parseInt(limitParam) || 20, 100);
    const offset = parseInt(offsetParam) || 0;

    const sessions = await request.prisma.timeSession.findMany({
      where: { userId, deletedAt: null },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } }
      },
      orderBy: { startTime: 'desc' },
      skip: offset,
      take: limit
    });

    return sessions.map(session => {
      const now = new Date();
      let durationMs = 0;

      if (session.endTime) {
        durationMs = session.endTime - session.startTime - (session.totalPausedMs || 0);
      } else {
        let pausedMs = session.totalPausedMs || 0;
        if (session.pausedAt) {
          pausedMs += now - session.pausedAt;
        }
        durationMs = now - session.startTime - pausedMs;
      }

      const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
      const durationMinutes = Math.floor(durationSeconds / 60);

      return {
        ...session,
        durationSeconds,
        durationMinutes,
        isPaused: !!session.pausedAt && !session.endTime
      };
    });
  });
}
