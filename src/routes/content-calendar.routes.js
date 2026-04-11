// Content Calendar routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  updateEventStatus,
  deleteEvent,
  getUpcoming
} from '../services/contentCalendar.service.js';

export default async function contentCalendarRoutes(fastify) {
  // Get calendar events with optional filters
  fastify.get('/events', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, type, status, clientId } = request.query;
    return getEvents({ startDate, endDate, contentType: type, status, clientId });
  });

  // Get upcoming deadlines
  fastify.get('/upcoming', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { limit } = request.query;
    return getUpcoming(parseInt(limit) || 10);
  });

  // Get a single event
  fastify.get('/events/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const event = await getEvent(request.params.id);
    if (!event) return reply.status(404).send({ error: 'Event not found' });
    return event;
  });

  // Create a calendar event
  fastify.post('/events', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const event = await createEvent(request.body);
    return reply.status(201).send(event);
  });

  // Update a calendar event
  fastify.patch('/events/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updateEvent(request.params.id, request.body);
  });

  // Update event status
  fastify.patch('/events/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status } = request.body;
    return updateEventStatus(request.params.id, status);
  });

  // Delete an event
  fastify.delete('/events/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deleteEvent(request.params.id);
    return { success: true };
  });
}