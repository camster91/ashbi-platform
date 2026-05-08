/**
 * Upwork Agent Routes for ashbi-platform
 * API endpoints for Upwork profile optimization, job search, and proposal generation
 */

const express = require('express');
const router = express.Router();

const {
  optimizeProfile,
  searchJobs,
  generateProposal,
  createProposalDraft,
  getJobAlerts
} = require('../agents/upwork-agent');

/**
 * Simple auth middleware - checks for Authorization header
 * In production, replace with proper JWT/session validation
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Simple API key check - in production use proper auth
  const apiKey = authHeader.replace('Bearer ', '');
  const validKey = process.env.UPWORK_AGENT_API_KEY || 'dev-key';
  
  if (apiKey !== validKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * POST /upwork/profile-optimize
 * Get full Upwork profile rewrite (headline, overview, specializations, earned it)
 * 
 * Returns the complete optimized profile content from the rewrite
 */
router.post('/profile-optimize', authMiddleware, async (req, res) => {
  try {
    const result = await optimizeProfile();
    res.json(result);
  } catch (error) {
    console.error('Error optimizing profile:', error);
    res.status(500).json({ 
      error: 'Failed to optimize profile',
      message: error.message 
    });
  }
});

/**
 * GET /upwork/jobs
 * Search Upwork for jobs matching Cam's ICP
 * 
 * Query params:
 * - category: branding | packaging | shopify | dtc | cpg
 * - budgetMin: number
 * - budgetMax: number
 * - clientVerified: 'true' | 'false'
 * - limit: number (default 20)
 */
router.get('/jobs', authMiddleware, async (req, res) => {
  try {
    const { category, budgetMin, budgetMax, clientVerified, limit } = req.query;
    
    const filters = {
      category,
      budgetMin: budgetMin ? parseInt(budgetMin) : undefined,
      budgetMax: budgetMax ? parseInt(budgetMax) : undefined,
      clientVerified,
      limit: limit ? parseInt(limit) : 20
    };

    const result = await searchJobs(filters);
    res.json(result);
  } catch (error) {
    console.error('Error searching jobs:', error);
    res.status(500).json({ 
      error: 'Failed to search jobs',
      message: error.message 
    });
  }
});

/**
 * POST /upwork/proposal
 * Generate a personalized proposal for a specific job
 * 
 * Body:
 * - jobId: string
 * - jobTitle: string
 * - clientBudget: number
 * - jobDescription: string
 */
router.post('/proposal', authMiddleware, async (req, res) => {
  try {
    const { jobId, jobTitle, clientBudget, jobDescription } = req.body;
    
    if (!jobId || !jobTitle || !clientBudget || !jobDescription) {
      return res.status(400).json({ 
        error: 'Missing required fields: jobId, jobTitle, clientBudget, jobDescription' 
      });
    }

    const result = await generateProposal(
      jobId,
      jobTitle,
      parseFloat(clientBudget),
      jobDescription
    );

    res.json(result);
  } catch (error) {
    console.error('Error generating proposal:', error);
    res.status(500).json({ 
      error: 'Failed to generate proposal',
      message: error.message 
    });
  }
});

/**
 * POST /upwork/proposal/draft
 * Create a Gmail draft for proposal review
 * 
 * Body:
 * - jobId: string
 * - proposalText: string (full proposal cover letter)
 * - jobTitle: string (optional)
 * - clientBudget: number (optional)
 */
router.post('/proposal/draft', authMiddleware, async (req, res) => {
  try {
    const { jobId, proposalText, jobTitle, clientBudget } = req.body;
    
    if (!jobId || !proposalText) {
      return res.status(400).json({ 
        error: 'Missing required fields: jobId, proposalText' 
      });
    }

    const result = await createProposalDraft(jobId, proposalText, {
      jobTitle,
      clientBudget: clientBudget ? parseFloat(clientBudget) : undefined
    });

    res.json(result);
  } catch (error) {
    console.error('Error creating proposal draft:', error);
    res.status(500).json({ 
      error: 'Failed to create proposal draft',
      message: error.message 
    });
  }
});

/**
 * GET /upwork/job-alerts
 * Get configured job alert configurations
 */
router.get('/job-alerts', authMiddleware, async (req, res) => {
  try {
    const result = getJobAlerts();
    res.json(result);
  } catch (error) {
    console.error('Error getting job alerts:', error);
    res.status(500).json({ 
      error: 'Failed to get job alerts',
      message: error.message 
    });
  }
});

export default router;