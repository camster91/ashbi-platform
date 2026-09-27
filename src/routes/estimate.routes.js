import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import env from '../config/env.js';
import { validateBody, createEstimateSchema, updateEstimateSchema, estimatePublicResponseSchema } from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { softDelete } from '../services/trash.service.js';
import { deliveryFieldsFromSend, mailgunTrackingFields, withDeliveryState } from '../services/mailgun-delivery.service.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';
import { recordAuditEvent, recordRequestAuditEvent } from '../services/audit-event.service.js';

// Estimates a client may see through the public link. A DRAFT is never public,
// whatever token it holds.
const PUBLIC_ESTIMATE_STATUSES = ['SENT', 'APPROVED', 'DECLINED', 'CONVERTED'];
// Per-IP limits for the unauthenticated link routes (on top of the global
// /api limit): enough for a client opening and answering their estimate.
const PUBLIC_VIEW_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const PUBLIC_RESPOND_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

/** The explicit public shape: no internal ids, drafts, delivery data or tokens. */
export function publicEstimateView(estimate) {
  const lineItems = Array.isArray(estimate.lineItems) ? estimate.lineItems : [];
  return {
    title: estimate.title,
    description: estimate.description ?? null,
    status: estimate.status,
    lineItems: lineItems.map((item) => ({
      description: typeof item?.description === 'string' ? item.description : '',
      quantity: Number(item?.quantity) || 0,
      rate: Number(item?.rate) || 0,
      amount: Number(item?.amount ?? (Number(item?.quantity) || 0) * (Number(item?.rate) || 0)) || 0,
    })),
    subtotal: estimate.subtotal,
    tax: estimate.tax,
    total: estimate.total,
    validUntil: estimate.validUntil ?? null,
    sentAt: estimate.sentAt ?? null,
    createdAt: estimate.createdAt,
    clientName: estimate.client?.name ?? null,
  };
}

