// Cold Email Agent routes

import aiClient from '../ai/client.js';

export default async function coldEmailRoutes(fastify) {
  const { prisma } = fastify;

  // POST /cold-email/sequence — generate cold email sequence (5 emails)
  fastify.post('/sequence', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, serviceType = 'full_service', targetIndustry, companyName, painPoint } = request.body || {};

    if (!name) return reply.status(400).send({ error: 'name is required' });

    const serviceDescriptions = {
      web_design: 'high-converting Shopify/ecommerce websites for DTC brands',
      branding: 'brand identity, packaging design, and visual systems for CPG/DTC brands',
      seo: 'SEO and content marketing for ecommerce and DTC brands',
      full_service: 'full-service creative agency: branding, packaging, web design, and digital marketing for CPG/DTC brands'
    };

    const service = serviceDescriptions[serviceType] || serviceDescriptions.full_service;

    const system = `You are a cold email copywriter for Ashbi Design, a Toronto-based CPG/DTC creative agency. Write sequences that are personal, value-driven, and non-pushy. Each email should be under 100 words. The sender is Cameron Ashley, founder.`;

    const prompt = `Create a 5-email cold outreach sequence for Ashbi Design.

Campaign: ${name}
Service: ${service}
Target industry: ${targetIndustry || 'CPG/DTC brands'}
${companyName ? `Example company: ${companyName}` : ''}
${painPoint ? `Key pain point: ${painPoint}` : ''}

Return JSON:
{
  "emails": [
    { "subject": "...", "body": "...", "delayDays": 0, "purpose": "initial outreach" },
    { "subject": "...", "body": "...", "delayDays": 3, "purpose": "value-add follow-up" },
    { "subject": "...", "body": "...", "delayDays": 7, "purpose": "case study/social proof" },
    { "subject": "...", "body": "...", "delayDays": 14, "purpose": "pain point reminder" },
    { "subject": "...", "body": "...", "delayDays": 21, "purpose": "breakup/final follow-up" }
  ]
}

Email 1: Lead with observation about their brand, one line of value. Email 2: Share a relevant tip or insight. Email 3: Brief case study result. Email 4: Address common pain point. Email 5: Breakup email ("no hard feelings"). Use {{company}} and {{name}} placeholders for personalization.`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });

      const sequence = await prisma.coldEmailSequence.create({
        data: {
          name,
          serviceType,
          emails: JSON.stringify(result.emails || []),
          status: 'DRAFT',
          targetIndustry: targetIndustry || null
        }
      });

      return { ...sequence, emails: result.emails };
    } catch (err) {
      fastify.log.error('Cold email sequence generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate sequence', message: err.message });
    }
  });

  // POST /cold-email/prospects — bulk import prospects
  fastify.post('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospects, sequenceId } = request.body || {};

    if (!Array.isArray(prospects) || prospects.length === 0) {
      return reply.status(400).send({ error: 'prospects array is required' });
    }

    const created = [];
    for (const p of prospects) {
      if (!p.name || !p.email) continue;
      const prospect = await prisma.coldEmailProspect.create({
        data: {
          name: p.name,
          email: p.email,
          company: p.company || null,
          industry: p.industry || null,
          painPoint: p.painPoint || null,
          status: 'NEW',
          sequenceId: sequenceId || null
        }
      });
      created.push(prospect);
    }

    return { imported: created.length, prospects: created };
  });

  // GET /cold-email/prospects — list prospects
  fastify.get('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, sequenceId } = request.query || {};
    const where = {};
    if (status) where.status = status;
    if (sequenceId) where.sequenceId = sequenceId;

    const prospects = await prisma.coldEmailProspect.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return prospects;
  });

  // GET /cold-email/sequences — list campaigns
  fastify.get('/sequences', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status } = request.query || {};
    const where = {};
    if (status) where.status = status;

    const sequences = await prisma.coldEmailSequence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { prospects: true } }
      }
    });

    return sequences;
  });

  // GET /cold-email/sequences/:id — get single sequence with emails parsed
  fastify.get('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.coldEmailSequence.findUnique({
      where: { id: request.params.id },
      include: { prospects: true }
    });

    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });

    return {
      ...sequence,
      emails: JSON.parse(sequence.emails || '[]')
    };
  });

  // PUT /cold-email/sequences/:id — update sequence
  fastify.put('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, emails, status, serviceType, targetIndustry } = request.body || {};

    const data = {};
    if (name !== undefined) data.name = name;
    if (emails !== undefined) data.emails = JSON.stringify(emails);
    if (status !== undefined) data.status = status;
    if (serviceType !== undefined) data.serviceType = serviceType;
    if (targetIndustry !== undefined) data.targetIndustry = targetIndustry;

    const sequence = await prisma.coldEmailSequence.update({
      where: { id: request.params.id },
      data
    });

    return sequence;
  });

  // DELETE /cold-email/sequences/:id
  fastify.delete('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.coldEmailSequence.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });

  // PATCH /cold-email/prospects/:id — update prospect status
  fastify.patch('/prospects/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const prospect = await prisma.coldEmailProspect.update({
      where: { id: request.params.id },
      data: { ...request.body, updatedAt: new Date() }
    });
    return prospect;
  });
}
