/**
 * Proposal Builder Routes for ashbi-platform
 * API endpoints for proposal generation, management, and tracking
 */

const express = require('express');
const router = express.Router();

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
} = require('../agents/proposal-builder.agent');

/**
 * Simple auth middleware
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required' });
  }
  next();
}

/**
 * POST /proposal-builder/generate
 * Generate a full proposal from lead data
 * Body: { name, company, email, projectType, budget, timeline, notes }
 */
router.post('/generate', async (req, res) => {
  try {
    const { name, company, email, projectType, budget, timeline, notes } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
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
    if (req.body.saveAsDraft !== false) {
      try {
        const savedProposal = await saveProposal({
          ...proposal,
          leadData: { name, company, email, projectType, budget, timeline }
        });
        proposal.id = savedProposal.id;
        proposal.status = savedProposal.status;
      } catch (saveErr) {
        console.warn('Could not save proposal draft:', saveErr.message);
      }
    }

    res.json({
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
    });
  } catch (error) {
    console.error('Error generating proposal:', error);
    res.status(500).json({ error: 'Failed to generate proposal', message: error.message });
  }
});

/**
 * POST /proposal-builder/:id/send
 * Create Gmail draft with proposal attached
 * Body: { email } (recipient email override)
 */
router.post('/:id/send', authMiddleware, async (req, res) => {
  try {
    const proposalId = req.params.id;
    const { email } = req.body || {};

    // Get the proposal
    const proposal = await getProposal(proposalId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Get email from proposal or use override
    const recipientEmail = email || proposal.client?.email;
    if (!recipientEmail) {
      return res.status(400).json({ error: 'No recipient email provided' });
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

    res.json({
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
    });
  } catch (error) {
    console.error('Error creating proposal draft:', error);
    res.status(500).json({ error: 'Failed to send proposal', message: error.message });
  }
});

/**
 * GET /proposal-builder/:id
 * Get proposal by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const proposalId = req.params.id;
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

    res.json({
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
    });
  } catch (error) {
    console.error('Error getting proposal:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      error: error.message.includes('not found') ? 'Proposal not found' : 'Failed to get proposal',
      message: error.message
    });
  }
});

/**
 * PUT /proposal-builder/:id
 * Update proposal content
 * Body: { title, notes, status, subtotal, total, validUntil }
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const proposalId = req.params.id;
    const { title, notes, status, subtotal, total, validUntil } = req.body || {};

    const proposal = await updateProposal(proposalId, {
      title,
      notes,
      status,
      subtotal,
      total,
      validUntil
    });

    res.json({
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
    });
  } catch (error) {
    console.error('Error updating proposal:', error);
    res.status(500).json({ error: 'Failed to update proposal', message: error.message });
  }
});

/**
 * GET /proposal-builder/stats
 * Get proposal statistics: sent, viewed, accepted, rejected counts
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getProposalStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting proposal stats:', error);
    res.status(500).json({ error: 'Failed to get stats', message: error.message });
  }
});

/**
 * POST /proposal-builder/:id/accept
 * Mark proposal as accepted (triggers contract generation)
 */
router.post('/:id/accept', async (req, res) => {
  try {
    const proposalId = req.params.id;
    const result = await acceptProposal(proposalId);

    res.json({
      success: true,
      proposal: result.proposal,
      message: result.message
    });
  } catch (error) {
    console.error('Error accepting proposal:', error);
    res.status(500).json({ error: 'Failed to accept proposal', message: error.message });
  }
});

/**
 * GET /proposal-builder/templates
 * Get available proposal templates
 */
router.get('/templates', (req, res) => {
  res.json({
    templates: getProposalTemplates()
  });
});

/**
 * GET /proposal-builder/pricing-tiers
 * Get current pricing tier configuration
 */
router.get('/pricing-tiers', (req, res) => {
  res.json({
    pricingTiers: PRICING_TIERS
  });
});

/**
 * POST /proposal-builder/:id/track
 * Track that a proposal was viewed (for email open tracking webhooks)
 */
router.post('/:id/track', async (req, res) => {
  try {
    const proposalId = req.params.id;
    const result = await trackProposalView(proposalId);

    // Return 1x1 transparent GIF for tracking pixel
    res.set('Content-Type', 'image/gif');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  } catch (error) {
    console.error('Error tracking proposal view:', error);
    // Still return tracking pixel even on error
    res.set('Content-Type', 'image/gif');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  }
});

module.exports = router;