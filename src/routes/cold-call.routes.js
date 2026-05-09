/**
 * Cold Call Routes for ashbi-platform
 * 
 * Endpoints for phone lookup, lead management, call scheduling, and script generation
 */

import { lookupPhone, addLeadWithPhone, generateCallScript, scheduleCallBlock, runDailyCallBlocks, getScheduledCalls, verifyPhoneNumber, validateCallTime, scheduleFollowUpReminder, getCallLogs, getCallStats, getDNCList, addToDNC } from '../agents/cold-call.agent.js';

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
      const { leadId, dateTime, timezone = 'America/Toronto' } = request.body || {};

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

      // Timezone-aware validation: check business hours
      const timeValidation = validateCallTime(dateTime, timezone);
      if (!timeValidation.valid) {
        return reply.status(400).send({
          error: 'Invalid call time',
          message: timeValidation.reason,
          details: {
            localHour: timeValidation.localHour,
            localDay: timeValidation.localDay,
            timezone
          }
        });
      }

      console.log(`[ColdCall] Scheduling call for lead ${leadId} at ${dateTime} (${timezone}, hour ${timeValidation.localHour})`);

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

  /**
   * POST /cold-call/verify
   * Verify a phone number's format and validity
   *
   * Body: { phone: string }
   * Returns: { valid, cleaned, type, areaCode, formatted, reason }
   */
  fastify.post('/verify', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { phone } = request.body || {};
      if (!phone) {
        return reply.status(400).send({
          error: 'Phone number required',
          message: 'Please provide a phone number to verify'
        });
      }
      const result = verifyPhoneNumber(phone);
      return result;
    } catch (err) {
      fastify.log.error('[ColdCall] Verify error:', err);
      return reply.status(500).send({
        error: 'Phone verification failed',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/log
   * Log a call outcome
   *
   * Body: { callerName, callerNumber, callerCompany, callSummary, callNotes, status, calledAt }
   * Returns: Created CallLog entry
   */
  fastify.post('/log', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { callerName, callerNumber, callerCompany, callSummary, callNotes, status = 'COMPLETED', calledAt } = request.body || {};

      if (!callerName) {
        return reply.status(400).send({
          error: 'Caller name is required',
          message: 'Please provide the caller name'
        });
      }

      const log = await prisma.callLog.create({
        data: {
          callerName,
          callerNumber: callerNumber || null,
          callerCompany: callerCompany || null,
          callSummary: callSummary || null,
          callNotes: callNotes || null,
          status,
          calledAt: calledAt ? new Date(calledAt) : new Date()
        }
      });

      console.log(`[ColdCall] Call logged: ${callerName} (${log.id}) — ${status}`);

      return {
        success: true,
        callLog: log
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Log error:', err);
      return reply.status(500).send({
        error: 'Failed to log call',
        message: err.message
      });
    }
  });

  /**
   * GET /cold-call/logs
   * List call logs (most recent first)
   *
   * Query: ?limit=50
   * Returns: Array of CallLog entries
   */
  fastify.get('/logs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit) || 50;
      const logs = await getCallLogs(limit);
      return {
        count: logs.length,
        logs
      };
    } catch (err) {
      fastify.log.error('[ColdCall] Get logs error:', err);
      return reply.status(500).send({
        error: 'Failed to fetch call logs',
        message: err.message
      });
    }
  });

  /**
   * GET /cold-call/stats
   * Get call statistics: calls made, connect rate, meetings booked
   *
   * Returns: { totalCalls, completed, screened, pending, followUpSent, scheduledLeads, connectRate }
   */
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const stats = await getCallStats();
      return stats;
    } catch (err) {
      fastify.log.error('[ColdCall] Stats error:', err);
      return reply.status(500).send({
        error: 'Failed to fetch call stats',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/follow-up
   * Schedule a follow-up reminder after an initial call
   *
   * Body: { leadId: string, originalEventId?: string }
   * Returns: { success, eventId, followUpAt, leadId, businessName }
   */
  fastify.post('/follow-up', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { leadId, originalEventId } = request.body || {};

      if (!leadId) {
        return reply.status(400).send({
          error: 'Lead ID is required',
          message: 'Please provide a leadId for the follow-up'
        });
      }

      const result = await scheduleFollowUpReminder(leadId, originalEventId);

      return result;
    } catch (err) {
      fastify.log.error('[ColdCall] Follow-up error:', err);
      if (err.message.includes('not found')) {
        return reply.status(404).send({
          error: 'Lead not found',
          message: err.message
        });
      }
      return reply.status(500).send({
        error: 'Follow-up scheduling failed',
        message: err.message
      });
    }
  });

  /**
   * GET /cold-call/dnc
   * List the Do Not Call list
   *
   * Returns: Array of DNC entries { id, name, company, industry, phone, dncAt }
   */
  fastify.get('/dnc', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const dncs = await getDNCList();
      return {
        count: dncs.length,
        dnc: dncs
      };
    } catch (err) {
      fastify.log.error('[ColdCall] DNC list error:', err);
      return reply.status(500).send({
        error: 'Failed to fetch DNC list',
        message: err.message
      });
    }
  });

  /**
   * POST /cold-call/dnc
   * Add a lead to the Do Not Call list
   *
   * Body: { leadId: string }
   * Returns: { success, leadId, name, company }
   */
  fastify.post('/dnc', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { leadId } = request.body || {};

      if (!leadId) {
        return reply.status(400).send({
          error: 'Lead ID is required',
          message: 'Please provide a leadId to add to DNC'
        });
      }

      const result = await addToDNC(leadId);

      return result;
    } catch (err) {
      fastify.log.error('[ColdCall] DNC add error:', err);
      if (err.message.includes('not found')) {
        return reply.status(404).send({
          error: 'Lead not found',
          message: err.message
        });
      }
      return reply.status(500).send({
        error: 'Failed to add to DNC',
        message: err.message
      });
    }
  });

  /**
   * GET /cold-call/queue
   * List call queue — all leads with phone numbers grouped by area code
   *
   * Query: ?areaCode=416 (optional filter)
   * Returns: Array of leads in the call queue
   */
  fastify.get('/queue', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { areaCode } = request.query;
      const daily = await runDailyCallBlocks();

      // Flatten leadsByAreaCode, optionally filtered
      let allLeads = [];
      if (areaCode && daily.leadsByAreaCode[areaCode]) {
        allLeads = daily.leadsByAreaCode[areaCode].map(l => ({ ...l, areaCode }));
      } else if (!areaCode) {
        for (const [ac, leads] of Object.entries(daily.leadsByAreaCode)) {
          allLeads.push(...leads.map(l => ({ ...l, areaCode: ac })));
        }
      }

      // Enrich with DNC status
      const dncIds = new Set((await getDNCList()).map(d => d.id));
      allLeads = allLeads.map(l => ({ ...l, dnc: dncIds.has(l.id) }));

      return allLeads;
    } catch (err) {
      fastify.log.error('[ColdCall] Queue error:', err);
      return reply.status(500).send({
        error: 'Failed to fetch call queue',
        message: err.message
      });
    }
  });
}