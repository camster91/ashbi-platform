// Lead Gen Agent — Lead Generation + Outreach
// AI-powered prospecting and 5-step outreach sequence generator

import aiClient from '../ai/client.js';

export default async function leadGenRoutes(fastify) {
  const { prisma } = fastify;

  // POST /stan/find-leads — AI generates prospect list from ICP
  fastify.post('/find-leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { industry, targetType, location, count = 10, notes } = request.body || {};

    if (!industry && !targetType) {
      return reply.status(400).send({ error: 'industry or targetType is required' });
    }

    const system = `You are Ashbi Design's lead generation specialist. You identify ideal prospects for a Toronto-based CPG/DTC creative agency that specializes in branding, packaging design, and Shopify/WooCommerce web development. You generate realistic, actionable prospect lists with specific company names and contact roles.`;

    const prompt = `Generate a list of ${count} ideal prospects for Ashbi Design to reach out to.

Target profile:
- Industry: ${industry || 'CPG/DTC'}
- Type: ${targetType || 'brands needing web/brand design'}
- Location: ${location || 'North America'}
${notes ? `- Additional notes: ${notes}` : ''}

For each prospect, provide realistic details. Focus on:
- CPG brands, DTC startups, Shopify stores
- Companies showing signs they need branding/packaging/web help (outdated site, new product launch, rebrand)

Return JSON:
{
  "prospects": [
    {
      "name": "Decision maker name",
      "company": "Company name",
      "title": "Their role",
      "email": "realistic email guess (firstname@company.com)",
      "industry": "specific sub-industry",
      "linkedinUrl": null,
      "painPoint": "why they need Ashbi",
      "notes": "outreach angle"
    }
  ]
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });
      const prospects = result.prospects || [];

      // Save each prospect as an OutreachLead
      const saved = [];
      for (const p of prospects) {
        const lead = await prisma.outreachLead.create({
          data: {
            name: p.name,
            company: p.company || null,
            email: p.email,
            linkedinUrl: p.linkedinUrl || null,
            title: p.title || null,
            industry: p.industry || industry || null,
            status: 'NEW',
            source: 'AI_GENERATED',
            notes: [p.painPoint, p.notes].filter(Boolean).join(' | '),
          }
        });
        saved.push(lead);
      }

      return { generated: prospects.length, saved: saved.length, leads: saved };
    } catch (err) {
      fastify.log.error('Lead-gen find-leads error:', err);
      return reply.status(500).send({ error: 'Failed to generate leads', message: err.message });
    }
  });

  // POST /stan/sequence/:prospectId — generate full 5-step outreach sequence
  fastify.post('/sequence/:prospectId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospectId } = request.params;

    const lead = await prisma.outreachLead.findUnique({ where: { id: prospectId } });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const system = `You are Ashbi Design's outreach specialist. You write personalized, high-converting outreach sequences that feel human and authentic. Never sound generic or AI-generated. Each touch should add value and build on the previous one.`;

    const prompt = `Create a 5-step outreach sequence for Ashbi Design to contact ${lead.name} at ${lead.company || 'their company'}.

Prospect details:
- Name: ${lead.name}
- Title: ${lead.title || 'Brand decision-maker'}
- Company: ${lead.company || 'Unknown'}
- Industry: ${lead.industry || 'CPG/DTC'}
- Notes: ${lead.notes || 'None'}

Ashbi Design is a Toronto-based CPG/DTC creative agency specializing in branding, packaging design, and Shopify/WooCommerce development. Run by Cameron Ashley.

Create a mix of email and LinkedIn touches:

Return JSON:
{
  "sequence": [
    {
      "step": 1,
      "channel": "email",
      "delayDays": 0,
      "subject": "email subject",
      "body": "full message body"
    },
    {
      "step": 2,
      "channel": "linkedin",
      "delayDays": 2,
      "subject": "LinkedIn connection request",
      "body": "connection message (under 300 chars)"
    },
    {
      "step": 3,
      "channel": "email",
      "delayDays": 4,
      "subject": "follow-up subject",
      "body": "follow-up email"
    },
    {
      "step": 4,
      "channel": "linkedin",
      "delayDays": 7,
      "subject": "LinkedIn follow-up",
      "body": "LinkedIn message"
    },
    {
      "step": 5,
      "channel": "email",
      "delayDays": 10,
      "subject": "breakup email subject",
      "body": "final breakup email"
    }
  ]
}

Keep emails under 100 words each. LinkedIn messages under 300 characters. Sign off as Cameron Ashley.`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });

      // Save as an OutreachSequence linked to the lead
      const sequence = await prisma.outreachSequence.create({
        data: {
          name: `Sequence for ${lead.name} @ ${lead.company || 'Unknown'}`,
          steps: JSON.stringify(result.sequence || []),
          status: 'ACTIVE',
          targetIndustry: lead.industry || null,
          filters: JSON.stringify({ prospectId: lead.id }),
        }
      });

      // Link lead to sequence
      await prisma.outreachLead.update({
        where: { id: lead.id },
        data: { sequenceId: sequence.id }
      });

      return { sequence, steps: result.sequence, lead };
    } catch (err) {
      fastify.log.error('Lead-gen sequence error:', err);
      return reply.status(500).send({ error: 'Failed to generate sequence', message: err.message });
    }
  });

  // GET /stan/pipeline — leads with status (pipeline view)
  fastify.get('/pipeline', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const leads = await prisma.outreachLead.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        sequence: {
          select: { id: true, name: true, status: true }
        }
      }
    });

    // Group by status for kanban
    const pipeline = {
      NEW: leads.filter(l => l.status === 'NEW'),
      CONTACTED: leads.filter(l => l.status === 'CONTACTED'),
      REPLIED: leads.filter(l => l.status === 'REPLIED'),
      MEETING: leads.filter(l => l.status === 'CONVERTED'),
      DEAD: leads.filter(l => l.status === 'DEAD'),
    };

    return { pipeline, total: leads.length };
  });

  // PUT /stan/status/:id — update lead status
  fastify.put('/status/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, notes } = request.body || {};

    if (!status) return reply.status(400).send({ error: 'status is required' });

    const data = { status, updatedAt: new Date() };
    if (notes !== undefined) data.notes = notes;
    if (status === 'CONTACTED') data.lastContactedAt = new Date();

    const lead = await prisma.outreachLead.update({
      where: { id },
      data
    });

    return lead;
  });
}
