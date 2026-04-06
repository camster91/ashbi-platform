// Proposal routes

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { prisma } from '../index.js';

async function sendProposalEmail(to, clientName, proposalTitle, portalUrl) {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return;
  try {
    const mg = new Mailgun(FormData);
    const client = mg.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
    await client.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `Ashbi Design <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to,
      subject: `Your Proposal is Ready — ${proposalTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a1a;">Hi ${clientName},</h2>
          <p style="color: #444; line-height: 1.6;">
            Your proposal from Ashbi Design is ready for review.
            Please take a moment to review the details and let us know if you have any questions.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${portalUrl}" style="background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              View Proposal
            </a>
          </div>
          <p style="color: #888; font-size: 13px;">
            You can approve, decline, or ask questions directly through the proposal page.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="color: #aaa; font-size: 12px;">Ashbi Design · Toronto, Canada · hub.ashbi.ca</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Proposal] Email send error:', err.message);
  }
}

export default async function proposalRoutes(fastify) {
  // List all proposals
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { clientId, status } = request.query;

    const where = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;

    const proposals = await prisma.proposal.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: {
          select: { lineItems: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return proposals;
  });

  // Get single proposal with all relations
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        client: true,
        project: true,
        lineItems: true,
        createdBy: { select: { id: true, name: true } },
        contract: true
      }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    return proposal;
  });

  // Create proposal
  fastify.post('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { clientId, title, lineItems, notes, validUntil, projectId } = request.body;

    if (!clientId || !title || !lineItems || lineItems.length === 0) {
      return reply.status(400).send({ error: 'clientId, title, and at least one lineItem are required' });
    }

    const computedLineItems = lineItems.map(item => ({
      description: item.description,
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice,
      total: (item.quantity ?? 1) * item.unitPrice
    }));

    const subtotal = computedLineItems.reduce((sum, item) => sum + item.total, 0);
    const discount = request.body.discount || 0;
    const total = subtotal - discount;

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          title,
          clientId,
          projectId: projectId || null,
          createdById: request.user.id,
          notes: notes || null,
          validUntil: validUntil ? new Date(validUntil) : null,
          subtotal,
          discount,
          total,
          lineItems: {
            create: computedLineItems
          }
        },
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          lineItems: true,
          createdBy: { select: { id: true, name: true } }
        }
      });

      return created;
    });

    return reply.status(201).send(proposal);
  });

  // Update proposal (DRAFT only)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    if (existing.status !== 'DRAFT') {
      return reply.status(400).send({ error: 'Only DRAFT proposals can be updated' });
    }

    const { title, notes, validUntil, projectId, lineItems, discount } = request.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (notes !== undefined) data.notes = notes;
    if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null;
    if (projectId !== undefined) data.projectId = projectId || null;
    if (discount !== undefined) data.discount = discount;

    const proposal = await prisma.$transaction(async (tx) => {
      // If lineItems provided, replace them
      if (lineItems) {
        await tx.proposalLineItem.deleteMany({ where: { proposalId: id } });

        const computedLineItems = lineItems.map(item => ({
          description: item.description,
          quantity: item.quantity ?? 1,
          unitPrice: item.unitPrice,
          total: (item.quantity ?? 1) * item.unitPrice,
          proposalId: id
        }));

        await tx.proposalLineItem.createMany({ data: computedLineItems });

        const subtotal = computedLineItems.reduce((sum, item) => sum + item.total, 0);
        const currentDiscount = discount !== undefined ? discount : existing.discount;
        data.subtotal = subtotal;
        data.total = subtotal - currentDiscount;
      }

      const updated = await tx.proposal.update({
        where: { id },
        data,
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          lineItems: true,
          createdBy: { select: { id: true, name: true } }
        }
      });

      return updated;
    });

    return proposal;
  });

  // Delete proposal (DRAFT only)
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    if (existing.status !== 'DRAFT') {
      return reply.status(400).send({ error: 'Only DRAFT proposals can be deleted' });
    }

    await prisma.proposal.delete({ where: { id } });

    return { success: true };
  });

  // Send proposal (mark as SENT)
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const proposal = await prisma.proposal.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date()
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        },
        lineItems: true
      }
    });

    // Email the primary contact
    const primaryEmail = proposal.client?.contacts?.[0]?.email;
    const primaryName = proposal.client?.contacts?.[0]?.name || proposal.client?.name;
    if (primaryEmail && proposal.viewToken) {
      const portalUrl = `${process.env.PORTAL_BASE_URL || 'https://hub.ashbi.ca'}/portal/proposal/${proposal.viewToken}`;
      await sendProposalEmail(primaryEmail, primaryName, proposal.title, portalUrl);
    }

    return proposal;
  });

  // Duplicate proposal
  fastify.post('/:id/duplicate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.proposal.findUnique({
      where: { id },
      include: { lineItems: true }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          title: `${existing.title} (Copy)`,
          clientId: existing.clientId,
          projectId: existing.projectId,
          createdById: request.user.id,
          notes: existing.notes,
          validUntil: existing.validUntil,
          subtotal: existing.subtotal,
          discount: existing.discount,
          total: existing.total,
          internalNotes: existing.internalNotes,
          lineItems: {
            create: existing.lineItems.map(item => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total
            }))
          }
        },
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          lineItems: true,
          createdBy: { select: { id: true, name: true } }
        }
      });

      return created;
    });

    return reply.status(201).send(proposal);
  });

  // PUBLIC: Client views proposal by viewToken
  fastify.get('/client/:viewToken', async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await prisma.proposal.findUnique({
      where: { viewToken },
      include: {
        client: true,
        lineItems: true,
        createdBy: { select: { name: true } }
      }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    // If status is SENT, update to VIEWED
    if (proposal.status === 'SENT') {
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: { status: 'VIEWED' }
      });
      proposal.status = 'VIEWED';
    }

    return proposal;
  });

  // PUBLIC: Client approves proposal
  fastify.post('/client/:viewToken/approve', async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await prisma.proposal.findUnique({
      where: { viewToken }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date()
      }
    });

    return updated;
  });

  // PUBLIC: Client declines proposal
  fastify.post('/client/:viewToken/decline', async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await prisma.proposal.findUnique({
      where: { viewToken }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date()
      }
    });

    return updated;
  });
}
