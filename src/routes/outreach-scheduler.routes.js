/**
 * Outreach Scheduler Routes for ashbi-platform (Fastify)
 * API endpoints for manual trigger and status checks
 */

import { 
  checkReplies,
  generateFollowUpDrafts,
  runWeeklyCycle,
  getSchedulerStatus
} from '../agents/outreach-scheduler.agent.js';

/**
 * Auth middleware for Fastify - checks for Authorization header
 */
async function authMiddleware(request, reply) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  // Simple API key check - in production use proper auth
  const apiKey = authHeader.replace('Bearer ', '');
  const validKey = process.env.OUTREACH_SCHEDULER_API_KEY || 'dev-key';

  if (apiKey !== validKey) {
    return reply.status(403).send({ error: 'Invalid API key' });
  }
}

/**
 * Outreach Scheduler routes registered as a Fastify plugin
 */
export default async function outreachSchedulerRoutes(fastify, opts) {
  /**
   * POST /api/outreach-scheduler/run
   * Manually trigger the full weekly outreach cycle
   */
  fastify.post('/run', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      console.log('Manual weekly cycle triggered via API');
      const result = await runWeeklyCycle();
      return reply.send(result);
    } catch (error) {
      console.error('Error running weekly cycle:', error);
      return reply.status(500).send({
        error: 'Failed to run weekly cycle',
        message: error.message
      });
    }
  });

  /**
   * POST /api/outreach-scheduler/check-replies
   * Check inbox for new replies from outreach leads
   */
  fastify.post('/check-replies', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      console.log('Checking for replies via API');
      const result = await checkReplies();
      return reply.send(result);
    } catch (error) {
      console.error('Error checking replies:', error);
      return reply.status(500).send({
        error: 'Failed to check replies',
        message: error.message
      });
    }
  });

  /**
   * GET /api/outreach-scheduler/status
   * Get scheduler status, next scheduled run, and prospect stats
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const status = await getSchedulerStatus();
      return reply.send(status);
    } catch (error) {
      console.error('Error getting scheduler status:', error);
      return reply.status(500).send({
        error: 'Failed to get scheduler status',
        message: error.message
      });
    }
  });
}
