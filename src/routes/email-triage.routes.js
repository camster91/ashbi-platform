// Email Triage Agent routes

import aiClient from '../ai/client.js';

export default async function emailTriageRoutes(fastify) {
  const { prisma } = fastify;

  // POST /email-agent/scan — scan inbox and triage unread messages
  fastify.post('/scan', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    // Pull recent unread threads from DB (placeholder until Gmail OAuth)
    const threads = await prisma.thread.findMany({
      where: { status: 'OPEN' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    if (threads.length === 0) {
      return { scanned: 0, items: [] };
    }

    const items = [];

    for (const thread of threads) {
      const msg = thread.messages[0];
      if (!msg) continue;

      // Check if already triaged
      const existing = await prisma.emailTriageItem.findFirst({
        where: { threadId: thread.id }
      });
      if (existing) continue;

      const system = `You are an email triage assistant for Ashbi Design, a Toronto-based CPG/DTC creative agency run by Cameron Ashley. Classify emails accurately and concisely.`;

      const prompt = `Analyze this email and return JSON:

Subject: ${thread.subject}
From: ${msg.senderEmail} (${msg.senderName || 'Unknown'})
Body: ${msg.bodyText?.substring(0, 2000)}

Return JSON:
{
  "tags": ["needs-reply"|"info-only"|"urgent"|"client"|"lead"|"spam"],
  "summary": "1-2 sentence summary of what this email is about and what action is needed"
}

Choose ALL applicable tags. "needs-reply" means Cameron should respond. "lead" means potential new business. "urgent" means time-sensitive.`;

      try {
        const result = await aiClient.chatJSON({ system, prompt, temperature: 0.2 });

        const item = await prisma.emailTriageItem.create({
          data: {
            subject: thread.subject,
            senderEmail: msg.senderEmail,
            senderName: msg.senderName || null,
            bodyText: msg.bodyText || '',
            tags: JSON.stringify(result.tags || []),
            aiSummary: result.summary || null,
            threadId: thread.id,
            status: 'PENDING'
          }
        });

        items.push(item);
      } catch (err) {
        fastify.log.error('Email triage scan error:', err);
      }
    }

    return { scanned: threads.length, triaged: items.length, items };
  });

  // POST /email-agent/draft/:messageId — AI drafts 2 reply options
  fastify.post('/draft/:messageId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { messageId } = request.params;

    const item = await prisma.emailTriageItem.findUnique({
      where: { id: messageId }
    });

    if (!item) return reply.status(404).send({ error: 'Triage item not found' });

    const system = `You are a professional email assistant for Cameron Ashley, founder of Ashbi Design, a Toronto-based CPG/DTC creative agency specializing in branding, packaging design, and ecommerce web development. Draft polite, professional, on-brand replies.`;

    const prompt = `Draft 2 different reply options for this email:

Subject: ${item.subject}
From: ${item.senderEmail} (${item.senderName || 'Unknown'})
Body: ${item.bodyText?.substring(0, 3000)}

Return JSON:
{
  "options": [
    { "subject": "Re: ...", "body": "full reply text", "tone": "professional|friendly|brief" },
    { "subject": "Re: ...", "body": "full reply text", "tone": "professional|friendly|brief" }
  ]
}

Option 1: Standard professional reply. Option 2: Shorter/friendlier alternative. Sign as Cameron.`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.6 });

      const drafts = [];
      for (let i = 0; i < (result.options || []).length; i++) {
        const opt = result.options[i];
        const draft = await prisma.emailTriageDraft.create({
          data: {
            option: i + 1,
            subject: opt.subject || `Re: ${item.subject}`,
            body: opt.body,
            tone: opt.tone || null,
            status: 'DRAFT',
            itemId: item.id
          }
        });
        drafts.push(draft);
      }

      return { itemId: item.id, drafts };
    } catch (err) {
      fastify.log.error('Email draft error:', err);
      return reply.status(500).send({ error: 'Failed to generate drafts', message: err.message });
    }
  });

  // GET /email-agent/queue — list emails needing reply with drafts
  fastify.get('/queue', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, tag } = request.query || {};

    const where = {};
    if (status) where.status = status;

    const items = await prisma.emailTriageItem.findMany({
      where,
      include: { drafts: { orderBy: { option: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });

    // Filter by tag if requested
    if (tag) {
      return items.filter(item => {
        const tags = JSON.parse(item.tags || '[]');
        return tags.includes(tag);
      });
    }

    return items;
  });

  // PUT /email-agent/approve/:draftId — marks draft approved
  fastify.put('/approve/:draftId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { draftId } = request.params;

    const draft = await prisma.emailTriageDraft.update({
      where: { id: draftId },
      data: { status: 'APPROVED' }
    });

    // Mark parent item as reviewed
    await prisma.emailTriageItem.update({
      where: { id: draft.itemId },
      data: { status: 'REVIEWED' }
    });

    return draft;
  });

  // PUT /email-agent/update-draft/:draftId — edit a draft before approving
  fastify.put('/update-draft/:draftId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { draftId } = request.params;
    const { subject, body } = request.body || {};

    const data = {};
    if (subject !== undefined) data.subject = subject;
    if (body !== undefined) data.body = body;

    const draft = await prisma.emailTriageDraft.update({
      where: { id: draftId },
      data
    });

    return draft;
  });

  // PUT /email-agent/archive/:itemId — archive a triage item
  fastify.put('/archive/:itemId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const item = await prisma.emailTriageItem.update({
      where: { id: request.params.itemId },
      data: { status: 'ARCHIVED' }
    });
    return item;
  });
}
