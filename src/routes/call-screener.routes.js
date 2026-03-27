// Call Screener Agent routes

import aiClient from '../ai/client.js';

export default async function callScreenerRoutes(fastify) {
  const { prisma } = fastify;

  // POST /call-agent/screen — generate screening questions + summary template
  fastify.post('/screen', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { callerName, callerNumber, callerCompany, context } = request.body || {};

    if (!callerName) return reply.status(400).send({ error: 'callerName is required' });

    const system = `You are a call screening assistant for Cameron Ashley, founder of Ashbi Design, a Toronto-based CPG/DTC creative agency. Generate professional screening questions to qualify callers and prepare call summaries.`;

    const prompt = `Generate screening questions and a summary template for this incoming call:

Caller: ${callerName}
${callerNumber ? `Number: ${callerNumber}` : ''}
${callerCompany ? `Company: ${callerCompany}` : ''}
${context ? `Context: ${context}` : ''}

Ashbi Design serves CPG/DTC brands with branding, packaging, and web design.

Return JSON:
{
  "screeningQuestions": [
    "Question 1 — understand who they are and what they need",
    "Question 2 — understand their timeline and budget range",
    "Question 3 — understand their current brand situation",
    "Question 4 — qualify if they're a good fit for Ashbi",
    "Question 5 — determine next steps"
  ],
  "summaryTemplate": "## Call Summary\\n\\n**Caller:** ${callerName}\\n**Company:** \\n**Date:** \\n\\n### Key Points\\n- \\n- \\n\\n### Their Needs\\n- \\n\\n### Budget/Timeline\\n- \\n\\n### Next Steps\\n- \\n\\n### Fit Assessment\\n- Good fit: Yes/No\\n- Reason: ",
  "preCallBrief": "1-2 sentence brief on how to approach this call"
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.5 });

      const call = await prisma.callLog.create({
        data: {
          callerName,
          callerNumber: callerNumber || null,
          callerCompany: callerCompany || null,
          screeningScript: JSON.stringify(result.screeningQuestions || []),
          summaryTemplate: result.summaryTemplate || null,
          status: 'PENDING'
        }
      });

      return { ...call, screeningQuestions: result.screeningQuestions, preCallBrief: result.preCallBrief };
    } catch (err) {
      fastify.log.error('Call screen error:', err);
      return reply.status(500).send({ error: 'Failed to generate screening script', message: err.message });
    }
  });

  // POST /call-agent/summary — save call summary from notes
  fastify.post('/summary', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { callId, summary, notes } = request.body || {};

    if (!callId) return reply.status(400).send({ error: 'callId is required' });

    const call = await prisma.callLog.update({
      where: { id: callId },
      data: {
        callSummary: summary || null,
        callNotes: notes || null,
        status: 'COMPLETED',
        calledAt: new Date()
      }
    });

    return call;
  });

  // GET /call-agent/calls — call log with AI summaries
  fastify.get('/calls', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status } = request.query || {};
    const where = {};
    if (status) where.status = status;

    const calls = await prisma.callLog.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Parse screening scripts for response
    return calls.map(call => ({
      ...call,
      screeningQuestions: JSON.parse(call.screeningScript || '[]')
    }));
  });

  // GET /call-agent/calls/:id — single call
  fastify.get('/calls/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const call = await prisma.callLog.findUnique({
      where: { id: request.params.id }
    });
    if (!call) return reply.status(404).send({ error: 'Call not found' });
    return {
      ...call,
      screeningQuestions: JSON.parse(call.screeningScript || '[]')
    };
  });

  // POST /call-agent/follow-up/:callId — draft follow-up email from call summary
  fastify.post('/follow-up/:callId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { callId } = request.params;

    const call = await prisma.callLog.findUnique({ where: { id: callId } });
    if (!call) return reply.status(404).send({ error: 'Call not found' });

    if (!call.callSummary && !call.callNotes) {
      return reply.status(400).send({ error: 'No call summary or notes to generate follow-up from' });
    }

    const system = `You are Cameron Ashley, founder of Ashbi Design. Write a professional follow-up email after a phone call. Be warm, reference specific things discussed, and include clear next steps.`;

    const prompt = `Write a follow-up email after this phone call:

Caller: ${call.callerName}
${call.callerCompany ? `Company: ${call.callerCompany}` : ''}
${call.callSummary ? `Summary: ${call.callSummary}` : ''}
${call.callNotes ? `Notes: ${call.callNotes}` : ''}

Return JSON:
{
  "subject": "Great chatting, [name] — next steps",
  "body": "full email body, professional but warm, reference specifics from call, clear next steps, sign as Cameron"
}`;

    try {
      const result = await aiClient.chatJSON({ system, prompt, temperature: 0.6 });

      const updated = await prisma.callLog.update({
        where: { id: callId },
        data: {
          followUpEmail: JSON.stringify(result),
          status: 'FOLLOW_UP_SENT'
        }
      });

      return { call: updated, followUp: result };
    } catch (err) {
      fastify.log.error('Call follow-up error:', err);
      return reply.status(500).send({ error: 'Failed to generate follow-up', message: err.message });
    }
  });

  // PUT /call-agent/calls/:id — update call
  fastify.put('/calls/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { callerName, callerNumber, callerCompany, callSummary, callNotes, status } = request.body || {};

    const data = {};
    if (callerName !== undefined) data.callerName = callerName;
    if (callerNumber !== undefined) data.callerNumber = callerNumber;
    if (callerCompany !== undefined) data.callerCompany = callerCompany;
    if (callSummary !== undefined) data.callSummary = callSummary;
    if (callNotes !== undefined) data.callNotes = callNotes;
    if (status !== undefined) data.status = status;

    const call = await prisma.callLog.update({
      where: { id: request.params.id },
      data
    });

    return call;
  });

  // DELETE /call-agent/calls/:id
  fastify.delete('/calls/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    await prisma.callLog.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });
}
