/**
 * Outreach Scheduler Routes for ashbi-platform
 * API endpoints for manual trigger and status checks
 */

const express = require('express');
const router = express.Router();

const {
  checkReplies,
  generateFollowUpDrafts,
  runWeeklyCycle,
  getSchedulerStatus
} = require('../agents/outreach-scheduler.agent');

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
  const validKey = process.env.OUTREACH_SCHEDULER_API_KEY || 'dev-key';
  
  if (apiKey !== validKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * POST /outreach-scheduler/run
 * Manually trigger the full weekly outreach cycle
 */
router.post('/run', authMiddleware, async (req, res) => {
  try {
    console.log('Manual weekly cycle triggered via API');
    const result = await runWeeklyCycle();
    res.json(result);
  } catch (error) {
    console.error('Error running weekly cycle:', error);
    res.status(500).json({ 
      error: 'Failed to run weekly cycle',
      message: error.message 
    });
  }
});

/**
 * POST /outreach-scheduler/check-replies
 * Check inbox for new replies from outreach leads
 */
router.post('/check-replies', authMiddleware, async (req, res) => {
  try {
    console.log('Checking for replies via API');
    const result = await checkReplies();
    res.json(result);
  } catch (error) {
    console.error('Error checking replies:', error);
    res.status(500).json({ 
      error: 'Failed to check replies',
      message: error.message 
    });
  }
});

/**
 * GET /outreach-scheduler/status
 * Get scheduler status, next scheduled run, and prospect stats
 */
router.get('/status', async (req, res) => {
  try {
    const status = await getSchedulerStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    res.status(500).json({ 
      error: 'Failed to get scheduler status',
      message: error.message 
    });
  }
});

export default router;