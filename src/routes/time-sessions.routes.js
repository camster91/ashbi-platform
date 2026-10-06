// Time Sessions routes — thin wrapper around existing time tracking service
// POST /api/time-sessions — start or create time entry
// GET /api/time-sessions/running — get running timer
// POST /api/time-sessions/:id/stop — stop a running timer

import { validateBody, timeSessionStartSchema } from '../validators/schemas.js';
import {
  startTimer,
  stopTimer,
  getRunningTimer,
  sendTimerError
} from '../services/timeTracking.service.js';

export default async function timeSessionRoutes(fastify) {
  // Start a new timer (stops previous one automatically via service)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeSessionStartSchema),
  }, async (request, reply) => {
    const { projectId, taskId, description } = request.body;
    const userId = request.user.id;

    // TimeSession.projectId is required; the project must be visible in the
    // caller's organization (request.prisma is tenant-scoped).
    const project = await request.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const session = await startTimer(userId, projectId, taskId, description);
      return reply.status(201).send(session);
    } catch (err) {
      return sendTimerError(reply, err);
    }
  });

  // Stop the caller's running timer — creates a completed TimeEntry
  // (source TIMER) in the same transaction.
  fastify.post('/:id/stop', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      return await stopTimer(id, request.user.id);
    } catch (err) {
      return sendTimerError(reply, err);
    }
  });

  // Get currently running timer for the current user
  fastify.get('/running', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    return getRunningTimer(userId);
  });
}
