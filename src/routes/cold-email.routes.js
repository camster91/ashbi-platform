// Cold Email Agent routes
// Phase 1b: Wire Mailgun sending, sequence engine, tracking

import aiClient from '../ai/client.js';
import { createDraft } from '../agents/gmail-draft.agent.js';
import {
  sendSequenceEmailToProspect,
  processScheduledSends,
  activateSequence,
  processMailgunTrackingEvent,
  getSequenceStats,
} from '../services/cold-email.service.js';

export default async function coldEmailRoutes(fastify) {
  const { prisma } = fastify;

  // ==================== SEQUENCE GENERATION ====================

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

  // ==================== PROSPECT MANAGEMENT ====================

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

    // Update sequence totalProspects count
    if (sequenceId) {
      const count = await prisma.coldEmailProspect.count({ where: { sequenceId } });
      await prisma.coldEmailSequence.update({
        where: { id: sequenceId },
        data: { totalProspects: count },
      });
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

  // ==================== SEQUENCE MANAGEMENT ====================

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

  // ==================== SEQUENCE ENGINE — NEW ENDPOINTS ====================

  // POST /cold-email/sequences/:id/activate — activate sequence (start sending)
  fastify.post('/sequences/:id/activate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const sequence = await activateSequence(request.params.id, prisma);
      return { activated: true, sequenceId: sequence.id, status: 'ACTIVE' };
    } catch (err) {
      fastify.log.error('Sequence activation error:', err);
      const status = err.message.includes('not found') ? 404
        : err.message.includes('No prospects') ? 400
        : 500;
      return reply.status(status).send({ error: err.message });
    }
  });

  // POST /cold-email/sequences/:id/pause — pause sequence
  fastify.post('/sequences/:id/pause', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequence = await prisma.coldEmailSequence.update({
      where: { id: request.params.id },
      data: { status: 'PAUSED' },
    });
    return { paused: true, sequenceId: sequence.id };
  });

  // POST /cold-email/send-to-prospect/:prospectId — send specific email to one prospect
  fastify.post('/send-to-prospect/:prospectId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { stepIndex } = request.body || {};
    const prospect = await prisma.coldEmailProspect.findUnique({
      where: { id: request.params.prospectId },
      include: { sequence: true },
    });

    if (!prospect) return reply.status(404).send({ error: 'Prospect not found' });
    if (!prospect.sequence) return reply.status(400).send({ error: 'Prospect not assigned to a sequence' });

    const step = stepIndex ?? ((prospect.lastEmailStep ?? -1) + 1);
    const result = await sendSequenceEmailToProspect(prospect, prospect.sequence, step, prisma);

    if (result.ok) {
      return { sent: true, prospectId: prospect.id, step, mailgunId: result.id };
    }
    return reply.status(500).send({ error: result.error || 'Send failed' });
  });

  // POST /cold-email/process-queue — cron endpoint to process due sends
  fastify.post('/process-queue', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    try {
      const stats = await processScheduledSends(prisma);
      return { processed: true, ...stats };
    } catch (err) {
      fastify.log.error('Process queue error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /cold-email/stats/:sequenceId — campaign stats dashboard
  fastify.get('/stats/:sequenceId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const stats = await getSequenceStats(request.params.sequenceId, prisma);
      return stats;
    } catch (err) {
      fastify.log.error('Stats error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return reply.status(status).send({ error: err.message });
    }
  });

  // ==================== GMAIL DRAFT — Cold Email ====================

  // POST /cold-email/draft — create Gmail draft from a sequence email for a prospect
  // Does NOT send — Cam reviews in Gmail draft folder first
  fastify.post('/draft', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { prospectId, stepIndex } = request.body || {};

    if (!prospectId) return reply.status(400).send({ error: 'prospectId is required' });

    // Fetch prospect with sequence
    const prospect = await prisma.coldEmailProspect.findUnique({
      where: { id: prospectId },
      include: { sequence: true }
    });

    if (!prospect) return reply.status(404).send({ error: 'Prospect not found' });
    if (!prospect.sequence) return reply.status(400).send({ error: 'Prospect has no sequence assigned' });

    // Parse emails from sequence
    const emails = JSON.parse(prospect.sequence.emails || '[]');
    const step = stepIndex ?? 0;

    if (!emails[step]) return reply.status(400).send({ error: `No email at step ${step}` });

    const email = emails[step];

    // Personalize placeholders
    const personalize = (text) => text
      .replace(/\{\{company\}\}/g, prospect.company || '')
      .replace(/\{\{name\}\}/g, prospect.name || '');

    const subject = personalize(email.subject || '');
    const body = personalize(email.body || '');

    try {
      const draft = await createDraft(prospect.email, subject, body);
      return {
        draftCreated: true,
        draftId: draft.id,
        prospectId: prospect.id,
        prospectEmail: prospect.email,
        subject,
        step
      };
    } catch (err) {
      fastify.log.error('Gmail draft error:', err);
      return reply.status(500).send({ error: 'Failed to create Gmail draft: ' + err.message });
    }
  });

  // POST /cold-email/draft-from-sequence — create drafts for all prospects in a sequence
  // Creates Gmail drafts for ALL prospects at a given step. Cam sends manually.
  fastify.post('/draft-from-sequence', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { sequenceId, stepIndex = 0 } = request.body || {};

    if (!sequenceId) return reply.status(400).send({ error: 'sequenceId is required' });

    const sequence = await prisma.coldEmailSequence.findUnique({
      where: { id: sequenceId },
      include: { prospects: true }
    });

    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });

    const emails = JSON.parse(sequence.emails || '[]');
    if (!emails[stepIndex]) return reply.status(400).send({ error: `No email at step ${stepIndex}` });

    const email = emails[stepIndex];

    const results = [];
    for (const prospect of sequence.prospects) {
      const personalize = (text) => text
        .replace(/\{\{company\}\}/g, prospect.company || '')
        .replace(/\{\{name\}\}/g, prospect.name || '');

      try {
        const draft = await createDraft(
          prospect.email,
          personalize(email.subject || ''),
          personalize(email.body || '')
        );
        results.push({ prospectId: prospect.id, email: prospect.email, draftId: draft.id, ok: true });
      } catch (err) {
        results.push({ prospectId: prospect.id, email: prospect.email, ok: false, error: err.message });
      }
    }

    return { sequenceId, step: stepIndex, subject: email.subject, results };
  });

  // ==================== MAILGUN WEBHOOK FOR TRACKING ====================

  // POST /cold-email/webhook/track — Mailgun tracking webhook (no auth — called by Mailgun)
  fastify.post('/webhook/track', async (request, reply) => {
    // Always respond 200 quickly to Mailgun
    reply.status(200).send({ status: 'ok' });

    try {
      const body = request.body;
      const eventData = body['event-data'] || body;

      // Skip if it's a test event or missing event type
      if (!eventData.event) {
        fastify.log.warn('[cold-email webhook] No event type in payload');
        return;
      }

      await processMailgunTrackingEvent(eventData, prisma);
    } catch (err) {
      fastify.log.error('[cold-email webhook] Processing error:', err.message);
    }
  });

  // POST /cold-email/webhook/reply — inbound reply webhook (detect prospect replies)
  fastify.post('/webhook/reply', async (request, reply) => {
    reply.status(200).send({ status: 'ok' });

    try {
      const body = request.body;
      const sender = body.sender || body.from || '';
      const recipient = body.recipient || '';

      // Extract email from sender
      const fromEmail = sender.match(/<([^>]+)>/) ? sender.match(/<([^>]+)>/)[1] : sender;

      if (!fromEmail) return;

      // Find matching prospect
      const prospect = await prisma.coldEmailProspect.findFirst({
        where: {
          email: fromEmail,
          status: { in: ['NEW', 'CONTACTED'] },
        },
        orderBy: { lastEmailedAt: 'desc' },
      });

      if (prospect) {
        // Mark as replied
        await prisma.coldEmailProspect.update({
          where: { id: prospect.id },
          data: {
            status: 'REPLIED',
            nextEmailAt: null, // Stop the sequence
          },
        });

        // Create reply event
        await prisma.coldEmailEvent.create({
          data: {
            prospectId: prospect.id,
            sequenceId: prospect.sequenceId,
            type: 'REPLIED',
            emailStep: prospect.lastEmailStep,
            metadata: JSON.stringify({ sender, recipient, subject: body.subject }),
          },
        });

        // Update sequence stats
        if (prospect.sequenceId) {
          await prisma.coldEmailSequence.update({
            where: { id: prospect.sequenceId },
            data: { totalReplied: { increment: 1 } },
          });
        }

        fastify.log.info(`[cold-email] Prospect ${prospect.id} replied — sequence stopped`);
      }
    } catch (err) {
      fastify.log.error('[cold-email webhook/reply] Processing error:', err.message);
    }
  });
}
