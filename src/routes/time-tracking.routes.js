// Time Tracking routes
// Migrated from ashbi-hub with auth decorators and service layer

import {
  startTimer,
  stopTimer,
  stopAllRunningTimers,
  createManualEntry,
  getTimeSummary,
  deleteTimeEntry,
  getRunningTimer
} from '../services/timeTracking.service.js';

export default async function timeTrackingRoutes(fastify) {
  // Start a timer
  fastify.post('/start', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { projectId, taskId, description } = request.body;
    const userId = request.user.id;

    const session = await startTimer(userId, projectId, taskId, description);
    return reply.status(201).send(session);
  });

  // Stop a timer
  fastify.post('/:id/stop', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    return stopTimer(id);
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
    onRequest: [fastify.authenticate]
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

  // Delete a time entry
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;
    return deleteTimeEntry(id, userId);
  });
}