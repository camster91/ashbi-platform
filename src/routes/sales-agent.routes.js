// Sales Agent Routes — Upwork feed, proposals, qualified leads

import { getProvider } from '../ai/providers/index.js';

export default async function salesAgentRoutes(fastify) {
  // GET /api/sales/upwork/feed — Upwork job feed with scoring
  fastify.get('/upwork/feed', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      // Pull recent leads from UnmatchedEmail or any stored Upwork data
      const recentLeads = await fastify.prisma.unmatchedEmail.findMany({
        where: {
          OR: [
            { source: { contains: 'upwork' } },
            { senderEmail: { contains: 'upwork' } }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }).catch(() => []);

      // Also fetch any leads tagged as Upwork
      const leads = await fastify.prisma.lead.findMany({
        where: { source: 'UPWORK' },
        orderBy: { createdAt: 'desc' },
        take: 20
      }).catch(() => []);

      const feed = [
        ...recentLeads.map(l => ({
          id: l.id,
          type: 'email_lead',
          title: l.subject,
          client: l.senderName,
          budget: null,
          score: 'unscored',
          receivedAt: l.createdAt
        })),
        ...leads.map(l => ({
          id: l.id,
          type: 'lead',
          title: l.title || l.company,
          client: l.name,
          budget: null,
          score: l.score || 'unscored',
          receivedAt: l.createdAt
        }))
      ].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

      return {
        jobs: feed,
        total: feed.length,
        timestamp: new Date().toISOString(),
        tip: 'Connect Upwork MCP to pull live job feed'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch Upwork feed', details: err.message });
    }
  });

  // POST /api/sales/proposal/generate — draft a proposal using AI
  fastify.post('/proposal/generate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { clientName, projectType, budget, requirements, tone = 'professional' } = request.body || {};

    if (!clientName || !projectType) {
      return reply.status(400).send({ error: 'clientName and projectType are required' });
    }

    try {
      const ai = getProvider();
      const prompt = `You are writing a proposal for Ashbi Design, a Toronto CPG/DTC branding agency.

Client: ${clientName}
Project Type: ${projectType}
Budget: ${budget || 'TBD'}
Requirements: ${requirements || 'Standard agency engagement'}
Tone: ${tone}

Write a concise, compelling proposal with:
1. Executive Summary (2-3 sentences)
2. Scope of Work (bullet points)
3. Our Approach (2-3 sentences)
4. Investment / Pricing tier suggestion
5. Timeline
6. Next Steps

Ashbi's retainer tiers: $999/mo (Starter), $1,999/mo (Growth), $3,999/mo (Scale).`;

      const proposalText = await ai.generate(prompt, { maxTokens: 1500 });

      return {
        proposal: proposalText,
        metadata: {
          clientName,
          projectType,
          budget,
          generatedAt: new Date().toISOString(),
          model: 'ai'
        },
        tip: 'Review and save to /api/proposals to track in Hub'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate proposal', details: err.message });
    }
  });

  // GET /api/sales/leads — recent qualified leads
  fastify.get('/leads', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status, limit = 20 } = request.query;

    try {
      const leads = await fastify.prisma.lead.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit)
      }).catch(() => []);

      // Also pull unmatched emails as potential leads
      const emailLeads = await fastify.prisma.unmatchedEmail.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit)
      }).catch(() => []);

      return {
        leads: leads.map(l => ({
          id: l.id,
          name: l.name,
          company: l.company,
          source: l.source,
          status: l.status,
          score: l.score,
          estimatedValue: l.estimatedValue,
          createdAt: l.createdAt
        })),
        emailLeads: emailLeads.map(e => ({
          id: e.id,
          name: e.senderName,
          email: e.senderEmail,
          subject: e.subject,
          status: e.status,
          source: 'email',
          createdAt: e.createdAt
        })),
        totalLeads: leads.length,
        totalEmailLeads: emailLeads.length,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch leads', details: err.message });
    }
  });
}
