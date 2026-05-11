/**
 * Proposal Builder Routes for ashbi-platform
 * Fastify ESM plugin — AI-powered proposal generation, PDF, and Gmail delivery
 */

import {
  generateProposal,
  generatePdf,
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
} from '../agents/proposal-builder.agent.js';

import prisma from '../config/db.js';

export default async function proposalBuilderRoutes(fastify) {

  /**
   * POST /generate
   * AI-generate a full proposal from lead data
   */
  fastify.post('/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { name, company, email, projectType, budget, timeline, notes, clientId } = request.body || {};

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

      // Save as draft if clientId provided
      let savedProposal = null;
      if (request.body.saveAsDraft !== false) {
        try {
          savedProposal = await saveProposal({
            ...proposal,
            leadData: {
              name, company, email, projectType, budget, timeline,
              clientId,
              userId: request.user?.id
            }
          });
          proposal.id = savedProposal.id;
          proposal.status = savedProposal.status;
        } catch (saveErr) {
          console.warn('Could not save proposal draft:', saveErr.message);
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
      console.error('Error generating proposal:', error);
      return reply.status(500).send({ error: 'Failed to generate proposal', message: error.message });
    }
  });

  /**
   * POST /:id/send
   * Generate PDF and create Gmail draft with proposal attached
   */
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const { email } = request.body || {};

      const proposal = await getProposal(proposalId);
      if (!proposal) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      // Get email from proposal or use override
      const recipientEmail = email || proposal.client?.email;
      if (!recipientEmail) {
        return reply.status(400).send({ error: 'No recipient email provided' });
      }

      // Reconstruct proposal data for PDF generation
      let parsedNotes = {};
      try {
        if (proposal.notes) {
          parsedNotes = JSON.parse(proposal.notes);
        }
      } catch (e) {
        parsedNotes = { raw: proposal.notes };
      }

      const proposalData = {
        title: proposal.title,
        html: parsedNotes.html || '',
        leadData: proposal.client ? {
          name: proposal.client.name,
          email: proposal.client.email,
          company: proposal.client.company,
          projectType: parsedNotes.projectType || 'project'
        } : {
          name: proposal.client?.name || 'Client',
          email: recipientEmail
        }
      };

      // Generate PDF
      let pdfBuffer = null;
      if (parsedNotes.html) {
        try {
          pdfBuffer = await generatePdf(parsedNotes.html);
        } catch (pdfErr) {
          console.warn('PDF generation failed, sending without attachment:', pdfErr.message);
        }
      }

      // Create Gmail draft with PDF
      let draftResult = null;
      try {
        draftResult = await createProposalDraft(proposalData, recipientEmail);
      } catch (draftErr) {
        console.warn('Gmail draft creation failed:', draftErr.message);
      }

      // Update proposal status to SENT
      await updateProposal(proposalId, { status: PROPOSAL_STATUS.SENT });

      return {
        success: true,
        draft: draftResult ? {
          id: draftResult.draftId,
          to: recipientEmail,
          subject: draftResult.subject,
          createdAt: new Date().toISOString()
        } : null,
        pdf: pdfBuffer ? {
          generated: true,
          size: pdfBuffer.length
        } : null,
        proposal: {
          id: proposal.id,
          status: PROPOSAL_STATUS.SENT
        }
      };
    } catch (error) {
      console.error('Error sending proposal:', error);
      return reply.status(500).send({ error: 'Failed to send proposal', message: error.message });
    }
  });

  /**
   * POST /:id/send-pdf
   * Generate PDF only (no email) — returns PDF buffer
   */
  fastify.post('/:id/send-pdf', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const proposal = await getProposal(proposalId);

      if (!proposal) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      let parsedNotes = {};
      try {
        if (proposal.notes) {
          parsedNotes = JSON.parse(proposal.notes);
        }
      } catch (e) {
        // notes might be plain text
      }

      if (!parsedNotes.html) {
        return reply.status(400).send({ error: 'Proposal has no HTML content for PDF generation' });
      }

      const pdfBuffer = await generatePdf(parsedNotes.html);

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="proposal-${proposalId}.pdf"`);
      return pdfBuffer;
    } catch (error) {
      console.error('Error generating PDF:', error);
      return reply.status(500).send({ error: 'Failed to generate PDF', message: error.message });
    }
  });

  /**
   * GET /:id
   * Get proposal by ID with parsed notes
   */
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const proposal = await getProposal(proposalId);

      let parsedNotes = {};
      try {
        if (proposal.notes) {
          parsedNotes = JSON.parse(proposal.notes);
        }
      } catch (e) {
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
          acceptedAt: proposal.approvedAt,
          client: proposal.client,
          createdBy: proposal.createdBy,
          lineItems: proposal.lineItems,
          notes: parsedNotes
        }
      };
    } catch (error) {
      const status = error.message.includes('not found') ? 404 : 500;
      return reply.status(status).send({
        error: error.message.includes('not found') ? 'Proposal not found' : 'Failed to get proposal',
        message: error.message
      });
    }
  });

  /**
   * PUT /:id
   * Update proposal content
   */
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const { title, notes, status, subtotal, total, validUntil } = request.body || {};

      const proposal = await updateProposal(proposalId, {
        title, notes, status, subtotal, total, validUntil
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
      console.error('Error updating proposal:', error);
      return reply.status(500).send({ error: 'Failed to update proposal', message: error.message });
    }
  });

  /**
   * GET /stats
   * Get proposal statistics
   */
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const stats = await getProposalStats();
      return stats;
    } catch (error) {
      console.error('Error getting proposal stats:', error);
      return reply.status(500).send({ error: 'Failed to get stats', message: error.message });
    }
  });

  /**
   * POST /:id/accept
   * Mark proposal as accepted (triggers contract generation)
   */
  fastify.post('/:id/accept', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const proposalId = request.params.id;
      const result = await acceptProposal(proposalId);

      return {
        success: true,
        proposal: result.proposal,
        message: result.message
      };
    } catch (error) {
      console.error('Error accepting proposal:', error);
      return reply.status(500).send({ error: 'Failed to accept proposal', message: error.message });
    }
  });

  /**
   * GET /templates
   * Get available proposal templates
   */
  fastify.get('/templates', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    return {
      templates: getProposalTemplates()
    };
  });

  /**
   * GET /pricing-tiers
   * Get current pricing tier configuration
   */
  fastify.get('/pricing-tiers', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
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
      console.error('Error tracking proposal view:', error);
      // Still return tracking pixel even on error
      reply.header('Content-Type', 'image/gif');
      return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    }
  });
}
