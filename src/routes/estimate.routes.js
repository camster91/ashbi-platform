import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import env from '../config/env.js';
import { validateBody, createEstimateSchema, updateEstimateSchema } from '../validators/schemas.js';

export default async function estimateRoutes(fastify) {
  // List estimates
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { clientId, status } = request.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;

    const estimates = await request.prisma.estimate.findMany({
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
    const estimate = await request.prisma.estimate.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { id: true, name: true, email: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    return estimate;
  });

  // Create estimate
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(createEstimateSchema)]
  }, async (request, reply) => {
    const { clientId, title, description, lineItems, tax, validUntil } = request.body;
    if (!clientId || !title) {
      return reply.status(400).send({ error: 'Client and title are required' });
    }

    const items = lineItems || [];
    const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.rate), 0);
    const taxAmount = tax || 0;
    const total = subtotal + taxAmount;

    const estimate = await request.prisma.estimate.create({
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
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(updateEstimateSchema)]
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.estimate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    if (existing.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft estimates can be edited' });

    const { title, description, lineItems, tax, validUntil, status } = request.body;
    const items = lineItems || existing.lineItems;
    const subtotal = Array.isArray(items) ? items.reduce((sum, i) => sum + (i.quantity * i.rate), 0) : existing.subtotal;
    const taxAmount = tax ?? existing.tax;
    const total = subtotal + taxAmount;

    const estimate = await request.prisma.estimate.update({
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
    onRequest: [fastify.authenticate],
    preHandler: validateBody(estimateUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.estimate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    await request.prisma.estimate.delete({ where: { id } });
    return { success: true };
  });

  // Send estimate to client
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const estimate = await request.prisma.estimate.findUnique({
      where: { id },
      include: { client: true }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (estimate.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft estimates can be sent' });

    const updated = await request.prisma.estimate.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
      include: { client: { select: { id: true, name: true } } }
    });

    // Send estimate email with magic link to client
    const portalUrl = `${process.env.FRONTEND_URL || 'https://hub.ashbi.ca'}/portal/estimate/${estimate.viewToken}`;
    const env = fastify.utils.getEnvConfig ? fastify.utils.getEnvConfig() : { mailgunApiKey: null, mailgunDomain: null };

    if (env.mailgunApiKey && env.mailgunDomain && estimate.client?.email) {
      try {
        const mg = new Mailgun(FormData);
        const mgClient = mg.client({
          username: 'api',
          key: env.mailgunApiKey
        });

        await mgClient.messages.create(env.mailgunDomain, {
          from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
          to: estimate.client.email,
          subject: `Estimate from Ashbi Design — $${updated.totalAmount.toLocaleString()}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:40px;border-radius:12px;">
              <h2 style="color:#c9a84c;margin-top:0;">New Estimate from Ashbi Design</h2>
              <p>Hello ${estimate.client.name},</p>
              <p>We've prepared an estimate for you. Please review and approve or decline at your convenience.</p>
              <p><strong>Amount:</strong> $${updated.totalAmount.toLocaleString()}</p>
              <p><strong>Status:</strong> Pending your review</p>
              <a href="${portalUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c9a84c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View & Approve Estimate</a>
              <p style="font-size:14px;color:#94a3b8;">Or copy this link: <code style="color:#e2e8f0;word-break:break-all;">${portalUrl}</code></p>
              <p style="font-size:12px;color:#94a3b8;">This estimate will expire in 30 days.</p>
            </div>
          `
        });
        console.log(`[estimate] Estimate email sent to ${estimate.client.email}`);
      } catch (mailErr) {
        console.error('[estimate] Failed to send estimate email:', mailErr.message || mailErr);
      }
    } else {
      console.warn('[estimate] Mailgun not configured or no client email — estimate email not sent');
      console.log(`[estimate] Dev mode — estimate link: ${portalUrl}`);
    }

    return updated;
  });

  // Public view by token
  fastify.get('/view/:viewToken, { config: { public: true } }', async (request, reply) => {
    const estimate = await request.prisma.estimate.findUnique({
      where: { viewToken: request.params.viewToken },
      include: { client: { select: { id: true, name: true, email: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    return estimate;
  });

  // Client approve/decline estimate
  fastify.post('/view/:viewToken/approve, { config: { public: true } }', async (request, reply) => {
    const { viewToken } = request.params;
    const { action } = request.body; // 'approve' or 'decline'
    if (!['approve', 'decline'].includes(action)) {
      return reply.status(400).send({ error: 'Action must be approve or decline' });
    }

    const estimate = await request.prisma.estimate.findUnique({ where: { viewToken } });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (estimate.status !== 'SENT') return reply.status(400).send({ error: 'Estimate is not in a state that can be responded to' });

    const newStatus = action === 'approve' ? 'APPROVED' : 'DECLINED';
    const updated = await request.prisma.estimate.update({
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
    const estimate = await request.prisma.estimate.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (!['APPROVED', 'SENT'].includes(estimate.status)) {
      return reply.status(400).send({ error: 'Only approved or sent estimates can be converted' });
    }

    const proposal = await request.prisma.proposal.create({
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

    await request.prisma.estimate.update({
      where: { id },
      data: { status: 'CONVERTED' }
    });

    return { proposal, estimateId: id };
  });
}