// Landing page lead capture route — public endpoint, no auth required

export default async function landingRoutes(fastify) {
  // POST /api/leads/landing — capture lead from landing page
  fastify.post('/leads/landing', async (request, reply) => {
    const { name, email, company, phone, budget, message } = request.body || {};

    // Validate required fields
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return reply.status(400).send({ error: 'Email is required' });
    }
    if (!message || !message.trim()) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({ error: 'Please provide a valid email address' });
    }

    // Create lead
    const lead = await fastify.prisma.lead.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        company: company?.trim() || null,
        phone: phone?.trim() || null,
        budget: budget || null,
        message: message.trim(),
        status: 'NEW',
      },
    });

    return {
      success: true,
      lead: { id: lead.id, name: lead.name },
      message: 'Thank you for your message. We will be in touch within 24 hours.',
    };
  });

  // GET /api/leads/landing — list leads (admin only)
  fastify.get('/leads/landing', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const leads = await fastify.prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return leads;
  });

  // PATCH /api/leads/landing/:id — update lead status
  fastify.patch('/leads/landing/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { status } = request.body || {};

    const lead = await fastify.prisma.lead.findUnique({
      where: { id: request.params.id },
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const updated = await fastify.prisma.lead.update({
      where: { id: request.params.id },
      data: { status },
    });

    return updated;
  });
}