/** Why a public link cannot be used, or null. Unknown and draft look the same. */
function publicEstimateFailure(estimate, now = new Date()) {
  if (!estimate || !PUBLIC_ESTIMATE_STATUSES.includes(estimate.status)) {
    return { statusCode: 404, error: 'Estimate not found' };
  }
  const access = publicAccessFailure(estimate, now);
  if (access) return access.statusCode === 404 ? { statusCode: 404, error: 'Estimate not found' } : access;
  return null;
}

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
      orderBy: { createdAt: 'desc' },
      take: clampTake(request.query.limit),
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
    return withDeliveryState(estimate);
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
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.estimate.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    const { trashedItem } = await softDelete({
      scopedPrisma: request.prisma,
      entity: 'ESTIMATE',
      recordId: id,
      organizationId: request.user.organizationId,
    });
    return { success: true, trashId: trashedItem.id };
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

    // Issue a fresh 256-bit link that expires with the estimate (or in 30
    // days); the placeholder token created with the draft is never public.
    const access = createPublicAccessWindow(estimate.validUntil);
    const updated = await request.prisma.estimate.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: null,
      },
      include: { client: { select: { id: true, name: true } } }
    });

    // Send estimate email with magic link to client
    const portalUrl = `${env.hubUrl}/portal/estimate/${access.token}`;
    let deliveryFields = null;

    if (env.mailgunApiKey && env.mailgunDomain && estimate.client?.email) {
      try {
        const mg = new Mailgun(FormData);
        const mgClient = mg.client({
          username: 'api',
          key: env.mailgunApiKey
        });

        const sent = await mgClient.messages.create(env.mailgunDomain, {
          ...mailgunTrackingFields({ documentType: 'estimate', documentId: estimate.id }),
          from: `Ashbi Design <noreply@${env.mailgunDomain}>`,
          to: estimate.client.email,
          subject: `Estimate from Ashbi Design — $${updated.total.toLocaleString()}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:40px;border-radius:12px;">
              <h2 style="color:#c9a84c;margin-top:0;">New Estimate from Ashbi Design</h2>
              <p>Hello ${estimate.client.name},</p>
              <p>We've prepared an estimate for you. Please review and approve or decline at your convenience.</p>
              <p><strong>Amount:</strong> $${updated.total.toLocaleString()}</p>
              <p><strong>Status:</strong> Pending your review</p>
              <a href="${portalUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c9a84c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View & Approve Estimate</a>
              <p style="font-size:14px;color:#94a3b8;">Or copy this link: <code style="color:#e2e8f0;word-break:break-all;">${portalUrl}</code></p>
              <p style="font-size:12px;color:#94a3b8;">This estimate will expire in 30 days.</p>
            </div>
          `
        });
        console.log(`[estimate] Estimate email sent to ${estimate.client.email}`);
        deliveryFields = deliveryFieldsFromSend({ ok: true, id: sent?.id });
      } catch (mailErr) {
        console.error('[estimate] Failed to send estimate email:', mailErr.message || mailErr);
        deliveryFields = deliveryFieldsFromSend({ ok: false, error: 'Estimate email send error' });
      }
      try {
        await request.prisma.estimate.update({ where: { id }, data: deliveryFields });
      } catch (recordErr) {
        // The email outcome is already decided; a tracking write failure must
        // not turn a completed send into a 500.
        request.log.error({ errorName: recordErr?.name, errorCode: recordErr?.code, estimateId: id }, '[estimate] Failed to record email delivery status');
      }
    } else {
      console.warn('[estimate] Mailgun not configured or no client email — estimate email not sent');
      // The view token lets anyone approve or decline the estimate. Never write
      // it to logs; staff can recover it from the authenticated response below.
    }

    return withDeliveryState({ ...updated, ...deliveryFields });
  });

  // Public view by token (capability link: expiring, revocable, never a draft)
  fastify.get('/view/:viewToken', { config: { public: true, ...PUBLIC_VIEW_RATE_LIMIT } }, async (request, reply) => {
    const estimate = await request.prisma.estimate.findUnique({
      where: { viewToken: request.params.viewToken },
      include: { client: { select: { name: true } } },
    });
    const failure = publicEstimateFailure(estimate);
    if (failure) return reply.status(failure.statusCode).send({ error: failure.error });
    return publicEstimateView(estimate);
  });

  // Client approve/decline estimate
  fastify.post('/view/:viewToken/approve', {
    config: { public: true, ...PUBLIC_RESPOND_RATE_LIMIT },
    preHandler: validateBody(estimatePublicResponseSchema),
  }, async (request, reply) => {
    const { viewToken } = request.params;
    const { action } = request.body;

    const estimate = await request.prisma.estimate.findUnique({
      where: { viewToken },
      include: { client: { select: { name: true, organizationId: true } } },
    });
    const failure = publicEstimateFailure(estimate);
    if (failure) return reply.status(failure.statusCode).send({ error: failure.error });
    if (estimate.status !== 'SENT') return reply.status(400).send({ error: 'Estimate is not in a state that can be responded to' });
    const now = new Date();
    if (action === 'approve' && estimate.validUntil && new Date(estimate.validUntil) < now) {
      return reply.status(410).send({ error: 'This estimate has expired. Contact us for an updated estimate.', code: 'ESTIMATE_EXPIRED' });
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'DECLINED';
    // Compare-and-set: two concurrent answers cannot both win.
    const claimed = await request.prisma.estimate.updateMany({
      where: { id: estimate.id, status: 'SENT' },
      data: { status: newStatus },
    });
    if (claimed.count !== 1) return reply.status(409).send({ error: 'This estimate was already answered' });

    await recordAuditEvent(request.prisma, {
      organizationId: estimate.client?.organizationId,
      actorType: 'CLIENT',
      actorUserId: null,
      action: action === 'approve' ? 'estimate.approved' : 'estimate.declined',
      entityId: estimate.id,
      requestId: request.id,
      ip: request.ip,
      metadata: { fromStatus: 'SENT', toStatus: newStatus, via: 'public_link', total: estimate.total },
    });

    return publicEstimateView({ ...estimate, status: newStatus });
  });

  // Revoke the public link (staff). A re-send issues a new one.
  fastify.post('/:id/revoke-link', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.estimate.findUnique({ where: { id }, select: { id: true, publicAccessRevokedAt: true } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    const revokedAt = existing.publicAccessRevokedAt ?? new Date();
    await request.prisma.estimate.update({ where: { id }, data: { publicAccessRevokedAt: revokedAt } });
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'estimate.link_revoked',
      entityId: id,
      metadata: { alreadyRevoked: Boolean(existing.publicAccessRevokedAt) },
    });
    return { id, publicAccessRevokedAt: revokedAt };
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
