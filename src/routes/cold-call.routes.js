/**
 * Cold Call Routes for ashbi-platform
 * 
 * Endpoints for phone lookup, lead management, call scheduling, and script generation
 */

import { lookupPhone, addLeadWithPhone, generateCallScript, scheduleCallBlock, runDailyCallBlocks, getScheduledCalls } from '../agents/cold-call.agent.js';

export default async function coldCallRoutes(fastify) {
  const { prisma } = fastify;

  /**
   * POST /cold-call/lookup
   * Lookup phone number for a business
   * 
   * Body: { name: string, city: string (optional, defaults to Toronto) }
   * Returns: { name, phone, address, gmb_url }
   */
  fastify.post('/lookup', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { name, city = 'Toronto' } = request.body || {};

      if (!name) {
        return reply.status(400).send({
          error: 'Business name is required',
          message: 'Please provide a business name to lookup'
        });
      }

      console.log(`[ColdCall] Looking up phone for: ${name} in ${city}`);

      const result = await lookupPhone(name, city);

      if (!result || !result.phone) {
        return {
          found: false,
          message: `Could not find phone number for "${name}" in ${city}`,
          name,
          city
        };
      }

      return {
        found: true,
        name: result.name,
        phone: result.phone,
        address: result.address,
        gmb_url: result.gmb_url,
        website: result.website
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Lookup error:', err);
      return reply.status(500).send({
        error: 'Phone lookup failed',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/add-lead
   * Add a lead with phone number
   * 
   * Body: { name, email, company, phone, notes, address, gmb_url, businessType }
   * Returns: Created ColdEmailProspect
   */
  fastify.post('/add-lead', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { name, email, company, phone, notes, address, gmb_url, businessType } = request.body || {};

      if (!name && !company) {
        return reply.status(400).send({
          error: 'Name or company is required',
          message: 'Please provide at least a name or company for the lead'
        });
      }

      const leadData = {
        name: name || company,
        email: email || '',
        company: company || name || '',
        phone,
        address,
        gmb_url,
        notes,
        businessType
      };

      const prospect = await addLeadWithPhone(leadData);

      console.log(`[ColdCall] Added lead: ${prospect.company} (${prospect.id})`);

      return {
        success: true,
        lead: {
          id: prospect.id,
          name: prospect.name,
          email: prospect.email,
          company: prospect.company,
          industry: prospect.industry,
          status: prospect.status,
          createdAt: prospect.createdAt
        }
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Add lead error:', err);
      return reply.status(500).send({
        error: 'Failed to add lead',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/generate-script
   * Generate a cold call script for a lead
   * 
   * Body: { leadId: string } OR { name, company, phone, website, businessType }
   * Returns: { script }
   */
  fastify.post('/generate-script', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { leadId, name, company, phone, website, businessType, painPoints } = request.body || {};

      let leadData = {};

      if (leadId) {
        // Fetch lead from database
        const prospect = await prisma.coldEmailProspect.findUnique({
          where: { id: leadId }
        });

        if (!prospect) {
          return reply.status(404).send({
            error: 'Lead not found',
            message: `No lead found with ID: ${leadId}`
          });
        }

        // Parse phone data from painPoint
        let phoneData = {};
        try {
          if (prospect.painPoint) {
            phoneData = JSON.parse(prospect.painPoint);
          }
        } catch (e) {
          // Not JSON
        }

        leadData = {
          name: prospect.name,
          company: prospect.company,
          phone: phoneData.phone || phone,
          website: phoneData.website,
          businessType: prospect.industry,
          painPoints
        };
      } else {
        // Use provided data
        leadData = { name, company, phone, website, businessType, painPoints };
      }

      if (!leadData.company && !leadData.name) {
        return reply.status(400).send({
          error: 'Lead data required',
          message: 'Please provide leadId or lead data (name, company)'
        });
      }

      const script = await generateCallScript(leadData);

      // Update lead with script if we have a leadId
      if (leadId) {
        try {
          const prospect = await prisma.coldEmailProspect.findUnique({ where: { id: leadId } });
          if (prospect && prospect.painPoint) {
            let phoneData = JSON.parse(prospect.painPoint);
            phoneData.callScript = script;
            await prisma.coldEmailProspect.update({
              where: { id: leadId },
              data: { painPoint: JSON.stringify(phoneData) }
            });
          }
        } catch (e) {
          console.warn('[ColdCall] Could not update lead with script:', e.message);
        }
      }

      return {
        success: true,
        script,
        leadId: leadId || null
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Generate script error:', err);
      return reply.status(500).send({
        error: 'Script generation failed',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/schedule
   * Schedule a call block for a lead
   * 
   * Body: { leadId: string, dateTime: string (ISO format) }
   * Returns: { success, eventId, scheduledAt, script }
   */
  fastify.post('/schedule', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { leadId, dateTime } = request.body || {};

      if (!leadId) {
        return reply.status(400).send({
          error: 'Lead ID is required',
          message: 'Please provide a leadId to schedule'
        });
      }

      if (!dateTime) {
        return reply.status(400).send({
          error: 'Date/time is required',
          message: 'Please provide a dateTime (ISO format) for the call'
        });
      }

      // Validate the dateTime
      const scheduleDate = new Date(dateTime);
      if (isNaN(scheduleDate.getTime())) {
        return reply.status(400).send({
          error: 'Invalid date/time',
          message: 'dateTime must be a valid ISO date string'
        });
      }

      console.log(`[ColdCall] Scheduling call for lead ${leadId} at ${dateTime}`);

      const result = await scheduleCallBlock(leadId, dateTime);

      return {
        success: true,
        eventId: result.eventId,
        scheduledAt: result.scheduledAt,
        leadId: result.leadId,
        businessName: result.businessName,
        script: result.script
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Schedule error:', err);
      
      if (err.message.includes('not found')) {
        return reply.status(404).send({
          error: 'Lead not found',
          message: err.message
        });
      }

      return reply.status(500).send({
        error: 'Scheduling failed',
        message: err.message
      });
    }
  });

  /**
   * GET /cold-call/scheduled
   * List all upcoming scheduled calls
   * 
   * Returns: Array of scheduled calls sorted by time
   */
  fastify.get('/scheduled', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const scheduled = await getScheduledCalls();

      return {
        count: scheduled.length,
        calls: scheduled
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Get scheduled error:', err);
      return reply.status(500).send({
        error: 'Failed to fetch scheduled calls',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/run-daily
   * Run daily call block batching - groups leads by area code
   * 
   * Returns: Summary of callable leads grouped by area code
   */
  fastify.post('/run-daily', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const result = await runDailyCallBlocks();

      console.log(`[ColdCall] Daily run found ${result.totalLeadsWithPhone} callable leads across ${result.groupedByAreaCode} area codes`);

      return {
        success: true,
        ...result
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Run daily error:', err);
      return reply.status(500).send({
        error: 'Daily run failed',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/lookup-and-add
   * Convenience endpoint: lookup phone and add as lead in one call
   * 
   * Body: { name, city, email, notes }
   * Returns: Created lead with phone info
   */
  fastify.post('/lookup-and-add', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { name, city = 'Toronto', email, notes } = request.body || {};

      if (!name) {
        return reply.status(400).send({
          error: 'Business name is required',
          message: 'Please provide a business name'
        });
      }

      // Step 1: Lookup phone
      const lookupResult = await lookupPhone(name, city);

      // Step 2: Add lead with phone data
      const leadData = {
        name,
        email: email || '',
        company: name,
        phone: lookupResult?.phone || null,
        address: lookupResult?.address || null,
        gmb_url: lookupResult?.gmb_url || null
      };

      const prospect = await addLeadWithPhone(leadData);

      return {
        success: true,
        lead: {
          id: prospect.id,
          name: prospect.name,
          company: prospect.company,
          phone: lookupResult?.phone,
          address: lookupResult?.address,
          gmb_url: lookupResult?.gmb_url,
          found: !!lookupResult?.phone
        }
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Lookup-and-add error:', err);
      return reply.status(500).send({
        error: 'Lookup and add failed',
        message: err.message
      });
    }
  });
}