/**
 * Proposal Builder Routes for ashbi-platform
 * API endpoints for proposal generation, management, and tracking
 * Uses Fastify plugin pattern for route registration
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const {
  generateProposal,
  createProposalDraft,
  getProposalTemplates,
  saveProposal,
  updateProposal,
  trackProposalView,
  getProposal,
  getProposalStats,
  acceptProposal,
  PRICING_TIERS,
  PROPOSAL_STATUS
} = require('../agents/proposal-builder.agent.js');

/**
 * Simple auth preHandler - checks for Authorization header
 */
async function authPreHandler(request, reply) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  const apiKey = authHeader.replace('Bearer ', '');
  if (!apiKey) {
    return reply.status(403).send({ error: 'Invalid API key' });
  }
}

/**
 * Proposal Builder Fastify Plugin
 * All routes prefixed with /api/proposal-builder (registered in index.js)
 */
export default async function proposalBuilderRoutes(fastify) {
  /**
   * POST /generate
   * Generate a full proposal from lead data
   * Body: { name, company, email, projectType, budget, timeline, notes }
   */
  fastify.post('/generate', async (request, reply) => {
    try {
      const { name, company, email, projectType, budget, timeline, notes } = request.body || {};

      if (!name || !email) {
        return reply.status(400).send({ error: 'name and email are required' });
      }

      const proposal = await generateProposal({
        name,
        company,
        email,
        projectType,
        budget,
        timeline,
        notes
      });

      // Optionally save as draft
      if (request.body.saveAsDraft !== false) {
        try {
          const savedProposal = await saveProposal({
            ...proposal,
            leadData: { name, company, email, projectType, budget, timeline }
          });
          proposal.id = savedProposal.id;
          proposal.status = savedProposal.status;
        } catch (saveErr) {
          fastify.log.warn('Could not save proposal draft: %s', saveErr.message);
        }
      }

      return {
        success: true,
        proposal: {
          id: proposal.id,
          title: proposal.title,
          html: proposal.html,
          pricingTiers: proposal.pricingTiers,
          selectedTier: proposal.selectedTier
        },
        templates: getProposalTemplates(),
        pricingTiers: PRICING_TIERS
      };
    } catch (error) {
      fastify.log.error('Error generating proposal: %s', error.message);
      return reply.status(500).send({ error: 'Failed to generate proposal', message: error.message });
    }
  });

  /**
   * POST /:id/send
   * Create Gmail draft with proposal attached
   * Body: { email } (recipient email override)
   */
  fastify.post('/:id/send', {
    onRequest: [authPreHandler]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const { email } = request.body || {};

      // Get the proposal
      const proposal = await getProposal(proposalId);
      if (!proposal) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      // Get email from proposal or use override
      const recipientEmail = email || proposal.client?.email;
      if (!recipientEmail) {
        return reply.status(400).send({ error: 'No recipient email provided' });
      }

      // Reconstruct proposal data for draft
      const proposalData = {
        title: proposal.title,
        html: proposal.notes ? JSON.parse(proposal.notes).html || '' : '',
        leadData: proposal.client ? {
          name: proposal.client.name,
          email: proposal.client.email,
          company: proposal.client.company
        } : null
      };

      // Create Gmail draft with PDF
      const draftResult = await createProposalDraft(proposalData, recipientEmail);

      // Update proposal status to SENT
      await updateProposal(proposalId, { status: PROPOSAL_STATUS.SENT });

      return {
        success: true,
        draft: {
          id: draftResult.draftId,
          to: recipientEmail,
          subject: draftResult.subject,
          createdAt: new Date().toISOString()
        },
        proposal: {
          id: proposal.id,
          status: PROPOSAL_STATUS.SENT
        }
      };
    } catch (error) {
      fastify.log.error('Error creating proposal draft: %s', error.message);
      return reply.status(500).send({ error: 'Failed to send proposal', message: error.message });
    }
  });

  /**
   * GET /:id
   * Get proposal by ID
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const proposal = await getProposal(proposalId);

      // Parse stored notes if present
      let parsedNotes = {};
      try {
        if (proposal.notes) {
          parsedNotes = JSON.parse(proposal.notes);
        }
      } catch (e) {
        // notes might be plain text
        parsedNotes = { raw: proposal.notes };
      }

      return {
        proposal: {
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          subtotal: proposal.subtotal,
          total: proposal.total,
          validUntil: proposal.validUntil,
          createdAt: proposal.createdAt,
          viewedAt: proposal.viewedAt,
          acceptedAt: proposal.acceptedAt,
          client: proposal.client,
          createdBy: proposal.createdBy,
          lineItems: proposal.lineItems,
          notes: parsedNotes
        }
      };
    } catch (error) {
      fastify.log.error('Error getting proposal: %s', error.message);
      return reply.status(error.message.includes('not found') ? 404 : 500).send({
        error: error.message.includes('not found') ? 'Proposal not found' : 'Failed to get proposal',
        message: error.message
      });
    }
  });

  /**
   * PUT /:id
   * Update proposal content
   * Body: { title, notes, status, subtotal, total, validUntil }
   */
  fastify.put('/:id', {
    onRequest: [authPreHandler]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const { title, notes, status, subtotal, total, validUntil } = request.body || {};

      const proposal = await updateProposal(proposalId, {
        title,
        notes,
        status,
        subtotal,
        total,
        validUntil
      });

      return {
        success: true,
        proposal: {
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          subtotal: proposal.subtotal,
          total: proposal.total,
          validUntil: proposal.validUntil,
          updatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      fastify.log.error('Error updating proposal: %s', error.message);
      return reply.status(500).send({ error: 'Failed to update proposal', message: error.message });
    }
  });

  /**
   * GET /stats
   * Get proposal statistics: sent, viewed, accepted, rejected counts
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await getProposalStats();
      return stats;
    } catch (error) {
      fastify.log.error('Error getting proposal stats: %s', error.message);
      return reply.status(500).send({ error: 'Failed to get stats', message: error.message });
    }
  });

  /**
   * POST /:id/accept
   * Mark proposal as accepted (triggers contract generation)
   */
  fastify.post('/:id/accept', async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const result = await acceptProposal(proposalId);

      return {
        success: true,
        proposal: result.proposal,
        message: result.message
      };
    } catch (error) {
      fastify.log.error('Error accepting proposal: %s', error.message);
      return reply.status(500).send({ error: 'Failed to accept proposal', message: error.message });
    }
  });

  /**
   * GET /templates
   * Get available proposal templates
   */
  fastify.get('/templates', async (request, reply) => {
    return {
      templates: getProposalTemplates()
    };
  });

  /**
   * GET /pricing-tiers
   * Get current pricing tier configuration
   */
  fastify.get('/pricing-tiers', async (request, reply) => {
    return {
      pricingTiers: PRICING_TIERS
    };
  });

  /**
   * POST /:id/track
   * Track that a proposal was viewed (for email open tracking webhooks)
   */
  fastify.post('/:id/track', async (request, reply) => {
    try {
      const proposalId = request.params.id;
      await trackProposalView(proposalId);

      // Return 1x1 transparent GIF for tracking pixel
      reply.header('Content-Type', 'image/gif');
      return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    } catch (error) {
      fastify.log.error('Error tracking proposal view: %s', error.message);
      // Still return tracking pixel even on error
      reply.header('Content-Type', 'image/gif');
      return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    }
  });
}
