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
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { recordProposalApproved } from '../services/domain-event-producers.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';
import { deliveryFieldsFromSend, mailgunTrackingFields, withDeliveryState } from '../services/mailgun-delivery.service.js';

// Returns the provider result ({ ok, id?, error? }), or null when no send was
// attempted (test mode).
async function sendProposalEmail(to, clientName, proposalTitle, portalUrl, proposalId) {
  // ASHI_RUN_EMAIL_TESTS is intentionally read directly from process.env
  // (not env.*) because it is a developer-only test toggle and is never
  // wired into env.js. NODE_ENV === 'test' is also read directly because
  // env.isTest is not part of the public config surface; the explicit
  // test gate lives here.
  if (process.env.NODE_ENV === 'test' && process.env.ASHBI_RUN_EMAIL_TESTS !== '1') return null;
  if (!env.mailgunApiKey || !env.mailgunDomain) return { ok: false, error: 'Mailgun not configured' };
  try {
    const mg = new Mailgun(FormData);
    const client = mg.client({ username: 'api', key: env.mailgunApiKey });
    const sent = await client.messages.create(env.mailgunDomain, {
      ...mailgunTrackingFields({ documentType: 'proposal', documentId: proposalId }),
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
    return { ok: true, id: sent?.id };
  } catch (err) {
    logger.error({ errorName: err?.name, errorCode: err?.code }, '[Proposal] Email send error');
    return { ok: false, error: 'Proposal email send error' };
  }
}

async function recordProposalDelivery(prisma, proposalId, delivery) {
  if (!delivery) return null;
  const data = deliveryFieldsFromSend(delivery);
  await prisma.proposal.update({ where: { id: proposalId }, data });
  return data;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function computeProposalLineItems(lineItems) {
  return lineItems.map(item => {
    const quantity = item.quantity ?? 1;
    return {
      description: item.description,
      quantity,
      unitPrice: item.unitPrice,
      total: roundMoney(quantity * item.unitPrice),
    };
  });
}

// Subtotal from the line items; a discount can reduce the total to zero but
// never below it.
function proposalTotals(lineItems, discount = 0) {
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
  const total = roundMoney(Math.max(0, subtotal - (Number(discount) || 0)));
  return { subtotal, total };
}

export const PROPOSAL_BULK_SEND_MAX = 25;

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

    return withDeliveryState(proposal);
  });

  // Create proposal
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalCreateSchema),
  }, async (request, reply) => {
    const { clientId, title, lineItems, notes, validUntil, projectId } = request.body;

    const computedLineItems = computeProposalLineItems(lineItems);
    const discount = request.body.discount || 0;
    const { subtotal, total } = proposalTotals(computedLineItems, discount);

    const proposal = await request.prisma.$transaction(async (tx) => {
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

    const existing = await request.prisma.proposal.findUnique({ where: { id }, include: { lineItems: true } });

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

    // The snapshot records the line items the proposal has after this edit:
    // the replacements when provided, otherwise the unchanged stored ones.
    const computedLineItems = lineItems ? computeProposalLineItems(lineItems) : null;
    const snapshotLineItems = (computedLineItems || existing.lineItems || []).map(item => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    }));

    const proposal = await request.prisma.$transaction(async (tx) => {
      // If lineItems provided, replace them
      if (computedLineItems) {
        await tx.proposalLineItem.deleteMany({ where: { proposalId: id } });
        await tx.proposalLineItem.createMany({ data: computedLineItems.map(item => ({ ...item, proposalId: id })) });
      }
      if (computedLineItems || discount !== undefined) {
        // Totals are always derived on the server from the line items and
        // discount that will be stored, never taken from the request.
        const effectiveDiscount = discount !== undefined ? discount : (existing.discount || 0);
        const totals = computedLineItems
          ? proposalTotals(computedLineItems, effectiveDiscount)
          : proposalTotals(existing.lineItems || [], effectiveDiscount);
        data.subtotal = totals.subtotal;
        data.total = totals.total;
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
            lineItems: snapshotLineItems
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

  // Single path for sending a draft proposal (POST /:id/send and bulk send):
  // issue the public link, email the primary contact, record delivery.
  // Returns { statusCode, body } so bulk send can report per item.
  async function sendDraftProposal(request, id) {
    const existing = await request.prisma.proposal.findUnique({ where: { id } });

    if (!existing) {
      return { statusCode: 404, body: { error: 'Proposal not found' } };
    }

    if (existing.status !== 'DRAFT') {
      return { statusCode: 400, body: { error: 'Only draft proposals can be sent', code: 'ALREADY_SENT' } };
    }
    if (existing.validUntil && new Date(existing.validUntil) <= new Date()) {
      return { statusCode: 409, body: { error: 'Proposal validity date must be extended before sending' } };
    }
    const access = createPublicAccessWindow(existing.validUntil);
    // Claim DRAFT -> SENT with the new token before emailing, so concurrent
    // sends (single or bulk) email the client once, with the stored link.
    const claimed = await request.prisma.proposal.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: access.revokedAt,
      },
    });
    if (claimed.count !== 1) {
      return { statusCode: 409, body: { error: 'Proposal is already being sent or was sent', code: 'ALREADY_SENT' } };
    }
    const proposal = await request.prisma.proposal.findUnique({
      where: { id },
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
    let deliveryFields = null;
    if (primaryEmail && proposal.viewToken) {
      const portalUrl = `${env.portalBaseUrl}/portal/proposal/${proposal.viewToken}`;
      const delivery = await sendProposalEmail(primaryEmail, primaryName, proposal.title, portalUrl, proposal.id);
      emailSent = Boolean(delivery?.ok);
      deliveryFields = await recordProposalDelivery(request.prisma, proposal.id, delivery);
    }

    return { statusCode: 200, body: withDeliveryState({ ...proposal, ...deliveryFields, emailSent }) };
  }

  // Send proposal (mark as SENT)
  fastify.post('/:id/send', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { statusCode, body } = await sendDraftProposal(request, request.params.id);
    return reply.status(statusCode).send(body);
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
    const delivery = await sendProposalEmail(contact.email, contact.name || proposal.client.name, proposal.title, portalUrl, proposal.id);
    await recordProposalDelivery(request.prisma, proposal.id, delivery);
    if (!delivery?.ok) return reply.status(503).send({ error: 'Proposal email delivery is unavailable', retryable: true });
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
      deliveryMessageId,
      deliveryError,
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

    // Compare-and-set so a concurrent second approval cannot also succeed
    // (and cannot write a second audit event).
    // The approval and its outbox event (docs/event-outbox.md) commit together.
    const approvedAt = new Date();
    const transitioned = await request.prisma.$transaction(async (tx) => {
      const result = await tx.proposal.updateMany({
        where: { id: proposal.id, status: { in: ['SENT', 'VIEWED'] }, publicAccessRevokedAt: null },
        data: {
          status: 'APPROVED',
          approvedAt,
          publicAccessRevokedAt: approvedAt,
        }
      });
      if (result.count === 1) {
        await recordProposalApproved(tx, { proposal, via: 'public_link', approvedAt, correlationId: request.id });
      }
      return result;
    });
    if (transitioned.count !== 1) {
      return reply.status(409).send({ error: 'Proposal is not awaiting approval' });
    }

    // Public capability-link action: the actor is the client holding the link,
    // not a signed-in user, and the tenant comes from the proposal's client.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'proposal.approved',
      actorType: 'CLIENT',
      actorUserId: null,
      organizationId: null,
      ownerClientId: proposal.clientId,
      entityId: proposal.id,
      metadata: { fromStatus: proposal.status, toStatus: 'APPROVED', total: proposal.total, via: 'public_link' },
    });

    return { status: 'APPROVED', approvedAt };
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
    // Sequential emails per proposal: capped to stay inside request timeouts.
    if (ids.length > PROPOSAL_BULK_SEND_MAX) {
      return reply.status(400).send({ error: `Send at most ${PROPOSAL_BULK_SEND_MAX} proposals per request` });
    }

    // Same path as a single send for each proposal; one failure never stops
    // the rest.
    const results = [];
    for (const id of ids) {
      try {
        const { statusCode, body } = await sendDraftProposal(request, id);
        results.push(statusCode === 200
          ? { id, ok: true, statusCode, emailSent: body.emailSent }
          : { id, ok: false, statusCode, error: body.error, ...(body.code === 'ALREADY_SENT' ? { reason: 'already_sent' } : {}) });
      } catch (err) {
        logger.error({ err, proposalId: id }, 'Bulk proposal send failed for one proposal');
        results.push({ id, ok: false, statusCode: 500, error: 'Proposal could not be sent' });
      }
    }

    return { sent: results.filter((result) => result.ok).length, results };
  });
}
