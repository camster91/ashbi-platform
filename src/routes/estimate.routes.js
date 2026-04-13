import { prisma } from '../index.js';

export default async function estimateRoutes(fastify) {
  // List estimates
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { clientId, status } = request.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;

    const estimates = await prisma.estimate.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });

    return { estimates };
  });

  // Get single estimate
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const estimate = await prisma.estimate.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { id: true, name: true, email: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    return estimate;
  });

  // Create estimate
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId, title, description, lineItems, tax, validUntil } = request.body;
    if (!clientId || !title) {
      return reply.status(400).send({ error: 'Client and title are required' });
    }

    const items = lineItems || [];
    const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.rate), 0);
    const taxAmount = tax || 0;
    const total = subtotal + taxAmount;

    const estimate = await prisma.estimate.create({
      data: {
        clientId,
        title,
        description,
        lineItems: items,
        subtotal,
        tax: taxAmount,
        total,
        validUntil: validUntil ? new Date(validUntil) : null
      },
      include: { client: { select: { id: true, name: true } } }
    });

    return reply.status(201).send(estimate);
  });

  // Update estimate
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.estimate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    if (existing.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft estimates can be edited' });

    const { title, description, lineItems, tax, validUntil, status } = request.body;
    const items = lineItems || existing.lineItems;
    const subtotal = Array.isArray(items) ? items.reduce((sum, i) => sum + (i.quantity * i.rate), 0) : existing.subtotal;
    const taxAmount = tax ?? existing.tax;
    const total = subtotal + taxAmount;

    const estimate = await prisma.estimate.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(lineItems !== undefined && { lineItems: items }),
        subtotal,
        tax: taxAmount,
        total,
        ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
        ...(status !== undefined && { status })
      },
      include: { client: { select: { id: true, name: true } } }
    });

    return estimate;
  });

  // Delete estimate
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.estimate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    await prisma.estimate.delete({ where: { id } });
    return { success: true };
  });

  // Send estimate to client
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { client: true }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (estimate.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft estimates can be sent' });

    const updated = await prisma.estimate.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
      include: { client: { select: { id: true, name: true } } }
    });

    // TODO: Send email with magic link to client
    // const portalUrl = `${process.env.FRONTEND_URL || 'https://hub.ashbi.ca'}/portal/estimate/${estimate.viewToken}`;

    return updated;
  });

  // Public view by token
  fastify.get('/view/:viewToken', async (request, reply) => {
    const estimate = await prisma.estimate.findUnique({
      where: { viewToken: request.params.viewToken },
      include: { client: { select: { id: true, name: true, email: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    return estimate;
  });

  // Client approve/decline estimate
  fastify.post('/view/:viewToken/approve', async (request, reply) => {
    const { viewToken } = request.params;
    const { action } = request.body; // 'approve' or 'decline'
    if (!['approve', 'decline'].includes(action)) {
      return reply.status(400).send({ error: 'Action must be approve or decline' });
    }

    const estimate = await prisma.estimate.findUnique({ where: { viewToken } });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (estimate.status !== 'SENT') return reply.status(400).send({ error: 'Estimate is not in a state that can be responded to' });

    const newStatus = action === 'approve' ? 'APPROVED' : 'DECLINED';
    const updated = await prisma.estimate.update({
      where: { viewToken },
      data: { status: newStatus }
    });

    return updated;
  });

  // Convert estimate to proposal
  fastify.post('/:id/convert', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (!['APPROVED', 'SENT'].includes(estimate.status)) {
      return reply.status(400).send({ error: 'Only approved or sent estimates can be converted' });
    }

    const proposal = await prisma.proposal.create({
      data: {
        title: estimate.title,
        content: estimate.description || '',
        clientId: estimate.clientId,
        lineItems: estimate.lineItems,
        subtotal: estimate.subtotal,
        tax: estimate.tax,
        total: estimate.total,
        status: 'DRAFT'
      }
    });

    await prisma.estimate.update({
      where: { id },
      data: { status: 'CONVERTED' }
    });

    return { proposal, estimateId: id };
  });
}