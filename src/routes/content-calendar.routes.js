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
import {
  getScheduledPosts,
  getPost,
  createSocialPost,
  updatePostStatus,
  deletePost,
  getSocialAnalytics,
  publishPost
} from '../services/socialScheduler.service.js';

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

  // ===== Social Posts (Auto-Posting) =====

  // Get scheduled/published social posts
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { platform, status } = request.query;
    return getScheduledPosts({ platform, status });
  });

  // Get social post analytics
  fastify.get('/posts/analytics', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return getSocialAnalytics();
  });

  // Get a single social post
  fastify.get('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await getPost(request.params.id);
    if (!post) return reply.status(404).send({ error: 'Post not found' });
    return post;
  });

  // Create/compose a social post
  fastify.post('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await createSocialPost(request.body);
    return reply.status(201).send(post);
  });

  // Update post status (e.g., DRAFT -> SCHEDULED)
  fastify.patch('/posts/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return updatePostStatus(request.params.id, request.body.status);
  });

  // Manually publish a post (immediate)
  fastify.post('/posts/:id/publish', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const result = await publishPost(request.params.id);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Delete a social post
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deletePost(request.params.id);
    return { success: true };
  });
}