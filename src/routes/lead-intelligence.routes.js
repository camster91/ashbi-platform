/**
 * Lead Intelligence Routes for ashbi-platform
 * 
 * Endpoints for managing lead intelligence scans and viewing discovered leads
 */

import { runDailyIntelligence, scrapeProductHunt, scrapeKickstarter, scrapeShopifyNewStores, scrapeDomainRegs } from '../agents/lead-intelligence.agent.js';

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
   * - source: filter by source (producthunt, kickstarter, shopify, domain_registration)
   * - limit: max results (default 50)
   * - offset: pagination offset
   */
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { source, limit = '50', offset = '0' } = request.query || {};
      
      // Get prospects that came from lead intelligence
      // These are identified by their painPoint containing source info or recent creation
      const prospects = await prisma.coldEmailProspect.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      });

      // Parse source from painPoint if available
      const leads = prospects.map(p => {
        let source = 'unknown';
        let discoveredAt = p.createdAt;
        
        // Try to extract source from painPoint
        if (p.painPoint) {
          const sourceMatch = p.painPoint.match(/Source:\s*(\w+)/);
          if (sourceMatch) {
            source = sourceMatch[1];
          }
        }
        
        return {
          id: p.id,
          name: p.name,
          email: p.email,
          company: p.company,
          industry: p.industry,
          status: p.status,
          source: source,
          discoveredAt: discoveredAt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        };
      });

      // Filter by source if specified
      const filteredLeads = source 
        ? leads.filter(l => l.source === source)
        : leads;

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
   * Params: source = producthunt | kickstarter | shopify | domain_registration
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

        default:
          return reply.status(400).send({ 
            error: 'Invalid source', 
            message: `Source must be one of: producthunt, kickstarter, shopify, domain_registration` 
          });
      }

      return {
        source,
        scraped: results.length,
        leads: results
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
          status: 'active'
        },
        {
          id: 'kickstarter',
          name: 'Kickstarter',
          description: 'Live product campaigns',
          categories: ['product design', 'technology', 'food', 'fashion'],
          status: 'active'
        },
        {
          id: 'shopify',
          name: 'Shopify Stores',
          description: 'Newly launched Shopify stores',
          status: 'active'
        },
        {
          id: 'domain_registration',
          name: 'Domain Registrations',
          description: 'Newly registered CPG domains',
          keywords: ['supplement', 'skincare', 'food', 'beverage', 'nutrition'],
          status: 'active'
        }
      ]
    };
  });
}