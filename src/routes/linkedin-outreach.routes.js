// LinkedIn Outreach Agent routes

import aiClient from '../ai/client.js';

export default async function linkedinOutreachRoutes(fastify) {
  const { prisma } = fastify;

  // POST /linkedin-agent/sequence — generate connection + follow-up sequence
  fastify.post('/sequence', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospectName, prospectTitle, company, industry, linkedinUrl, notes } = request.body || {};

    if (!prospectName || !company) {
      return reply.status(400).send({ error: 'prospectName and company are required' });
    }

    const system = `You are a LinkedIn outreach expert for Ashbi Design, a Toronto-based CPG/DTC creative agency. Write natural, non-spammy LinkedIn messages that build genuine connections. Cameron Ashley is the founder sending these messages.`;

    const prompt = `Create a 3-message LinkedIn outreach sequence for this prospect:

Name: ${prospectName}
Title: ${prospectTitle || 'Brand Decision Maker'}
Company: ${company}
Industry: ${industry || 'CPG/DTC'}
${notes ? `Notes: ${notes}` : ''}

Target profile: CPG/DTC brand owners, Shopify store owners, marketing managers

Return JSON:
{
  "connectionMsg": "Connection request message (300 char max, no links). Mention something specific about their brand/company. Don't pitch — just connect.",
  "followUp1": "Follow-up message 1 (sent 3 days after connection). Thank for connecting, share one relevant insight about their industry, soft mention of Ashbi's work.",
  "followUp2": "Follow-up message 2 (sent 7 days after connection). Share a specific case study or result. Clear CTA: 15-min chat about their brand's growth."
}

Each message should feel personal, not templated. Reference their specific industry/company.`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.7 });

      const sequence = await prisma.linkedInSequence.create({
        data: {
          prospectName,
          prospectTitle: prospectTitle || null,
          company: company || null,
          industry: industry || null,
          linkedinUrl: linkedinUrl || null,
          connectionMsg: result.connectionMsg,
          followUp1: result.followUp1,
          followUp2: result.followUp2,
          status: 'DRAFT',
          notes: notes || null
        }
      });

      return sequence;
    } catch (err) {
      fastify.log.error('LinkedIn sequence generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate sequence', message: err.message });
    }
  });

  // POST /linkedin-agent/prospects — store prospect list
  fastify.post('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospects } = request.body || {};

    if (!Array.isArray(prospects) || prospects.length === 0) {
      return reply.status(400).send({ error: 'prospects array is required' });
    }

    const created = [];
    for (const p of prospects) {
      if (!p.name) continue;
      const prospect = await prisma.linkedInProspect.create({
        data: {
          name: p.name,
          title: p.title || null,
          company: p.company || null,
          industry: p.industry || null,
          linkedinUrl: p.linkedinUrl || null,
          email: p.email || null,
          status: 'NEW',
          notes: p.notes || null
        }
      });
      created.push(prospect);
    }

    return { imported: created.length, prospects: created };
  });

  // GET /linkedin-agent/prospects — list all prospects
  fastify.get('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status } = request.query || {};
    const where = {};
    if (status) where.status = status;

    const prospects = await prisma.linkedInProspect.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return prospects;
  });

  // PATCH /linkedin-agent/prospects/:id — update prospect
  fastify.patch('/prospects/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const prospect = await prisma.linkedInProspect.update({
      where: { id: request.params.id },
      data: { ...request.body, updatedAt: new Date() }
    });
    return prospect;
  });

  // GET /linkedin-agent/sequences — list all sequences
  fastify.get('/sequences', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status } = request.query || {};
    const where = {};
    if (status) where.status = status;

    const sequences = await prisma.linkedInSequence.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return sequences;
  });

  // GET /linkedin-agent/sequences/:id — get single sequence
  fastify.get('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.linkedInSequence.findUnique({
      where: { id: request.params.id }
    });
    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });
    return sequence;
  });

  // PUT /linkedin-agent/sequences/:id — update sequence
  fastify.put('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { connectionMsg, followUp1, followUp2, status, notes } = request.body || {};

    const data = {};
    if (connectionMsg !== undefined) data.connectionMsg = connectionMsg;
    if (followUp1 !== undefined) data.followUp1 = followUp1;
    if (followUp2 !== undefined) data.followUp2 = followUp2;
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;

    const sequence = await prisma.linkedInSequence.update({
      where: { id: request.params.id },
      data
    });

    return sequence;
  });

  // DELETE /linkedin-agent/sequences/:id
  fastify.delete('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.linkedInSequence.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
