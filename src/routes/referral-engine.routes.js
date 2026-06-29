/**
 * Referral Engine Routes for ashbi-platform
 * API endpoints for referral network, tracking, and stats
 * Uses Fastify plugin pattern for route registration
 */

import {
  getReferralNetwork,
  generateReferralEmail,
  createDraftForReferral,
  trackReferral,
  getTopReferrers,
  importContacts,
  REFERRAL_REWARD,
  sanitizeEmailHeader
} from '../agents/referral-engine.agent.js';

/**
 * Simple auth preHandler - checks for Authorization header.
 * In production, the API key MUST be set via REFERRAL_ENGINE_API_KEY.
 * The previous `|| 'dev-key'` fallback was a C3 vulnerability — anyone with
 * knowledge of the codebase could authenticate with `Bearer dev-key`.
 */
async function authPreHandler(request, reply) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  // Simple API key check - in production use proper auth
  const apiKey = authHeader.replace('Bearer ', '');
  const validKey = process.env.REFERRAL_ENGINE_API_KEY;

  if (!validKey) {
    request.log?.error?.('REFERRAL_ENGINE_API_KEY not configured');
    return reply.status(503).send({ error: 'Service not configured' });
  }

  if (apiKey !== validKey) {
    return reply.status(403).send({ error: 'Invalid API key' });
  }
}

/**
 * Referral Engine Routes - Fastify plugin
 */
export default async function referralEngineRoutes(fastify) {
  /**
   * GET /referral-engine/network
   * Get full referral network categorized by tiers
   * Returns clients organized by referral likelihood (Tier 1-3)
   */
  fastify.get('/network', { preHandler: [authPreHandler] }, async (request, reply) => {
    try {
      const network = await getReferralNetwork();
      return network;
    } catch (error) {
      request.log.error({ err: error }, 'Error getting referral network');
      return reply.status(500).send({ 
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
  fastify.post('/refer', { preHandler: [authPreHandler] }, async (request, reply) => {
    try {
      const { contactName, company, email } = request.body;

      if (!contactName || !company || !email) {
        return reply.status(400).send({ 
          error: 'Missing required fields: contactName, company, email' 
        });
      }

      // Generate referral email using AI
      const emailContent = await generateReferralEmail(contactName, company);
      
      // Create Gmail draft (subject is sanitized inside createDraftForReferral)
      const draftResult = await createDraftForReferral(email, emailContent.subject, emailContent.body);

      return {
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
      };
    } catch (error) {
      request.log.error({ err: error }, 'Error triggering referral');
      return reply.status(500).send({ 
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
  fastify.post('/track', { preHandler: [authPreHandler] }, async (request, reply) => {
    try {
      const { referrerId, referredLead } = request.body;

      if (!referrerId || !referredLead) {
        return reply.status(400).send({ 
          error: 'Missing required fields: referrerId, referredLead' 
        });
      }

      if (!referredLead.name || !referredLead.email) {
        return reply.status(400).send({ 
          error: 'referredLead must include name and email' 
        });
      }

      const result = await trackReferral(referrerId, referredLead);

      return {
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
      };
    } catch (error) {
      request.log.error({ err: error }, 'Error tracking referral');
      return reply.status(500).send({ 
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
  fastify.get('/stats', { preHandler: [authPreHandler] }, async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit) || 10;
      const topReferrersResult = await getTopReferrers(limit);

      return {
        stats: topReferrersResult.summary,
        topReferrers: topReferrersResult.referrers,
        topReferrersSummary: topReferrersResult.summary,
        rewardConfig: {
          amount: REFERRAL_REWARD.AMOUNT,
          minProjectValue: REFERRAL_REWARD.MIN_PROJECT_VALUE,
          maxProjectValue: REFERRAL_REWARD.MAX_PROJECT_VALUE,
          paymentCondition: REFERRAL_REWARD.PAYMENT_CONDITION
        },
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      request.log.error({ err: error }, 'Error getting referral stats');
      return reply.status(500).send({ 
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
  fastify.post('/import-contacts', { preHandler: [authPreHandler] }, async (request, reply) => {
    try {
      const { contacts } = request.body;

      if (!contacts || !Array.isArray(contacts)) {
        return reply.status(400).send({ 
          error: 'Body must include contacts array: [{ name, email, company }]' 
        });
      }

      if (contacts.length === 0) {
        return reply.status(400).send({ 
          error: 'Contacts array cannot be empty' 
        });
      }

      // Validate each contact has required fields
      const invalidContacts = contacts.filter(c => !c.name || !c.email);
      if (invalidContacts.length > 0) {
        return reply.status(400).send({ 
          error: 'All contacts must have name and email',
          invalid: invalidContacts.map(c => c.email || c.name)
        });
      }

      const result = await importContacts(contacts);

      return {
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        clients: result.clients,
        errors: result.errors.length > 0 ? result.errors : undefined
      };
    } catch (error) {
      request.log.error({ err: error }, 'Error importing contacts');
      return reply.status(500).send({ 
        error: 'Failed to import contacts',
        message: error.message 
      });
    }
  });
}
