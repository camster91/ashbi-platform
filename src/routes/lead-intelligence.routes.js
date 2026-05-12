/**
 * Lead Intelligence Routes for ashbi-platform
 * 
 * Endpoints for managing lead intelligence scans and viewing discovered leads
 */

import {
  runDailyIntelligence,
  scrapeProductHunt,
  scrapeKickstarter,
  scrapeShopifyNewStores,
  scrapeDomainRegs,
  scrapeCrunchbase,
  scrapeClutch,
  scrapeG2,
  scrapeBuiltIn,
  scrapeYCCombinator,
  enrichLead,
  scoreLead
} from '../agents/lead-intelligence.agent.js';

export default async function leadIntelligenceRoutes(fastify) {
  const { prisma } = fastify;

  /**
   * POST /lead-intelligence/run
   * Manually trigger a full intelligence scan (auth required)
   */
  fastify.post('/run', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      console.log('[LeadIntelligence] Manual scan triggered by user:', request.user?.id);
      
      const results = await runDailyIntelligence();
      
      return {
        success: true,
        message: 'Intelligence scan completed',
        results: {
          discovered: results.totalDiscovered,
          added: results.totalAdded,
          sources: Object.keys(results.sources || {}),
          duration: results.duration,
          errors: results.errors?.length > 0 ? results.errors : undefined
        }
      };
    } catch (err) {
      fastify.log.error('Lead intelligence scan error:', err);
      return reply.status(500).send({ 
        error: 'Intelligence scan failed', 
        message: err.message 
      });
    }
  });

  /**
   * GET /lead-intelligence/leads
   * List recently discovered leads with source and discovery date
   * 
   * Query params:
   * - source: filter by source (producthunt, kickstarter, shopify, domain_registration, crunchbase, clutch, g2, builtin, ycombinator)
   * - minScore: minimum quality score (0-10)
   * - limit: max results (default 50)
   * - offset: pagination offset
   */
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { source, minScore, limit = '50', offset = '0' } = request.query || {};
      
      // Get prospects that came from lead intelligence
      // These are identified by their painPoint containing source info or recent creation
      const prospects = await prisma.coldEmailProspect.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Last 90 days
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      });

      // Parse source from painPoint if available
      const leads = prospects.map(p => {
        let leadSource = 'unknown';
        let discoveredAt = p.createdAt;
        
        // Try to extract source from painPoint
        if (p.painPoint) {
          const sourceMatch = p.painPoint.match(/Source:\s*(\w+)/);
          if (sourceMatch) {
            leadSource = sourceMatch[1];
          }
        }
        
        const lead = {
          id: p.id,
          name: p.name,
          email: p.email,
          company: p.company,
          industry: p.industry,
          status: p.status,
          source: leadSource,
          discoveredAt: discoveredAt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        };

        // Compute quality score
        lead.score = scoreLead(lead);
        
        return lead;
      });

      // Filter by source if specified
      let filteredLeads = source 
        ? leads.filter(l => l.source === source)
        : leads;

      // Filter by minimum score if specified
      if (minScore !== undefined) {
        const min = parseFloat(minScore);
        if (!isNaN(min)) {
          filteredLeads = filteredLeads.filter(l => (l.score || 0) >= min);
        }
      }

      return {
        leads: filteredLeads,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: filteredLeads.length
        }
      };
    } catch (err) {
      fastify.log.error('Get leads error:', err);
      return reply.status(500).send({ 
        error: 'Failed to fetch leads', 
        message: err.message 
      });
    }
  });

  /**
   * POST /lead-intelligence/scrape/:source
   * Scrape a specific source
   * 
   * Params: source = producthunt | kickstarter | shopify | domain_registration | crunchbase | clutch | g2 | builtin | ycombinator
   * Body (optional): { category: string, query: string }
   */
  fastify.post('/scrape/:source', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { source } = request.params;
      const { category, query } = request.body || {};

      let results = [];

      switch (source) {
        case 'producthunt':
          results = await scrapeProductHunt(category || 'food-and-drink');
          break;

        case 'kickstarter':
          results = await scrapeKickstarter(category || 'product design');
          break;

        case 'shopify':
          results = await scrapeShopifyNewStores(query || 'new supplement brand');
          break;

        case 'domain_registration':
          results = await scrapeDomainRegs(
            category ? [category] : ['supplement', 'skincare', 'food', 'beverage']
          );
          break;

        case 'crunchbase':
          results = await scrapeCrunchbase(category || 'consumer-goods');
          break;

        case 'clutch':
          results = await scrapeClutch(category || 'digital-marketing');
          break;

        case 'g2':
          results = await scrapeG2(category || 'ecommerce-platforms');
          break;

        case 'builtin':
          results = await scrapeBuiltIn(category || 'consumer-goods');
          break;

        case 'ycombinator':
          results = await scrapeYCCombinator();
          break;

        default:
          return reply.status(400).send({ 
            error: 'Invalid source', 
            message: `Source must be one of: producthunt, kickstarter, shopify, domain_registration, crunchbase, clutch, g2, builtin, ycombinator` 
          });
      }

      // Score and enrich results
      const scoredLeads = results.map(lead => ({
        ...lead,
        score: scoreLead(lead)
      }));

      return {
        source,
        scraped: scoredLeads.length,
        leads: scoredLeads
      };
    } catch (err) {
      fastify.log.error(`Scrape ${request.params.source} error:`, err);
      return reply.status(500).send({ 
        error: 'Scrape failed', 
        message: err.message 
      });
    }
  });

  /**
   * POST /lead-intelligence/enrich
   * Enrich a lead with contact details, social accounts, and technology stack
   * 
   * Body: { domain: string } or { leadId: string }
   */
  fastify.post('/enrich', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { domain, leadId } = request.body || {};
      let targetDomain = domain;

      // If leadId provided, look up the domain
      if (!targetDomain && leadId) {
        const prospect = await prisma.coldEmailProspect.findUnique({
          where: { id: parseInt(leadId) }
        });
        if (!prospect) {
          return reply.status(404).send({ error: 'Lead not found' });
        }
        targetDomain = prospect.company;
      }

      if (!targetDomain) {
        return reply.status(400).send({ error: 'domain or leadId required' });
      }

      const enriched = await enrichLead(targetDomain);

      // If we have a leadId, update the prospect with enriched data
      if (leadId) {
        await prisma.coldEmailProspect.update({
          where: { id: parseInt(leadId) },
          data: {
            painPoint: enriched.description || undefined,
            updatedAt: new Date()
          }
        });
      }

      return {
        success: true,
        domain: targetDomain,
        enriched
      };
    } catch (err) {
      fastify.log.error('Enrich lead error:', err);
      return reply.status(500).send({ 
        error: 'Enrichment failed', 
        message: err.message 
      });
    }
  });

  /**
   * GET /lead-intelligence/stats
   * Get lead intelligence statistics
   * 
   * Returns: total discovered, by source, conversion rate
   */
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      // Get all prospects from the last 90 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const recentProspects = await prisma.coldEmailProspect.findMany({
        where: {
          createdAt: { gte: ninetyDaysAgo }
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          painPoint: true
        }
      });

      // Parse source from painPoint
      const leadsBySource = {
        producthunt: 0,
        kickstarter: 0,
        shopify: 0,
        domain_registration: 0,
        crunchbase: 0,
        clutch: 0,
        g2: 0,
        builtin: 0,
        ycombinator: 0,
        unknown: 0
      };

      for (const p of recentProspects) {
        if (p.painPoint) {
          const sourceMatch = p.painPoint.match(/Source:\s*(\w+)/);
          if (sourceMatch && leadsBySource.hasOwnProperty(sourceMatch[1])) {
            leadsBySource[sourceMatch[1]]++;
          } else {
            leadsBySource.unknown++;
          }
        } else {
          leadsBySource.unknown++;
        }
      }

      // Calculate conversion rates
      const totalLeads = recentProspects.length;
      const contacted = recentProspects.filter(p => p.status !== 'NEW').length;
      const converted = recentProspects.filter(p => 
        ['REPLIED', 'CONVERTED'].includes(p.status)
      ).length;

      const stats = {
        period: '90_days',
        totalDiscovered: totalLeads,
        bySource: leadsBySource,
        conversion: {
          contacted: contacted,
          contactedRate: totalLeads > 0 ? Math.round((contacted / totalLeads) * 100) : 0,
          converted: converted,
          convertedRate: totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0
        },
        recentActivity: {
          last7Days: recentProspects.filter(p => p.createdAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
          last30Days: recentProspects.filter(p => p.createdAt >= thirtyDaysAgo).length
        },
        generatedAt: new Date().toISOString()
      };

      return stats;
    } catch (err) {
      fastify.log.error('Lead intelligence stats error:', err);
      return reply.status(500).send({ 
        error: 'Failed to fetch stats', 
        message: err.message 
      });
    }
  });

  /**
   * GET /lead-intelligence/sources
   * Get list of available sources and their status
   */
  fastify.get('/sources', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    return {
      sources: [
        {
          id: 'producthunt',
          name: 'Product Hunt',
          description: 'Trending CPG/DTC products',
          categories: ['food-and-drink', 'health', 'beauty', 'products'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'kickstarter',
          name: 'Kickstarter',
          description: 'Live product campaigns',
          categories: ['product design', 'technology', 'food', 'fashion'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'shopify',
          name: 'Shopify Stores',
          description: 'Newly launched Shopify stores',
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'domain_registration',
          name: 'Domain Registrations',
          description: 'Newly registered CPG domains',
          keywords: ['supplement', 'skincare', 'food', 'beverage', 'nutrition'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'crunchbase',
          name: 'Crunchbase',
          description: 'Company funding and growth data',
          categories: ['consumer-goods'],
          status: 'active',
          type: 'data',
          requiresApiKey: true
        },
        {
          id: 'clutch',
          name: 'Clutch',
          description: 'B2B service provider reviews and ratings',
          categories: ['digital-marketing'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'g2',
          name: 'G2',
          description: 'Software and service reviews',
          categories: ['ecommerce-platforms'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'builtin',
          name: 'BuiltIn',
          description: 'Tech company profiles and job listings',
          categories: ['consumer-goods'],
          status: 'active',
          type: 'scraper'
        },
        {
          id: 'ycombinator',
          name: 'Y Combinator',
          description: 'YC-backed startup directory (Work at a Startup)',
          categories: ['Consumer'],
          status: 'active',
          type: 'data'
        }
      ]
    };
  });

  /**
   * GET /lead-intelligence/source-health
   * Get health status of all scrapers (last run, success rate, errors)
   */
  fastify.get('/source-health', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      // Get the most recent prospects per source to determine last activity
      const recentProspects = await prisma.coldEmailProspect.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          painPoint: true,
          createdAt: true
        }
      });

      // Build source health from prospect data
      const sourceMap = {
        producthunt: { name: 'Product Hunt', lastRun: null, leads30d: 0 },
        kickstarter: { name: 'Kickstarter', lastRun: null, leads30d: 0 },
        shopify: { name: 'Shopify Stores', lastRun: null, leads30d: 0 },
        domain_registration: { name: 'Domain Registrations', lastRun: null, leads30d: 0 },
        crunchbase: { name: 'Crunchbase', lastRun: null, leads30d: 0 },
        clutch: { name: 'Clutch', lastRun: null, leads30d: 0 },
        g2: { name: 'G2', lastRun: null, leads30d: 0 },
        builtin: { name: 'BuiltIn', lastRun: null, leads30d: 0 },
        ycombinator: { name: 'Y Combinator', lastRun: null, leads30d: 0 }
      };

      for (const p of recentProspects) {
        if (p.painPoint) {
          const sourceMatch = p.painPoint.match(/Source:\s*(\w+)/);
          if (sourceMatch && sourceMap[sourceMatch[1]]) {
            const src = sourceMap[sourceMatch[1]];
            src.leads30d++;
            if (!src.lastRun || p.createdAt > new Date(src.lastRun)) {
              src.lastRun = p.createdAt.toISOString();
            }
          }
        }
      }

      const health = Object.entries(sourceMap).map(([id, data]) => ({
        id,
        name: data.name,
        lastRun: data.lastRun,
        leads30d: data.leads30d,
        status: data.leads30d > 0 ? 'healthy' : 'no-data',
        healthy: data.lastRun != null
      }));

      return { sources: health, generatedAt: new Date().toISOString() };
    } catch (err) {
      fastify.log.error('Source health error:', err);
      return reply.status(500).send({ 
        error: 'Failed to fetch source health', 
        message: err.message 
      });
    }
  });
}
