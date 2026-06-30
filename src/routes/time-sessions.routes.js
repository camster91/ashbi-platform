// Time Sessions routes — thin wrapper around existing time tracking service
// POST /api/time-sessions — start or create time entry
// GET /api/time-sessions/running — get running timer
// POST /api/time-sessions/:id/stop — stop a running timer

import {
import { validateBody } from '../validators/schemas.js';
  startTimer,
  stopTimer,
  getRunningTimer
} from '../services/timeTracking.service.js';

export default async function timeSessionRoutes(fastify) {
  // Start a new timer (stops previous one automatically via service)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeSessionStartSchema),
  }, async (request, reply) => {
    const { projectId, taskId, description } = request.body;
    const userId = request.user.id;

    const session = await startTimer(userId, projectId, taskId, description);
    return reply.status(201).send(session);
  });

  // Stop a running timer — creates a completed TimeEntry
  fastify.post('/:id/stop', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return stopTimer(id);
  });

  // Get currently running timer for the current user
  fastify.get('/running', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    return getRunningTimer(userId);
  });
}
