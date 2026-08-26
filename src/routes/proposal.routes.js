// Proposal routes

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { softDelete } from '../services/trash.service.js';
import { queueEmbedding } from '../jobs/queue.js';
import {
  validateBody,
  proposalCreateSchema,
  proposalUpdateSchema,
  proposalBulkIdsSchema,
} from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';

async function sendProposalEmail(to, clientName, proposalTitle, portalUrl) {
  // ASHI_RUN_EMAIL_TESTS is intentionally read directly from process.env
  // (not env.*) because it is a developer-only test toggle and is never
  // wired into env.js. NODE_ENV === 'test' is also read directly because
  // env.isTest is not part of the public config surface; the explicit
  // test gate lives here.
  if (process.env.NODE_ENV === 'test' && process.env.ASHBI_RUN_EMAIL_TESTS !== '1') return false;
  if (!env.mailgunApiKey || !env.mailgunDomain) return false;
  try {
    const mg = new Mailgun(FormData);
    const client = mg.client({ username: 'api', key: env.mailgunApiKey });
    await client.messages.create(env.mailgunDomain, {
      from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
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
    return true;
  } catch (err) {
    logger.error({ err, to, proposalTitle }, '[Proposal] Email send error');
    return false;
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

    const proposals = await request.prisma.proposal.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: {
          select: { lineItems: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: clampTake(request.query.limit),
    });

    return proposals;
  });

  // Get single proposal with all relations
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const proposal = await request.prisma.proposal.findUnique({
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
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalCreateSchema),
  }, async (request, reply) => {
    const { clientId, title, lineItems, notes, validUntil, projectId, currency } = request.body;

    const computedLineItems = lineItems.map(item => ({
      description: item.description,
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice,
      total: (item.quantity ?? 1) * item.unitPrice
    }));

    const subtotal = computedLineItems.reduce((sum, item) => sum + item.total, 0);
    const discount = request.body.discount || 0;
    const total = subtotal - discount;

    const proposal = await request.prisma.$transaction(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          title,
          currency,
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

    // Auto-embed proposal for Client Brain
    queueEmbedding(clientId, `Proposal: ${title} - ${notes || ''}`, 'PROPOSAL', proposal.id, { status: proposal.status, total }).catch(err =>
      logger.error({ err, proposalId: proposal.id }, 'Failed to queue proposal embedding')
    );

    return reply.status(201).send(proposal);
  });

  // Update proposal (DRAFT only)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalUpdateSchema),
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    if (existing.status !== 'DRAFT') {
      return reply.status(400).send({ error: 'Only DRAFT proposals can be updated' });
    }

    const { title, notes, validUntil, projectId, lineItems, discount, currency } = request.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (notes !== undefined) data.notes = notes;
    if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null;
    if (projectId !== undefined) data.projectId = projectId || null;
    if (discount !== undefined) data.discount = discount;
    if (currency !== undefined) data.currency = currency;

    const proposal = await request.prisma.$transaction(async (tx) => {
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

      // Create a version snapshot
      await tx.proposalVersion.create({
        data: {
          proposalId: id,
          createdById: request.user.id,
          data: {
            title: updated.title,
            notes: updated.notes,
            discount: updated.discount,
            subtotal: updated.subtotal,
            total: updated.total,
            status: updated.status,
            lineItems: computedLineItems || existing.lineItems
          }
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

    const existing = await request.prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    if (existing.status !== 'DRAFT') {
      return reply.status(400).send({ error: 'Only DRAFT proposals can be deleted' });
    }

    const { trashedItem } = await softDelete({
      scopedPrisma: request.prisma,
      entity: 'PROPOSAL',
      recordId: id,
      organizationId: request.user.organizationId,
    });

    return { success: true, trashId: trashedItem.id };
  });

  // Send proposal (mark as SENT)
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    if (existing.status !== 'DRAFT') {
      return reply.status(400).send({ error: 'Only draft proposals can be sent' });
    }
    if (existing.validUntil && new Date(existing.validUntil) <= new Date()) {
      return reply.status(409).send({ error: 'Proposal validity date must be extended before sending' });
    }
    const access = createPublicAccessWindow(existing.validUntil);
    const proposal = await request.prisma.proposal.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: access.revokedAt,
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
    let emailSent = false;
    if (primaryEmail && proposal.viewToken) {
      const portalUrl = `${env.portalBaseUrl}/portal/proposal/${proposal.viewToken}`;
      emailSent = await sendProposalEmail(primaryEmail, primaryName, proposal.title, portalUrl);
    }

    return { ...proposal, emailSent };
  });

  fastify.post('/:id/resend', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const proposal = await request.prisma.proposal.findUnique({
      where: { id: request.params.id },
      include: { client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } } },
    });
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });
    if (!['SENT', 'VIEWED'].includes(proposal.status)) return reply.status(409).send({ error: 'Only sent proposals can be resent' });
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    const contact = proposal.client?.contacts?.[0];
    if (!contact?.email) return reply.status(409).send({ error: 'Primary client email is missing' });
    const portalUrl = `${env.portalBaseUrl}/portal/proposal/${proposal.viewToken}`;
    const emailSent = await sendProposalEmail(contact.email, contact.name || proposal.client.name, proposal.title, portalUrl);
    if (!emailSent) return reply.status(503).send({ error: 'Proposal email delivery is unavailable', retryable: true });
    return { emailSent: true };
  });

  // Duplicate proposal
  fastify.post('/:id/duplicate', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await request.prisma.proposal.findUnique({
      where: { id },
      include: { lineItems: true }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const proposal = await request.prisma.$transaction(async (tx) => {
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
          currency: existing.currency,
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

  // ─── GET /:id/versions — list all versions for a proposal ────────────────
  fastify.get('/:id/versions', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const proposal = await request.prisma.proposal.findUnique({ where: { id } });
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });

    const versions = await request.prisma.proposalVersion.findMany({
      where: { proposalId: id },
      include: {
        createdBy: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return versions;
  });

  // ─── POST /:id/versions/:versionId/restore — restore a specific version ───
  fastify.post('/:id/versions/:versionId/restore', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id, versionId } = request.params;

    const existing = await request.prisma.proposal.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Proposal not found' });
    if (existing.status !== 'DRAFT') return reply.status(400).send({ error: 'Only DRAFT proposals can be restored to a version' });

    const version = await request.prisma.proposalVersion.findFirst({
      where: { id: versionId, proposalId: id }
    });
    if (!version) return reply.status(404).send({ error: 'Version not found' });

    const versionData = version.data;

    const updated = await request.prisma.$transaction(async (tx) => {
      // Replace line items
      await tx.proposalLineItem.deleteMany({ where: { proposalId: id } });

      if (versionData.lineItems && versionData.lineItems.length > 0) {
        await tx.proposalLineItem.createMany({
          data: versionData.lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice,
            total: (item.quantity ?? 1) * item.unitPrice,
            proposalId: id
          }))
        });
      }

      const restored = await tx.proposal.update({
        where: { id },
        data: {
          title: versionData.title ?? existing.title,
          notes: versionData.notes ?? existing.notes,
          discount: versionData.discount ?? existing.discount,
          subtotal: versionData.subtotal ?? existing.subtotal,
          total: versionData.total ?? existing.total
        },
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          lineItems: true,
          createdBy: { select: { id: true, name: true } }
        }
      });

      return restored;
    });

    return updated;
  });

  // PUBLIC: Client views proposal by viewToken
  fastify.get('/client/:viewToken', { config: { public: true } }, async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await request.prisma.proposal.findUnique({
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
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    // If status is SENT, update to VIEWED
    if (proposal.status === 'SENT') {
      await request.prisma.proposal.update({
        where: { id: proposal.id },
        data: { status: 'VIEWED' }
      });
      proposal.status = 'VIEWED';
    }

    const {
      internalNotes,
      createdById,
      clientId,
      projectId,
      viewToken: storedToken,
      aiPrompt,
      metadata,
      draftData,
      deletedAt,
      ...publicProposal
    } = proposal;
    return publicProposal;
  });

  // PUBLIC: Client approves proposal
  fastify.post('/client/:viewToken/approve', { config: { public: true } }, async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await request.prisma.proposal.findUnique({
      where: { viewToken }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (!['SENT', 'VIEWED'].includes(proposal.status)) {
      return reply.status(409).send({ error: 'Proposal is not awaiting approval' });
    }

    const updated = await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        publicAccessRevokedAt: new Date(),
      }
    });

    return { status: updated.status, approvedAt: updated.approvedAt };
  });

  // PUBLIC: Client declines proposal
  fastify.post('/client/:viewToken/decline', { config: { public: true } }, async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await request.prisma.proposal.findUnique({
      where: { viewToken }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (!['SENT', 'VIEWED'].includes(proposal.status)) {
      return reply.status(409).send({ error: 'Proposal is not awaiting a decision' });
    }

    const updated = await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        publicAccessRevokedAt: new Date(),
      }
    });

    return { status: updated.status, declinedAt: updated.declinedAt };
  });

  fastify.post('/:id/public-link/revoke', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const proposal = await request.prisma.proposal.findUnique({ where: { id: request.params.id } });
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });
    await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: { publicAccessRevokedAt: new Date() },
    });
    return { revoked: true };
  });

  fastify.post('/:id/public-link/rotate', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const proposal = await request.prisma.proposal.findUnique({ where: { id: request.params.id } });
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });
    if (!['SENT', 'VIEWED'].includes(proposal.status)) return reply.status(409).send({ error: 'Proposal is not awaiting a decision' });
    const access = createPublicAccessWindow(proposal.validUntil);
    const updated = await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: { viewToken: access.token, publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null },
      select: { viewToken: true, publicAccessExpiresAt: true },
    });
    return updated;
  });

  // ─── POST /bulk/archive — bulk delete proposals ────────────────────────────
  fastify.post('/bulk/archive', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalBulkIdsSchema),
  }, async (request, reply) => {
    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    const result = await request.prisma.proposal.deleteMany({
      where: { id: { in: ids }, status: 'DRAFT' }
    });

    return { archived: result.count };
  });

  // ─── POST /bulk/send — bulk send proposals ─────────────────────────────────
  fastify.post('/bulk/send', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalBulkIdsSchema),
  }, async (request, reply) => {
    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    const result = await request.prisma.proposal.updateMany({
      where: { id: { in: ids }, status: 'DRAFT' },
      data: { status: 'SENT', sentAt: new Date() }
    });

    return { sent: result.count };
  });
}
