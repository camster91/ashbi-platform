// Lead management routes (admin)

export default async function leadRoutes(fastify) {
  // Public inquiries arrive through /api/client-acquisition/intake. The old
  // anonymous /leads/intake route here was removed: it created leads with no
  // organization, so every submission failed.

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
