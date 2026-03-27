// Outreach Agent routes

import aiClient from '../ai/client.js';

export default async function outreachRoutes(fastify) {
  const { prisma } = fastify;

  // ==================== LEADS ====================

  // POST /outreach/leads — add lead manually
  fastify.post('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, company, email, linkedinUrl, title, industry, source, notes, sequenceId } = request.body || {};

    if (!name || !email) {
      return reply.status(400).send({ error: 'name and email are required' });
    }

    const lead = await prisma.outreachLead.create({
      data: {
        name,
        company: company || null,
        email,
        linkedinUrl: linkedinUrl || null,
        title: title || null,
        industry: industry || null,
        status: 'NEW',
        source: source || 'MANUAL',
        notes: notes || null,
        sequenceId: sequenceId || null,
      }
    });

    return lead;
  });

  // POST /outreach/leads/search — search via Hunter.io
  fastify.post('/leads/search', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { domain, company, limit = 10 } = request.body || {};
    const hunterKey = process.env.HUNTER_API_KEY;

    if (!hunterKey) {
      return reply.status(500).send({ error: 'HUNTER_API_KEY not configured' });
    }

    if (!domain && !company) {
      return reply.status(400).send({ error: 'domain or company is required' });
    }

    try {
      let url;
      if (domain) {
        url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=${limit}&api_key=${hunterKey}`;
      } else {
        url = `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(company)}&limit=${limit}&api_key=${hunterKey}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        return reply.status(502).send({ error: 'Hunter.io error', details: data });
      }

      const emails = (data.data?.emails || []).map(e => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        email: e.value,
        title: e.position || null,
        company: data.data?.organization || company || domain,
        linkedinUrl: e.linkedin || null,
        industry: null,
        source: 'HUNTER',
      }));

      return { total: emails.length, leads: emails, domain: data.data?.domain };
    } catch (err) {
      fastify.log.error('Hunter.io search error:', err);
      return reply.status(500).send({ error: 'Failed to search Hunter.io', message: err.message });
    }
  });

  // GET /outreach/leads — list all leads
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { status, sequenceId } = request.query || {};

    const where = {};
    if (status) where.status = status;
    if (sequenceId) where.sequenceId = sequenceId;

    const leads = await prisma.outreachLead.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return leads;
  });

  // PATCH /outreach/leads/:id — update lead status/notes
  fastify.patch('/leads/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const updates = request.body || {};

    const lead = await prisma.outreachLead.update({
      where: { id },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    return lead;
  });

  // POST /outreach/email/generate — use Gemini to draft outreach email
  fastify.post('/email/generate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { leadId, name, company, title, industry } = request.body || {};

    let leadData = { name, company, title, industry };

    if (leadId) {
      const lead = await prisma.outreachLead.findUnique({ where: { id: leadId } });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      leadData = lead;
    }

    if (!leadData.name || !leadData.company) {
      return reply.status(400).send({ error: 'name and company are required' });
    }

    const system = `You are an expert cold email copywriter for Ashbi Design, a Toronto-based CPG/DTC creative agency. You write short, personalized, high-converting outreach emails. Never sound generic or AI-generated.`;

    const prompt = `Write a personalized cold outreach email for Ashbi Design (a Toronto CPG/DTC creative agency) to ${leadData.name} at ${leadData.company}. They are ${leadData.title || 'a brand decision-maker'} in the ${leadData.industry || 'consumer goods'} industry. Keep it under 100 words. Lead with a relevant observation about their brand. Offer one specific value: fast-turnaround branding/packaging/web for DTC brands. CTA: 15-min call. Sign off as Cameron Ashley.`;

    try {
      const email = await aiClient.chat({ system, prompt, temperature: 0.7 });
      return { email, lead: leadData };
    } catch (err) {
      fastify.log.error('Outreach email generate error:', err);
      return reply.status(500).send({ error: 'Failed to generate email', message: err.message });
    }
  });

  // ==================== SEQUENCES ====================

  // GET /outreach/sequences — list all sequences
  fastify.get('/sequences', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const sequences = await prisma.outreachSequence.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { leads: true } }
      }
    });

    return sequences;
  });

  // POST /outreach/sequences — create sequence
  fastify.post('/sequences', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name, steps, targetIndustry, filters } = request.body || {};

    if (!name) return reply.status(400).send({ error: 'name is required' });

    const sequence = await prisma.outreachSequence.create({
      data: {
        name,
        steps: JSON.stringify(steps || []),
        status: 'ACTIVE',
        targetIndustry: targetIndustry || null,
        filters: JSON.stringify(filters || {}),
      }
    });

    return sequence;
  });

  // PATCH /outreach/sequences/:id — update sequence (pause/resume)
  fastify.patch('/sequences/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, name, steps } = request.body || {};

    const data = {};
    if (status) data.status = status;
    if (name) data.name = name;
    if (steps) data.steps = JSON.stringify(steps);

    const sequence = await prisma.outreachSequence.update({
      where: { id },
      data
    });

    return sequence;
  });

  // POST /outreach/sequences/:id/run — run next step for all leads
  fastify.post('/sequences/:id/run', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const sequence = await prisma.outreachSequence.findUnique({
      where: { id },
      include: { leads: true }
    });

    if (!sequence) return reply.status(404).send({ error: 'Sequence not found' });
    if (sequence.status !== 'ACTIVE') return reply.status(400).send({ error: 'Sequence is paused' });

    const steps = JSON.parse(sequence.steps || '[]');
    if (steps.length === 0) return reply.status(400).send({ error: 'Sequence has no steps' });

    const mailgunKey = process.env.MAILGUN_API_KEY;
    const mailgunDomain = process.env.MAILGUN_DOMAIN;

    const results = [];
    const newLeads = sequence.leads.filter(l => l.status === 'NEW');

    for (const lead of newLeads) {
      try {
        const step = steps[0]; // Run first step (could be extended to track per-lead step index)
        const emailBody = step.body || `Hi ${lead.name}, we'd love to connect.`;
        const emailSubject = step.subject || 'Quick note from Ashbi Design';

        if (mailgunKey && mailgunDomain) {
          const formData = new URLSearchParams();
          formData.append('from', 'Cameron Ashley <cameron@ashbi.ca>');
          formData.append('to', `${lead.name} <${lead.email}>`);
          formData.append('subject', emailSubject);
          formData.append('text', emailBody);

          const mgRes = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`api:${mailgunKey}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString()
          });

          if (mgRes.ok) {
            await prisma.outreachLead.update({
              where: { id: lead.id },
              data: { status: 'CONTACTED', lastContactedAt: new Date() }
            });
            results.push({ leadId: lead.id, email: lead.email, sent: true });
          } else {
            results.push({ leadId: lead.id, email: lead.email, sent: false, error: 'Mailgun error' });
          }
        } else {
          // Dry run — no Mailgun configured
          await prisma.outreachLead.update({
            where: { id: lead.id },
            data: { status: 'CONTACTED', lastContactedAt: new Date() }
          });
          results.push({ leadId: lead.id, email: lead.email, sent: true, dryRun: true });
        }
      } catch (err) {
        results.push({ leadId: lead.id, email: lead.email, sent: false, error: err.message });
      }
    }

    return {
      sequenceId: id,
      processed: results.length,
      sent: results.filter(r => r.sent).length,
      failed: results.filter(r => !r.sent).length,
      results
    };
  });
}
