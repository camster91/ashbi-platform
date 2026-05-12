// LinkedIn Outreach Agent routes

import aiClient from '../ai/client.js';

export default async function linkedinOutreachRoutes(fastify) {
  const { prisma } = fastify;

  // ===== CAMPAIGN CRUD =====

  // POST /linkedin-outreach/campaigns — create campaign
  fastify.post('/campaigns', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, description, maxConnectionsPerDay } = request.body || {};
    if (!name) return reply.status(400).send({ error: 'name is required' });

    const campaign = await prisma.linkedInCampaign.create({
      data: {
        name,
        description: description || null,
        maxConnectionsPerDay: maxConnectionsPerDay || 20,
      }
    });
    return campaign;
  });

  // GET /linkedin-outreach/campaigns — list campaigns
  fastify.get('/campaigns', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const campaigns = await prisma.linkedInCampaign.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return campaigns;
  });

  // GET /linkedin-outreach/campaigns/:id — get campaign with stats
  fastify.get('/campaigns/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const campaign = await prisma.linkedInCampaign.findUnique({
      where: { id: request.params.id },
      include: {
        // Include sequences in this campaign
        _count: { select: { sequences: true } }
      }
    });
    if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });
    return campaign;
  });

  // PUT /linkedin-outreach/campaigns/:id — update campaign
  fastify.put('/campaigns/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, description, status, maxConnectionsPerDay } = request.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    if (maxConnectionsPerDay !== undefined) data.maxConnectionsPerDay = maxConnectionsPerDay;

    const campaign = await prisma.linkedInCampaign.update({
      where: { id: request.params.id },
      data
    });
    return campaign;
  });

  // DELETE /linkedin-outreach/campaigns/:id
  fastify.delete('/campaigns/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.linkedInCampaign.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });

  // ===== SEQUENCE GENERATION =====

  // POST /linkedin-outreach/sequence — generate connection + follow-up sequence
  fastify.post('/sequence', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospectName, prospectTitle, company, industry, linkedinUrl, notes, campaignId } = request.body || {};

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
          notes: notes || null,
          campaignId: campaignId || null,
        }
      });

      return sequence;
    } catch (err) {
      fastify.log.error('LinkedIn sequence generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate sequence', message: err.message });
    }
  });

  // ===== MESSAGE SENDING =====

  // POST /linkedin-outreach/send — send a message (connection request or follow-up)
  fastify.post('/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { sequenceId, messageType, campaignId } = request.body || {};

    if (!sequenceId || !messageType) {
      return reply.status(400).send({ error: 'sequenceId and messageType are required' });
    }

    const sequence = await prisma.linkedInSequence.findUnique({ where: { id: sequenceId } });
    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });

    // Determine which message to send
    let content;
    if (messageType === 'connection') {
      content = sequence.connectionMsg;
    } else if (messageType === 'followup1') {
      content = sequence.followUp1;
    } else if (messageType === 'followup2') {
      content = sequence.followUp2;
    } else {
      return reply.status(400).send({ error: 'Invalid messageType. Use: connection, followup1, followup2' });
    }

    // Rate limiting check: max 20 connections per day per campaign
    if (campaignId) {
      const campaign = await prisma.linkedInCampaign.findUnique({ where: { id: campaignId } });
      if (campaign) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sentToday = await prisma.linkedInMessage.count({
          where: {
            campaignId,
            sentAt: { gte: today },
            messageType: 'connection'
          }
        });
        if (sentToday >= campaign.maxConnectionsPerDay) {
          return reply.status(429).send({
            error: 'Daily connection limit reached',
            limit: campaign.maxConnectionsPerDay,
            resetAt: new Date(today.getTime() + 86400000)
          });
        }
      }
    }

    // Create message record
    const message = await prisma.linkedInMessage.create({
      data: {
        sequenceId,
        campaignId: campaignId || null,
        prospectName: sequence.prospectName,
        prospectUrl: sequence.linkedinUrl,
        messageType,
        content,
        status: 'PENDING',
        scheduledFor: messageType === 'connection'
          ? new Date()
          : messageType === 'followup1'
            ? new Date(Date.now() + 3 * 86400000)
            : new Date(Date.now() + 7 * 86400000)
      }
    });

    // --- MOCK LinkedIn API call (replace with real API integration) ---
    // In production, you would call LinkedIn's API here:
    // const linkedinResponse = await fetch('https://api.linkedin.com/v2/...', { ... });
    let mockResult;
    try {
      // Simulate API delay and success
      await new Promise(resolve => setTimeout(resolve, 100));

      // Mock: randomly succeed (90% success rate for demo)
      const success = Math.random() > 0.1;
      mockResult = success
        ? { linkedinMsgId: `li_${Date.now()}_${Math.random().toString(36).slice(2)}`, status: 'SENT' }
        : { error: 'LinkedIn rate limit or network error', status: 'FAILED' };

    } catch (err) {
      mockResult = { error: err.message, status: 'FAILED' };
    }

    // Update message status
    const updatedMsg = await prisma.linkedInMessage.update({
      where: { id: message.id },
      data: {
        status: mockResult.status,
        sentAt: mockResult.status === 'SENT' ? new Date() : null,
        linkedinMsgId: mockResult.linkedinMsgId || null,
        errorMessage: mockResult.error || null,
      }
    });

    // Update sequence sentCount and status
    const newSentCount = (sequence.sentCount || 0) + 1;
    let newStatus = sequence.status;
    let nextSendAt = null;

    if (mockResult.status === 'SENT') {
      if (messageType === 'connection') {
        nextSendAt = new Date(Date.now() + 3 * 86400000); // schedule followup1
        newStatus = 'ACTIVE';
      } else if (messageType === 'followup1') {
        nextSendAt = new Date(Date.now() + 4 * 86400000); // schedule followup2 (day 7)
      } else if (messageType === 'followup2') {
        newStatus = 'COMPLETED';
        nextSendAt = null;
      }
    } else if (mockResult.status === 'FAILED') {
      newStatus = 'FAILED';
    }

    await prisma.linkedInSequence.update({
      where: { id: sequenceId },
      data: {
        sentCount: newSentCount,
        status: newStatus,
        nextSendAt,
        lastSentAt: mockResult.status === 'SENT' ? new Date() : sequence.lastSentAt,
        startedAt: messageType === 'connection' ? new Date() : sequence.startedAt,
      }
    });

    // Update campaign stats
    if (campaignId && mockResult.status === 'SENT') {
      const inc = messageType === 'connection' ? { totalSent: { increment: 1 }, totalProspects: { increment: 1 } }
        : { totalSent: { increment: 1 } };
      await prisma.linkedInCampaign.update({ where: { id: campaignId }, data: inc });
    }

    return { message: updatedMsg, mock: true };
  });

  // ===== SEQUENCE ENGINE =====

  // POST /linkedin-outreach/sequences/:id/activate — start sequence (send connection)
  fastify.post('/sequences/:id/activate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.linkedInSequence.findUnique({ where: { id: request.params.id } });
    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });
    if (sequence.status === 'ACTIVE') return reply.status(400).send({ error: 'Sequence already active' });

    const updated = await prisma.linkedInSequence.update({
      where: { id: request.params.id },
      data: {
        status: 'ACTIVE',
        startedAt: new Date(),
        nextSendAt: new Date(), // send connection immediately
      }
    });

    return updated;
  });

  // POST /linkedin-outreach/sequences/:id/pause
  fastify.post('/sequences/:id/pause', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.linkedInSequence.update({
      where: { id: request.params.id },
      data: { status: 'PAUSED', nextSendAt: null }
    });
    return sequence;
  });

  // GET /linkedin-outreach/sequences/pending — get sequences with messages due
  fastify.get('/sequences/pending', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const now = new Date();
    const pending = await prisma.linkedInSequence.findMany({
      where: {
        status: 'ACTIVE',
        nextSendAt: { lte: now }
      },
      orderBy: { nextSendAt: 'asc' }
    });
    return pending;
  });

  // ===== PROSPECTS =====

  // POST /linkedin-outreach/prospects — store prospect list
  fastify.post('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospects, campaignId } = request.body || {};

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
          notes: p.notes || null,
          campaignId: campaignId || null,
        }
      });
      created.push(prospect);
    }

    return { imported: created.length, prospects: created };
  });

  // GET /linkedin-outreach/prospects — list all prospects
  fastify.get('/prospects', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, campaignId } = request.query || {};
    const where = {};
    if (status) where.status = status;
    if (campaignId) where.campaignId = campaignId;

    const prospects = await prisma.linkedInProspect.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return prospects;
  });

  // PATCH /linkedin-outreach/prospects/:id — update prospect
  fastify.patch('/prospects/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const prospect = await prisma.linkedInProspect.update({
      where: { id: request.params.id },
      data: { ...request.body, updatedAt: new Date() }
    });
    return prospect;
  });

  // ===== SEQUENCES CRUD =====

  // GET /linkedin-outreach/sequences — list all sequences
  fastify.get('/sequences', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, campaignId } = request.query || {};
    const where = {};
    if (status) where.status = status;
    if (campaignId) where.campaignId = campaignId;

    const sequences = await prisma.linkedInSequence.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return sequences;
  });

  // GET /linkedin-outreach/sequences/:id — get single sequence
  fastify.get('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.linkedInSequence.findUnique({
      where: { id: request.params.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });
    return sequence;
  });

  // PUT /linkedin-outreach/sequences/:id — update sequence
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

  // DELETE /linkedin-outreach/sequences/:id
  fastify.delete('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.linkedInSequence.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });

  // ===== MESSAGES =====

  // GET /linkedin-outreach/messages — list messages
  fastify.get('/messages', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { sequenceId, campaignId, status } = request.query || {};
    const where = {};
    if (sequenceId) where.sequenceId = sequenceId;
    if (campaignId) where.campaignId = campaignId;
    if (status) where.status = status;

    const messages = await prisma.linkedInMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    return messages;
  });

  // ===== RATE LIMIT STATUS =====

  // GET /linkedin-outreach/rate-limit — get today's usage
  fastify.get('/rate-limit', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { campaignId } = request.query || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const baseQuery = {
      where: {
        sentAt: { gte: today },
        messageType: 'connection'
      }
    };
    const countQuery = campaignId
      ? { ...baseQuery, where: { ...baseQuery.where, campaignId } }
      : baseQuery;

    const sentToday = await prisma.linkedInMessage.count(countQuery);
    const defaultLimit = 20;

    return {
      sentToday,
      limit: defaultLimit,
      remaining: Math.max(0, defaultLimit - sentToday),
      resetsAt: new Date(today.getTime() + 86400000)
    };
  });
}