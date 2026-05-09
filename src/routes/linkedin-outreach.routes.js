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

  // ── Rate Limiting ───────────────────────────────────────────────

  const DAILY_CONNECTION_LIMIT = 20;
  const DAILY_MESSAGE_LIMIT = 50;

  async function getDailyUsage() {
    const today = new Date().toISOString().slice(0, 10);
    let usage = await prisma.linkedInDailyUsage.findUnique({ where: { date: today } });
    if (!usage) {
      usage = await prisma.linkedInDailyUsage.create({
        data: { date: today, connectionsSent: 0, messagesSent: 0 }
      });
    }
    return usage;
  }

  async function incrementDailyUsage(field) {
    const today = new Date().toISOString().slice(0, 10);
    return prisma.linkedInDailyUsage.upsert({
      where: { date: today },
      create: { date: today, [field]: 1 },
      update: { [field]: { increment: 1 } }
    });
  }

  // ── Campaign Stats ──────────────────────────────────────────────

  // GET /linkedin-agent/stats — campaign dashboard statistics
  fastify.get('/stats', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const [prospectStatuses, sequenceStatuses, dailyUsage] = await Promise.all([
      prisma.linkedInProspect.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      prisma.linkedInSequence.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      getDailyUsage()
    ]);

    const prospectCounts = {};
    for (const g of prospectStatuses) prospectCounts[g.status] = g._count.id;
    const sequenceCounts = {};
    for (const g of sequenceStatuses) sequenceCounts[g.status] = g._count.id;

    return {
      prospects: {
        total: Object.values(prospectCounts).reduce((a, b) => a + b, 0),
        byStatus: prospectCounts
      },
      sequences: {
        total: Object.values(sequenceCounts).reduce((a, b) => a + b, 0),
        byStatus: sequenceCounts
      },
      dailyUsage: {
        date: dailyUsage.date,
        connectionsSent: dailyUsage.connectionsSent,
        messagesSent: dailyUsage.messagesSent,
        connectionLimit: DAILY_CONNECTION_LIMIT,
        messageLimit: DAILY_MESSAGE_LIMIT,
        connectionsRemaining: Math.max(0, DAILY_CONNECTION_LIMIT - dailyUsage.connectionsSent),
        messagesRemaining: Math.max(0, DAILY_MESSAGE_LIMIT - dailyUsage.messagesSent)
      }
    };
  });

  // ── Sequence Activation / Sending ───────────────────────────────

  // POST /linkedin-agent/send-connection — track connection request sent
  fastify.post('/send-connection', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { sequenceId, prospectId } = request.body || {};

    if (!sequenceId || !prospectId) {
      return reply.status(400).send({ error: 'sequenceId and prospectId are required' });
    }

    const usage = await getDailyUsage();
    if (usage.connectionsSent >= DAILY_CONNECTION_LIMIT) {
      return reply.status(429).send({
        error: 'Daily connection limit reached',
        limit: DAILY_CONNECTION_LIMIT,
        sent: usage.connectionsSent
      });
    }

    const [updatedSeq, updatedProspect] = await Promise.all([
      prisma.linkedInSequence.update({
        where: { id: sequenceId },
        data: { status: 'ACTIVE' }
      }),
      prisma.linkedInProspect.update({
        where: { id: prospectId },
        data: { status: 'CONNECTED' }
      }),
      incrementDailyUsage('connectionsSent')
    ]);

    return {
      sequence: updatedSeq,
      prospect: updatedProspect,
      usage: {
        connectionsSent: usage.connectionsSent + 1,
        connectionsRemaining: DAILY_CONNECTION_LIMIT - (usage.connectionsSent + 1)
      }
    };
  });

  // POST /linkedin-agent/send-message — track follow-up message sent
  fastify.post('/send-message', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { sequenceId, prospectId, messageType } = request.body || {};

    if (!sequenceId || !prospectId) {
      return reply.status(400).send({ error: 'sequenceId and prospectId are required' });
    }

    const usage = await getDailyUsage();
    if (usage.messagesSent >= DAILY_MESSAGE_LIMIT) {
      return reply.status(429).send({
        error: 'Daily message limit reached',
        limit: DAILY_MESSAGE_LIMIT,
        sent: usage.messagesSent
      });
    }

    const updateData = { status: 'IN_SEQUENCE' };
    if (messageType === 'followUp2') updateData.status = 'REPLIED';

    const [updatedProspect] = await Promise.all([
      prisma.linkedInProspect.update({
        where: { id: prospectId },
        data: updateData
      }),
      incrementDailyUsage('messagesSent')
    ]);

    return {
      prospect: updatedProspect,
      messageType: messageType || 'followUp1',
      usage: {
        messagesSent: usage.messagesSent + 1,
        messagesRemaining: DAILY_MESSAGE_LIMIT - (usage.messagesSent + 1)
      }
    };
  });

  // PATCH /linkedin-agent/prospects/:id/status — quick status update
  fastify.patch('/prospects/:id/status', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status } = request.body || {};
    const validStatuses = ['NEW', 'CONNECTED', 'IN_SEQUENCE', 'REPLIED', 'CONVERTED', 'DECLINED'];

    if (!status || !validStatuses.includes(status)) {
      return reply.status(400).send({
        error: `status is required and must be one of: ${validStatuses.join(', ')}`
      });
    }

    const prospect = await prisma.linkedInProspect.update({
      where: { id: request.params.id },
      data: { status, updatedAt: new Date() }
    });
    return prospect;
  });
}
