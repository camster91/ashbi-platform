/**
 * Upwork Job Tracker Routes
 * API endpoints for tracking Upwork jobs and drafting cover letters
 */

import prisma from '../config/db.js';

export default async function upworkJobsRoutes(fastify) {

  // ========== JOBS ==========

  /**
   * GET /api/upwork/jobs
   * List all jobs with optional status filter
   */
  fastify.get('/jobs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { status, limit = 50 } = request.query;
      const where = {};
      if (status) where.status = status;

      const jobs = await prisma.upworkJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit ? parseInt(limit) : 50,
        include: {
          drafts: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      return reply.send({ success: true, jobs });
    } catch (error) {
      request.log.error(error, 'Error listing upwork jobs');
      return reply.status(500).send({ error: 'Failed to list jobs', message: error.message });
    }
  });

  /**
   * GET /api/upwork/jobs/:id
   * Get single job with its drafts
   */
  fastify.get('/jobs/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const job = await prisma.upworkJob.findUnique({
        where: { id },
        include: { drafts: { orderBy: { createdAt: 'desc' } } }
      });
      if (!job) return reply.status(404).send({ error: 'Job not found' });
      return reply.send({ success: true, job });
    } catch (error) {
      request.log.error(error, 'Error getting job');
      return reply.status(500).send({ error: 'Failed to get job', message: error.message });
    }
  });

  /**
   * POST /api/upwork/jobs
   * Add a new job by URL (manual entry or scrape)
   */
  fastify.post('/jobs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { url, title, description, budget, clientName, score } = request.body;

      if (!url || !title) {
        return reply.status(400).send({ error: 'url and title are required' });
      }

      // Check for duplicate URL
      const existing = await prisma.upworkJob.findUnique({ where: { url } });
      if (existing) {
        return reply.status(409).send({ error: 'Job with this URL already exists', job: existing });
      }

      const job = await prisma.upworkJob.create({
        data: {
          url,
          title,
          description: description || null,
          budget: budget || null,
          clientName: clientName || null,
          score: score ? parseInt(score) : null,
          status: 'DRAFT'
        }
      });

      return reply.status(201).send({ success: true, job });
    } catch (error) {
      request.log.error(error, 'Error creating upwork job');
      return reply.status(500).send({ error: 'Failed to create job', message: error.message });
    }
  });

  /**
   * PATCH /api/upwork/jobs/:id
   * Update job status, notes, etc.
   */
  fastify.patch('/jobs/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { status, notes, title, description, budget, clientName, score } = request.body;

      const data = {};
      if (status) data.status = status;
      if (notes !== undefined) data.notes = notes;
      if (title) data.title = title;
      if (description !== undefined) data.description = description;
      if (budget !== undefined) data.budget = budget;
      if (clientName !== undefined) data.clientName = clientName;
      if (score !== undefined) data.score = score ? parseInt(score) : null;

      const job = await prisma.upworkJob.update({
        where: { id },
        data,
        include: { drafts: { orderBy: { createdAt: 'desc' }, take: 1 } }
      });

      return reply.send({ success: true, job });
    } catch (error) {
      request.log.error(error, 'Error updating job');
      return reply.status(500).send({ error: 'Failed to update job', message: error.message });
    }
  });

  /**
   * DELETE /api/upwork/jobs/:id
   * Remove a job and its drafts
   */
  fastify.delete('/jobs/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      await prisma.upworkJob.delete({ where: { id } });
      return reply.send({ success: true, message: 'Job deleted' });
    } catch (error) {
      request.log.error(error, 'Error deleting job');
      return reply.status(500).send({ error: 'Failed to delete job', message: error.message });
    }
  });

  // ========== DRAFT PROPOSALS ==========

  /**
   * GET /api/upwork/jobs/:jobId/drafts
   * List all drafts for a job
   */
  fastify.get('/jobs/:jobId/drafts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      const drafts = await prisma.upworkDraftProposal.findMany({
        where: { jobId },
        orderBy: { createdAt: 'desc' }
      });
      return reply.send({ success: true, drafts });
    } catch (error) {
      request.log.error(error, 'Error listing drafts');
      return reply.status(500).send({ error: 'Failed to list drafts', message: error.message });
    }
  });

  /**
   * POST /api/upwork/jobs/:jobId/drafts
   * Create a new draft cover letter
   */
  fastify.post('/jobs/:jobId/drafts', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      const { coverLetter, proposedRate, status } = request.body;

      if (!coverLetter) {
        return reply.status(400).send({ error: 'coverLetter is required' });
      }

      // Verify job exists
      const job = await prisma.upworkJob.findUnique({ where: { id: jobId } });
      if (!job) return reply.status(404).send({ error: 'Job not found' });

      const draft = await prisma.upworkDraftProposal.create({
        data: {
          jobId,
          coverLetter,
          proposedRate: proposedRate || null,
          status: status || 'DRAFT'
        }
      });

      return reply.status(201).send({ success: true, draft });
    } catch (error) {
      request.log.error(error, 'Error creating draft');
      return reply.status(500).send({ error: 'Failed to create draft', message: error.message });
    }
  });

  /**
   * PUT /api/upwork/drafts/:id
   * Update a draft
   */
  fastify.put('/drafts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { coverLetter, proposedRate, status } = request.body;

      const data = {};
      if (coverLetter !== undefined) data.coverLetter = coverLetter;
      if (proposedRate !== undefined) data.proposedRate = proposedRate;
      if (status !== undefined) data.status = status;

      const draft = await prisma.upworkDraftProposal.update({
        where: { id },
        data
      });

      return reply.send({ success: true, draft });
    } catch (error) {
      request.log.error(error, 'Error updating draft');
      return reply.status(500).send({ error: 'Failed to update draft', message: error.message });
    }
  });

  /**
   * DELETE /api/upwork/drafts/:id
   * Delete a draft
   */
  fastify.delete('/drafts/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      await prisma.upworkDraftProposal.delete({ where: { id } });
      return reply.send({ success: true, message: 'Draft deleted' });
    } catch (error) {
      request.log.error(error, 'Error deleting draft');
      return reply.status(500).send({ error: 'Failed to delete draft', message: error.message });
    }
  });

  /**
   * POST /api/upwork/jobs/:jobId/apply
   * Mark job as applied and mark latest draft as submitted
   */
  fastify.post('/jobs/:jobId/apply', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;

      // Update job status to APPLIED
      const job = await prisma.upworkJob.update({
        where: { id: jobId },
        data: { status: 'APPLIED' },
        include: { drafts: { orderBy: { createdAt: 'desc' }, take: 1 } }
      });

      // Mark the latest draft as SUBMITTED
      if (job.drafts.length > 0) {
        await prisma.upworkDraftProposal.update({
          where: { id: job.drafts[0].id },
          data: { status: 'SUBMITTED' }
        });
      }

      return reply.send({ success: true, job });
    } catch (error) {
      request.log.error(error, 'Error applying to job');
      return reply.status(500).send({ error: 'Failed to apply', message: error.message });
    }
  });
}