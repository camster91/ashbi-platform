/**
 * Referral Engine Routes for ashbi-platform
 * API endpoints for referral network, tracking, and stats
 */

import express from 'express';
const router = express.Router();

const {
  getReferralNetwork,
  generateReferralEmail,
  createDraftForReferral,
  trackReferral,
  getTopReferrers,
  importContacts,
  REFERRAL_REWARD
} = require('../agents/referral-engine.agent');

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
  const validKey = process.env.REFERRAL_ENGINE_API_KEY || 'dev-key';
  
  if (apiKey !== validKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * GET /referral-engine/network
 * Get full referral network categorized by tiers
 * Returns clients organized by referral likelihood (Tier 1-3)
 */
router.get('/network', authMiddleware, async (req, res) => {
  try {
    const network = await getReferralNetwork();
    res.json(network);
  } catch (error) {
    console.error('Error getting referral network:', error);
    res.status(500).json({ 
      error: 'Failed to get referral network',
      message: error.message 
    });
  }
});

/**
 * POST /referral-engine/refer
 * Manually trigger a referral email draft for a contact
 * Body: { contactName, company, email }
 * Returns the generated email and creates a Gmail draft
 */
router.post('/refer', authMiddleware, async (req, res) => {
  try {
    const { contactName, company, email } = req.body;
    
    if (!contactName || !company || !email) {
      return res.status(400).json({ 
        error: 'Missing required fields: contactName, company, email' 
      });
    }

    // Generate referral email using AI
    const emailContent = await generateReferralEmail(contactName, company);
    
    // Create Gmail draft
    const draftResult = await createDraftForReferral(email, emailContent.subject, emailContent.body);

    res.json({
      success: true,
      generatedEmail: {
        subject: emailContent.subject,
        body: emailContent.body,
        generatedBy: emailContent.generatedBy
      },
      draft: {
        id: draftResult.draftId,
        to: email,
        createdAt: draftResult.createdAt
      }
    });
  } catch (error) {
    console.error('Error triggering referral:', error);
    res.status(500).json({ 
      error: 'Failed to trigger referral',
      message: error.message 
    });
  }
});

/**
 * POST /referral-engine/track
 * Record a referral from a referrer to a referred lead
 * Body: { referrerId, referredLead: { name, email, company, projectValue } }
 * Returns created referral record
 */
router.post('/track', authMiddleware, async (req, res) => {
  try {
    const { referrerId, referredLead } = req.body;
    
    if (!referrerId || !referredLead) {
      return res.status(400).json({ 
        error: 'Missing required fields: referrerId, referredLead' 
      });
    }

    if (!referredLead.name || !referredLead.email) {
      return res.status(400).json({ 
        error: 'referredLead must include name and email' 
      });
    }

    const result = await trackReferral(referrerId, referredLead);
    
    res.json({
      success: true,
      referral: result.referral,
      rewardInfo: result.referral.rewardEligible ? {
        amount: REFERRAL_REWARD.AMOUNT,
        condition: REFERRAL_REWARD.PAYMENT_CONDITION,
        minProjectValue: REFERRAL_REWARD.MIN_PROJECT_VALUE,
        maxProjectValue: REFERRAL_REWARD.MAX_PROJECT_VALUE
      } : {
        eligible: false,
        reason: referredLead.projectValue 
          ? `Project value ${referredLead.projectValue} not in ${REFERRAL_REWARD.MIN_PROJECT_VALUE}-${REFERRAL_REWARD.MAX_PROJECT_VALUE} range`
          : 'No project value provided'
      }
    });
  } catch (error) {
    console.error('Error tracking referral:', error);
    res.status(500).json({ 
      error: 'Failed to track referral',
      message: error.message 
    });
  }
});

/**
 * GET /referral-engine/stats
 * Get referral stats: total referrals, close rate, top referrers
 * Query params: limit (default 10)
 */
router.get('/stats', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topReferrersResult = await getTopReferrers(limit);
    
    // Get overall referral stats from database
    import {  PrismaClient  } from '@prisma/client';
    const prisma = new PrismaClient();
    
    const [totalReferrals, referralsByStatus] = await Promise.all([
      prisma.referral.count(),
      prisma.referral.groupBy({
        by: ['status'],
        _count: true
      })
    ]);

    const statusCounts = {};
    let convertedCount = 0;
    let paidCount = 0;
    
    referralsByStatus.forEach(s => {
      statusCounts[s.status] = s._count;
      if (['converted', 'paid'].includes(s.status)) {
        convertedCount += s._count;
      }
      if (s.status === 'paid') {
        paidCount += s._count;
      }
    });

    const closeRate = totalReferrals > 0 ? Math.round((convertedCount / totalReferrals) * 100) : 0;

    res.json({
      stats: {
        totalReferrals,
        convertedReferrals: convertedCount,
        paidReferrals: paidCount,
        closeRate,
        byStatus: statusCounts
      },
      topReferrers: topReferrersResult.referrers,
      topReferrersSummary: topReferrersResult.summary,
      rewardConfig: {
        amount: REFERRAL_REWARD.AMOUNT,
        minProjectValue: REFERRAL_REWARD.MIN_PROJECT_VALUE,
        maxProjectValue: REFERRAL_REWARD.MAX_PROJECT_VALUE,
        paymentCondition: REFERRAL_REWARD.PAYMENT_CONDITION
      },
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting referral stats:', error);
    res.status(500).json({ 
      error: 'Failed to get referral stats',
      message: error.message 
    });
  }
});

/**
 * POST /referral-engine/import-contacts
 * Import past clients from array to seed referral network
 * Body: { contacts: [{ name, email, company }] }
 * Returns import results with count of imported vs skipped
 */
router.post('/import-contacts', authMiddleware, async (req, res) => {
  try {
    const { contacts } = req.body;
    
    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({ 
        error: 'Body must include contacts array: [{ name, email, company }]' 
      });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: 'Contacts array cannot be empty' 
      });
    }

    // Validate each contact has required fields
    const invalidContacts = contacts.filter(c => !c.name || !c.email);
    if (invalidContacts.length > 0) {
      return res.status(400).json({ 
        error: 'All contacts must have name and email',
        invalid: invalidContacts.map(c => c.email || c.name)
      });
    }

    const result = await importContacts(contacts);
    
    res.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      clients: result.clients,
      errors: result.errors.length > 0 ? result.errors : undefined
    });
  } catch (error) {
    console.error('Error importing contacts:', error);
    res.status(500).json({ 
      error: 'Failed to import contacts',
      message: error.message 
    });
  }
});

export default router;