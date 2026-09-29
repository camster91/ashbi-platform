// Time Tracking routes
// Migrated from ashbi-hub with auth decorators and service layer

import { validateBody, timeSessionStartNewSchema, timeEntryCreateSchema } from '../validators/schemas.js';
import {
  startTimer,
  stopTimer,
  stopAllRunningTimers,
  createManualEntry,
  getTimeSummary,
  deleteTimeEntry,
  getRunningTimer,
  sendTimerError
} from '../services/timeTracking.service.js';

export default async function timeTrackingRoutes(fastify) {
  // Start a timer
  fastify.post('/start', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeSessionStartNewSchema),
  }, async (request, reply) => {
    const { projectId, taskId, description } = request.body;
    const userId = request.user.id;

    try {
      const session = await startTimer(userId, projectId, taskId, description);
      return reply.status(201).send(session);
    } catch (err) {
      return sendTimerError(reply, err);
    }
  });

  // Stop the caller's timer; creates its TimeEntry in the same transaction.
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

  // Stop all running timers for the current user
  fastify.post('/stop-all', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const stoppedCount = await stopAllRunningTimers(userId);
    return { stopped: stoppedCount };
  });

  // Get currently running timer
  fastify.get('/running', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    return getRunningTimer(userId);
  });

  // Create a manual time entry
  fastify.post('/manual', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(timeEntryCreateSchema),
  }, async (request, reply) => {
    const userId = request.user.id;
    const { projectId } = request.body;
    const entry = await createManualEntry(userId, projectId, request.body);
    return reply.status(201).send(entry);
  });

  // Get time summary
  fastify.get('/summary', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;
    const { projectId, startDate, endDate } = request.query;
    return getTimeSummary(userId, { projectId, startDate, endDate });
  });

  // Delete one of the caller's stopped timer sessions (not a TimeEntry;
  // entries are deleted with DELETE /api/time-entries/:id).
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      return await deleteTimeEntry(id, request.user.id);
    } catch (err) {
      return sendTimerError(reply, err);
    }
  });
}