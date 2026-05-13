/**
 * Upwork Agent Routes for ashbi-platform
 * API endpoints for Upwork profile optimization, job search, proposal generation, and auto-submit
 */

import {
  optimizeProfile,
  searchJobs,
  generateProposal,
  createProposalDraft,
  getJobAlerts
} from '../agents/upwork-agent.js';

import prisma from '../config/db.js';

export default async function upworkAgentRoutes(fastify) {
  /**
   * POST /api/upwork/profile-optimize
   * Get full Upwork profile rewrite (headline, overview, specializations, earned it)
   */
  fastify.post('/profile-optimize', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const result = await optimizeProfile();
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Error optimizing profile');
      return reply.status(500).send({
        error: 'Failed to optimize profile',
        message: error.message
      });
    }
  });

  /**
   * GET /api/upwork/jobs
   * Search Upwork for jobs matching Cam's ICP
   *
   * Query params:
   * - category: branding | packaging | shopify | dtc | cpg
   * - budgetMin: number
   * - budgetMax: number
   * - clientVerified: 'true' | 'false'
   * - limit: number (default 20)
   */
  fastify.get('/jobs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { category, budgetMin, budgetMax, clientVerified, limit } = request.query;
      const filters = {
        category,
        budgetMin: budgetMin ? parseInt(budgetMin) : undefined,
        budgetMax: budgetMax ? parseInt(budgetMax) : undefined,
        clientVerified,
        limit: limit ? parseInt(limit) : 20
      };

      const result = await searchJobs(filters);
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Error searching jobs');
      return reply.status(500).send({
        error: 'Failed to search jobs',
        message: error.message
      });
    }
  });

  /**
   * POST /api/upwork/proposal
   * Generate a personalized proposal for a specific job
   *
   * Body:
   * - jobId: string
   * - jobTitle: string
   * - clientBudget: number
   * - jobDescription: string
   */
  fastify.post('/proposal', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId, jobTitle, clientBudget, jobDescription } = request.body;

      if (!jobId || !jobTitle || !clientBudget || !jobDescription) {
        return reply.status(400).send({
          error: 'Missing required fields: jobId, jobTitle, clientBudget, jobDescription'
        });
      }

      const result = await generateProposal(
        jobId,
        jobTitle,
        parseFloat(clientBudget),
        jobDescription
      );

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Error generating proposal');
      return reply.status(500).send({
        error: 'Failed to generate proposal',
        message: error.message
      });
    }
  });

  /**
   * POST /api/upwork/proposal/draft
   * Create a Gmail draft for proposal review
   */
  fastify.post('/proposal/draft', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId, proposalText, jobTitle, clientBudget } = request.body;

      if (!jobId || !proposalText) {
        return reply.status(400).send({
          error: 'Missing required fields: jobId, proposalText'
        });
      }

      const result = await createProposalDraft(jobId, proposalText, {
        jobTitle,
        clientBudget: clientBudget ? parseFloat(clientBudget) : undefined
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Error creating proposal draft');
      return reply.status(500).send({
        error: 'Failed to create proposal draft',
        message: error.message
      });
    }
  });

  /**
   * GET /api/upwork/job-alerts
   * Get configured job alert configurations
   */
  fastify.get('/job-alerts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const result = getJobAlerts();
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Error getting job alerts');
      return reply.status(500).send({
        error: 'Failed to get job alerts',
        message: error.message
      });
    }
  });

  /**
   * POST /api/upwork/proposal/submit
   * Submit a proposal — saves to UpworkProposal DB as QUEUED for review
   *
   * Body:
   * - jobId: string
   * - jobTitle: string
   * - clientName: string (optional)
   * - budget: number (optional)
   * - coverLetter: string
   * - score: number (optional)
   * - jobUrl: string (optional)
   */
  fastify.post('/proposal/submit', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId, jobTitle, clientName, budget, coverLetter, score, jobUrl } = request.body;

      if (!jobId || !jobTitle || !coverLetter) {
        return reply.status(400).send({
          error: 'Missing required fields: jobId, jobTitle, coverLetter'
        });
      }

      // Save to UpworkProposal table
      const proposal = await prisma.upworkProposal.create({
        data: {
          jobId,
          jobTitle,
          clientName: clientName || null,
          budget: budget ? parseFloat(budget) : null,
          coverLetter,
          status: 'QUEUED',
          score: score ? parseInt(score) : null,
          jobUrl: jobUrl || null
        }
      });

      return reply.status(201).send({
        success: true,
        message: 'Proposal queued for review and submission',
        proposal
      });
    } catch (error) {
      request.log.error(error, 'Error submitting proposal');
      return reply.status(500).send({
        error: 'Failed to submit proposal',
        message: error.message
      });
    }
  });

  /**
   * GET /api/upwork/proposals
   * List all proposals with optional status filter
   *
   * Query params:
   * - status: DRAFT | QUEUED | SUBMITTED | INTERVIEWING | HIRED | DECLINED | WITHDRAWN
   * - limit: number (default 50)
   */
  fastify.get('/proposals', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { status, limit } = request.query;
      const where = {};
      if (status) where.status = status;

      const proposals = await prisma.upworkProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit ? parseInt(limit) : 50
      });

      return reply.send({ success: true, proposals });
    } catch (error) {
      request.log.error(error, 'Error listing proposals');
      return reply.status(500).send({
        error: 'Failed to list proposals',
        message: error.message
      });
    }
  });

  /**
   * PATCH /api/upwork/proposals/:id
   * Update proposal status (mark as submitted, interviewing, etc.)
   */
  fastify.patch('/proposals/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { status, notes } = request.body;

      const data = {};
      if (status) {
        data.status = status;
        if (status === 'SUBMITTED') data.submittedAt = new Date();
        if (status === 'INTERVIEWING') data.interviewAt = new Date();
      }
      if (notes !== undefined) data.notes = notes;

      const proposal = await prisma.upworkProposal.update({
        where: { id },
        data
      });

      return reply.send({ success: true, proposal });
    } catch (error) {
      request.log.error(error, 'Error updating proposal');
      return reply.status(500).send({
        error: 'Failed to update proposal',
        message: error.message
      });
    }
  });

  /**
   * GET /api/upwork/proposals/stats
   * Get proposal analytics: count by status, conversion rates
   */
  fastify.get('/proposals/stats', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const [draftCount, queuedCount, submittedCount, interviewingCount, hiredCount, declinedCount, withdrawnCount] =
        await Promise.all([
          prisma.upworkProposal.count({ where: { status: 'DRAFT' } }),
          prisma.upworkProposal.count({ where: { status: 'QUEUED' } }),
          prisma.upworkProposal.count({ where: { status: 'SUBMITTED' } }),
          prisma.upworkProposal.count({ where: { status: 'INTERVIEWING' } }),
          prisma.upworkProposal.count({ where: { status: 'HIRED' } }),
          prisma.upworkProposal.count({ where: { status: 'DECLINED' } }),
          prisma.upworkProposal.count({ where: { status: 'WITHDRAWN' } })
        ]);

      const totalSubmitted = submittedCount + interviewingCount + hiredCount + declinedCount;
      const hireRate = totalSubmitted > 0 ? Math.round((hiredCount / totalSubmitted) * 100) : 0;
      const interviewRate = totalSubmitted > 0 ? Math.round((interviewingCount / totalSubmitted) * 100) : 0;

      return reply.send({
        success: true,
        stats: {
          draft: draftCount,
          queued: queuedCount,
          submitted: submittedCount,
          interviewing: interviewingCount,
          hired: hiredCount,
          declined: declinedCount,
          withdrawn: withdrawnCount,
          totalSubmitted,
          hireRate,
          interviewRate
        }
      });
    } catch (error) {
      request.log.error(error, 'Error getting proposal stats');
      return reply.status(500).send({
        error: 'Failed to get proposal stats',
        message: error.message
      });
    }
  });
}
