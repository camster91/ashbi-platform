// Lead intake routes — public intake + admin management

import { queueEmailForProcessing } from '../jobs/queue.js';

export default async function leadRoutes(fastify) {
  // POST /leads/intake — public endpoint, no auth
  fastify.post('/leads/intake', async (request, reply) => {
    const { name, email, company, message, source } = request.body || {};

    if (!name || !email || !message) {
      return reply.status(400).send({ error: 'name, email, and message are required' });
    }

    // Create as unmatched email (inbound lead)
    const lead = await fastify.prisma.unmatchedEmail.create({
      data: {
        senderEmail: email,
        senderName: name,
        subject: company ? `Lead from ${company}` : `Lead from ${name}`,
        bodyText: message,
        status: 'PENDING',
        suggestedClients: JSON.stringify({ source: source || 'web', company: company || null })
      }
    });

    // Queue for AI analysis
    try {
      await queueEmailForProcessing({
        from: email,
        fromName: name,
        subject: lead.subject,
        text: message,
        unmatchedEmailId: lead.id
      });
    } catch (err) {
      // Queue may not be available — lead is still saved
      console.error('Failed to queue lead for processing:', err.message);
    }

    return { received: true, message: 'Thank you, we will be in touch shortly.' };
  });

  // GET /leads — admin only, list pending leads
  fastify.get('/leads', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const leads = await fastify.prisma.unmatchedEmail.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });

    return leads;
  });

  // PATCH /leads/:id/convert — convert lead to client
  fastify.patch('/leads/:id/convert', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const lead = await fastify.prisma.unmatchedEmail.findUnique({
      where: { id: request.params.id }
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    if (lead.status !== 'PENDING') {
      return reply.status(400).send({ error: 'Lead has already been resolved' });
    }

    // Parse company from suggestedClients metadata
    let company = null;
    try {
      const meta = JSON.parse(lead.suggestedClients || '{}');
      company = meta.company;
    } catch { /* ignore */ }

    const domain = lead.senderEmail.split('@')[1] || null;

    // Create client
    const client = await fastify.prisma.client.create({
      data: {
        name: company || lead.senderName || lead.senderEmail,
        domain,
        status: 'ACTIVE'
      }
    });

    // Create contact
    const contact = await fastify.prisma.contact.create({
      data: {
        email: lead.senderEmail,
        name: lead.senderName || lead.senderEmail,
        isPrimary: true,
        clientId: client.id
      }
    });

    // Mark lead as resolved
    await fastify.prisma.unmatchedEmail.update({
      where: { id: lead.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() }
    });

    return { client, contact };
  });
}
