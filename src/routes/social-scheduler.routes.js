// Social Scheduler routes
// Migrated from ashbi-hub with auth decorators and Prisma service layer

import {
  generatePosts,
  schedulePost,
  getScheduledPosts,
  getPost,
  updatePostStatus,
  deletePost,
  getSocialAnalytics
} from '../services/socialScheduler.service.js';

export default async function socialSchedulerRoutes(fastify) {
  // Generate social media posts using AI (not persisted — returns array)
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { platform, topic, tone, count } = request.body;
    const posts = await generatePosts({ platform, topic, tone, count });
    return { posts };
  });

  // Schedule a post for publishing
  fastify.post('/schedule', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await schedulePost(request.body);
    return reply.status(201).send(post);
  });

  // Get scheduled posts with filters
  fastify.get('/posts', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { platform, status } = request.query;
    return getScheduledPosts({ platform, status });
  });

  // Get a single post
  fastify.get('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const post = await getPost(request.params.id);
    if (!post) return reply.status(404).send({ error: 'Post not found' });
    return post;
  });

  // Update post status (DRAFT → SCHEDULED → PUBLISHED)
  fastify.patch('/posts/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { status } = request.body;
    return updatePostStatus(request.params.id, status);
  });

  // Delete a post
  fastify.delete('/posts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    await deletePost(request.params.id);
    return { success: true };
  });

  // Get analytics
  fastify.get('/analytics', {
    onRequest: [fastify.authenticate]
  }, async () => {
    return getSocialAnalytics();
  });
}