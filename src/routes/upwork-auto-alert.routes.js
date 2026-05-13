/**
 * Upwork Auto-Alert Routes — Fastify
 * Daily cron hooks into this for Telegram alerts + auto-proposal submission
 */

import {
  searchJobs,
  scoreJobRelevance,
  runDailyAlert,
  generateProposalForJob,
  getRecentJobs,
  getStats,
  sendTestAlert
} from '../agents/upwork-auto-alert.agent.js';

export default async function upworkAutoAlertRoutes(fastify) {

  // ─── POST /run — Trigger the daily alert cycle ────────────────────────────
  fastify.post('/run', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const result = await runDailyAlert();
      return result;
    } catch (error) {
      request.log.error({ err: error }, 'Auto-alert run failed');
      return reply.status(500).send({ error: 'Auto-alert run failed', message: error.message });
    }
  });

  // ─── GET /jobs — Search current jobs ──────────────────────────────────────
  fastify.get('/jobs', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { budgetMin, clientVerified, limit } = request.query;
      const result = await searchJobs({
        budgetMin: budgetMin ? parseInt(budgetMin) : undefined,
        clientVerified: clientVerified !== 'false',
        limit: limit ? parseInt(limit) : 50
      });
      return result;
    } catch (error) {
      request.log.error({ err: error }, 'Auto-alert job search failed');
      return reply.status(500).send({ error: 'Job search failed', message: error.message });
    }
  });

  // ─── GET /recent — Get recently matched jobs ──────────────────────────────
  fastify.get('/recent', {
    preHandler: [fastify.authenticate]
  }, async () => {
    return { success: true, jobs: getRecentJobs() };
  });

  // ─── GET /stats — Get alert statistics ────────────────────────────────────
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async () => {
    return { success: true, stats: getStats() };
  });

  // ─── POST /generate/:jobId — Generate proposal for a specific job ─────────
  fastify.post('/generate/:jobId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      const result = await generateProposalForJob(jobId);
      return result;
    } catch (error) {
      request.log.error({ err: error }, 'Proposal generation failed');
      return reply.status(500).send({ error: 'Proposal generation failed', message: error.message });
    }
  });

  // ─── POST /test — Send a test Telegram alert ──────────────────────────────
  fastify.post('/test', {
    preHandler: [fastify.authenticate]
  }, async () => {
    return await sendTestAlert();
  });
}
