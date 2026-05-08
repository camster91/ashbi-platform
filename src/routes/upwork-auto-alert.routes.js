/**
 * Upwork Auto-Alert Routes for ashbi-platform
 * API endpoints for manual trigger, status checks, and test alerts
 */

const express = require('express');
const router = express.Router();

const {
  searchJobs,
  scoreJobRelevance,
  sendTelegramAlert,
  runDailyAlert,
  generateProposalForJob,
  getRecentJobs,
  getStats,
  sendTestAlert
} = require('../agents/upwork-auto-alert.agent');

/**
 * Simple auth middleware - checks for Authorization header
 * In production, replace with proper JWT/session validation
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Simple API key check
  const apiKey = authHeader.replace('Bearer ', '');
  const validKey = process.env.UPWORK_AUTO_ALERT_API_KEY || 'dev-key';
  
  if (apiKey !== validKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * POST /upwork-auto-alert/run
 * Manually trigger the job search + scoring + alert cycle
 */
router.post('/run', authMiddleware, async (req, res) => {
  try {
    console.log('Manual Upwork auto-alert run triggered via API');
    
    const result = await runDailyAlert();
    
    res.json({
      success: true,
      message: 'Daily alert run completed',
      summary: {
        jobsSearched: result.jobsSearched,
        matchedJobs: result.matchedJobs,
        alertsSent: result.alertsSent,
        runAt: result.runAt
      },
      results: result.results
    });
  } catch (error) {
    console.error('Error running daily alert:', error);
    res.status(500).json({ 
      error: 'Failed to run daily alert',
      message: error.message 
    });
  }
});

/**
 * POST /upwork-auto-alert/proposal/:jobId
 * Generate proposal and create Gmail draft for a specific job
 * Called when user clicks "Generate Proposal" button in Telegram
 */
router.post('/proposal/:jobId', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({ 
        error: 'Job ID is required' 
      });
    }
    
    console.log(`Generating proposal for job: ${jobId}`);
    
    const result = await generateProposalForJob(jobId);
    
    res.json({
      success: true,
      message: 'Proposal draft created',
      jobId,
      draft: result.draft,
      proposal: result.proposal
    });
  } catch (error) {
    console.error('Error generating proposal:', error);
    res.status(500).json({ 
      error: 'Failed to generate proposal',
      message: error.message 
    });
  }
});

/**
 * GET /upwork-auto-alert/recent
 * List recent matched jobs (last 7 days)
 */
router.get('/recent', async (req, res) => {
  try {
    const recentJobs = getRecentJobs();
    
    // Score each job and include relevance info
    const jobsWithScores = recentJobs.map(job => ({
      ...job,
      score: scoreJobRelevance(job),
      timeAgo: formatTimeAgo(job.cachedAt || job.postedAt)
    }));
    
    // Sort by score descending
    jobsWithScores.sort((a, b) => b.score - a.score);
    
    res.json({
      success: true,
      count: jobsWithScores.length,
      jobs: jobsWithScores
    });
  } catch (error) {
    console.error('Error getting recent jobs:', error);
    res.status(500).json({ 
      error: 'Failed to get recent jobs',
      message: error.message 
    });
  }
});

/**
 * GET /upwork-auto-alert/stats
 * Get alert statistics (jobs found, proposals generated, etc.)
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = getStats();
    
    res.json({
      success: true,
      stats: {
        jobsFound: stats.jobsFound,
        proposalsGenerated: stats.proposalsGenerated,
        alertsSent: stats.alertsSent,
        lastRunAt: stats.lastRunAt,
        cachedJobsCount: stats.cachedJobsCount
      }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ 
      error: 'Failed to get stats',
      message: error.message 
    });
  }
});

/**
 * POST /upwork-auto-alert/test-alert
 * Send a test Telegram alert
 */
router.post('/test-alert', authMiddleware, async (req, res) => {
  try {
    console.log('Sending test Telegram alert...');
    
    const result = await sendTestAlert();
    
    res.json({
      success: true,
      message: 'Test alert sent',
      result
    });
  } catch (error) {
    console.error('Error sending test alert:', error);
    res.status(500).json({ 
      error: 'Failed to send test alert',
      message: error.message 
    });
  }
});

/**
 * GET /upwork-auto-alert/search
 * Manually search for jobs with specific filters
 * Query params: category, budgetMin, budgetMax, limit
 */
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { category, budgetMin, budgetMax, limit } = req.query;
    
    const filters = {
      budgetMin: budgetMin ? parseInt(budgetMin) : 500,
      limit: limit ? parseInt(limit) : 50
    };
    
    if (category) {
      filters.categories = [category];
    }
    
    const result = await searchJobs(filters);
    
    // Add scores to results
    const scoredJobs = result.jobs.map(job => ({
      ...job,
      score: scoreJobRelevance(job)
    }));
    
    res.json({
      success: true,
      query: result.query,
      total: result.total,
      jobs: scoredJobs
    });
  } catch (error) {
    console.error('Error searching jobs:', error);
    res.status(500).json({ 
      error: 'Failed to search jobs',
      message: error.message 
    });
  }
});

/**
 * GET /upwork-auto-alert/health
 * Health check endpoint (no auth required)
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'upwork-auto-alert',
    timestamp: new Date().toISOString()
  });
});

// Utility functions
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

module.exports = router;