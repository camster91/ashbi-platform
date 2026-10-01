import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import env from '../config/env.js';
import { validateBody, createEstimateSchema, updateEstimateSchema, estimatePublicResponseSchema } from '../validators/schemas.js';
import { clampTake } from '../utils/query-limits.js';
import { softDelete } from '../services/trash.service.js';
import { deliveryFieldsFromSend, mailgunTrackingFields, withDeliveryState } from '../services/mailgun-delivery.service.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';
import { recordAuditEvent, recordRequestAuditEvent } from '../services/audit-event.service.js';
import { computeProposalLineItems, proposalTotals } from '../utils/proposal-totals.js';

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

const roundMoney = (value) => parseFloat((Number(value) || 0).toFixed(2));

// A date-only "valid until" (the Estimates page's date input) is stored as
// 23:59:59.999Z of that calendar day. The client may be anywhere, so the
// estimate stays answerable, and its public link open, until that calendar
// day has ended everywhere: the end of the day in UTC-12, 12 hours later.
// An exact datetime from an API caller is used as given.
const LATEST_TIMEZONE_OFFSET_MS = 12 * 60 * 60 * 1000;

/** When an estimate with this validUntil stops being answerable, or null. */
export function estimateValidThrough(validUntil) {
  if (!validUntil) return null;
  const at = new Date(validUntil);
  if (Number.isNaN(at.getTime())) return null;
  const endOfUtcDay = at.getUTCHours() === 23 && at.getUTCMinutes() === 59
    && at.getUTCSeconds() === 59 && at.getUTCMilliseconds() === 999;
  return endOfUtcDay ? new Date(at.getTime() + LATEST_TIMEZONE_OFFSET_MS) : at;
}

/** A line's amount as stored and shown: round2(quantity * rate). */
export function estimateLineAmount(item) {
  return roundMoney((Number(item?.quantity) || 0) * (Number(item?.rate) || 0));
}

/**
 * Estimate money, computed exactly as the Estimates page shows it (and the
 * way invoices apply taxRate): each line is round2(quantity * rate), the
 * subtotal is the sum of those line amounts, tax = round2(subtotal * taxRate
 * / 100) and total = round2(subtotal + tax). A fixed `tax` amount is used
 * only when no taxRate is given.
 * @param {Array<{ quantity: number, rate: number }>} lineItems
 * @param {{ taxRate?: number | null, tax?: number }} [options]
 */
export function computeEstimateTotals(lineItems, { taxRate, tax } = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const subtotal = roundMoney(items.reduce((sum, item) => sum + estimateLineAmount(item), 0));
  const taxAmount = taxRate !== undefined && taxRate !== null
    ? roundMoney((subtotal * Number(taxRate)) / 100)
    : roundMoney(tax);
  return { subtotal, tax: taxAmount, total: roundMoney(subtotal + taxAmount) };
}

/** Line items as stored: the client's fields plus the computed amount. */
function storedLineItems(lineItems) {
  return (lineItems || []).map((item) => ({
    description: item.description,
    quantity: item.quantity,
    rate: item.rate,
    amount: estimateLineAmount(item),
  }));
}

// Estimate status changes each have one route, which does the side effects
// the status implies:
//   DRAFT -> SENT                 POST /:id/send (issues the public link, emails)
//   SENT -> APPROVED | DECLINED   POST /view/:token/approve (the client's answer)
//   APPROVED | SENT -> CONVERTED  POST /:id/convert (creates the proposal)
// PUT /:id edits drafts only and may not change the status (sending `status:
// 'DRAFT'` is accepted as a no-op), so staff can never mark an estimate
// approved on the client's behalf.
const PUT_STATUS_TRANSITIONS = Object.freeze({ DRAFT: Object.freeze(['DRAFT']) });

/** Why PUT may not move an estimate from `from` to `to`, or null. */
export function estimateStatusChangeError(from, to) {
  if (to === undefined || to === from) return null;
  if ((PUT_STATUS_TRANSITIONS[from] ?? []).includes(to)) return null;
  const via = {
    SENT: 'Send the estimate (POST /api/estimates/:id/send)',
    APPROVED: 'Only the client can approve an estimate, from its link',
    DECLINED: 'Only the client can decline an estimate, from its link',
    CONVERTED: 'Convert the estimate (POST /api/estimates/:id/convert)',
  }[to] ?? 'This status cannot be set directly';
  return `An estimate cannot move from ${from} to ${to} here. ${via}.`;
}

const PROPOSAL_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

// Estimates POST /:id/convert accepts (the CONVERTED transition above).
export const ESTIMATE_CONVERTIBLE_STATUSES = Object.freeze(['APPROVED', 'SENT']);

/**
 * The Proposal a converted estimate becomes. Proposals are pre-tax (subtotal
 * minus discount, see src/utils/proposal-totals.js), so the line items and
 * subtotal match the estimate's and the estimate's tax rate travels in
 * metadata; an invoice created from the proposal applies that rate, which
 * gives the estimate's total again. Legacy estimates without a stored
 * taxRate carry the rate their fixed tax amount implies.
 */
export function proposalDataFromEstimate(estimate, { createdById, now = new Date() }) {
  const estimateLines = Array.isArray(estimate.lineItems) ? estimate.lineItems : [];
  const lineItems = computeProposalLineItems(estimateLines.map((item) => ({
    description: typeof item?.description === 'string' && item.description.trim() ? item.description : 'Line item',
    quantity: Number(item?.quantity) || 0,
    unitPrice: Number(item?.rate) || 0,
  })));
  const { subtotal, total } = proposalTotals(lineItems, 0);
  const estimateTotals = computeEstimateTotals(estimateLines, { taxRate: estimate.taxRate, tax: estimate.tax });
  const taxRate = estimate.taxRate !== null && estimate.taxRate !== undefined
    ? Number(estimate.taxRate)
    : (estimateTotals.subtotal > 0 ? Math.round((estimateTotals.tax / estimateTotals.subtotal) * 100 * 10000) / 10000 : 0);
  return {
    title: estimate.title,
    notes: estimate.description || null,
    clientId: estimate.clientId,
    createdById,
    status: 'DRAFT',
    subtotal,
    discount: 0,
    total,
    // A proposal is sent with a future validity: keep the estimate's while it
    // is still ahead, otherwise give the new draft the usual 30 days.
    validUntil: estimate.validUntil && new Date(estimate.validUntil) > now
      ? estimate.validUntil
      : new Date(now.getTime() + PROPOSAL_VALIDITY_MS),
    metadata: JSON.stringify({
      source: 'estimate',
      estimateId: estimate.id,
      taxRate,
      tax: estimateTotals.tax,
      estimateTotal: estimateTotals.total,
    }),
    lineItems: { create: lineItems },
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
    const { clientId, title, description, lineItems, tax, taxRate, validUntil } = request.body;
    if (!clientId || !title) {
      return reply.status(400).send({ error: 'Client and title are required' });
    }

    const items = storedLineItems(lineItems);
    const { subtotal, tax: taxAmount, total } = computeEstimateTotals(items, { taxRate, tax });
    // The rate is stored so the page reopens with exactly what staff entered;
    // null when the caller sent a fixed tax amount instead.
    const storedTaxRate = taxRate ?? null;

    const estimate = await request.prisma.estimate.create({
      data: {
        clientId,
        title,
        description,
        lineItems: items,
        subtotal,
        tax: taxAmount,
        taxRate: storedTaxRate,
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

    const { title, description, lineItems, tax, taxRate, validUntil, status } = request.body;
    const statusError = estimateStatusChangeError(existing.status, status);
    if (statusError) return reply.status(409).send({ error: statusError, code: 'ESTIMATE_STATUS_TRANSITION' });
    const items = lineItems !== undefined ? storedLineItems(lineItems) : (Array.isArray(existing.lineItems) ? existing.lineItems : []);
    // The tax follows a new taxRate, else a new fixed tax, else the stored
    // rate; an estimate from before rates were stored keeps its tax amount.
    let nextTaxRate = existing.taxRate ?? null;
    if (taxRate !== undefined) nextTaxRate = taxRate;
    else if (tax !== undefined) nextTaxRate = null;
    const { subtotal, tax: taxAmount, total } = computeEstimateTotals(
      items,
      nextTaxRate !== null ? { taxRate: nextTaxRate } : { tax: tax ?? existing.tax },
    );

    // Lines, totals and fields are one row (lineItems is JSON), written by a
    // single conditional update: if the estimate was sent (or changed status)
    // since it was read, nothing is written and the edit is refused.
    const written = await request.prisma.estimate.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(lineItems !== undefined && { lineItems: items }),
        subtotal,
        tax: taxAmount,
        taxRate: nextTaxRate,
        total,
        ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
      },
    });
    if (written.count !== 1) {
      return reply.status(409).send({ error: 'This estimate is no longer a draft, so it cannot be edited', code: 'ESTIMATE_NOT_DRAFT' });
    }

    return request.prisma.estimate.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } } }
    });
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
    const access = createPublicAccessWindow(estimateValidThrough(estimate.validUntil));
    // Conditional on DRAFT so two concurrent sends (or a send racing an
    // edit) cannot both issue a link and email the client.
    const claimed = await request.prisma.estimate.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: null,
      },
    });
    if (claimed.count !== 1) {
      return reply.status(409).send({ error: 'This estimate was already sent', code: 'ESTIMATE_NOT_DRAFT' });
    }
    const updated = await request.prisma.estimate.findUnique({
      where: { id },
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
    if (action === 'approve' && estimate.validUntil && estimateValidThrough(estimate.validUntil) < now) {
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

  // Issue a fresh public link for a SENT estimate (after a revocation, an
  // expired window, or the token rotation at release). Staff share the new
  // link themselves; the old one stops working.
  fastify.post('/:id/reissue-link', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const existing = await request.prisma.estimate.findUnique({ where: { id }, select: { id: true, status: true, validUntil: true } });
    if (!existing) return reply.status(404).send({ error: 'Estimate not found' });
    if (existing.status !== 'SENT') {
      return reply.status(400).send({ error: 'Only a sent estimate awaiting an answer can get a new link' });
    }
    const access = createPublicAccessWindow(estimateValidThrough(existing.validUntil));
    const updated = await request.prisma.estimate.update({
      where: { id },
      data: { viewToken: access.token, publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null },
      select: { id: true, viewToken: true, publicAccessExpiresAt: true },
    });
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'estimate.link_reissued',
      entityId: id,
      metadata: { expiresAt: access.expiresAt },
    });
    return updated;
  });

  // Revoke the public link (staff). Reissue or re-send issues a new one.
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

  // Convert estimate to proposal. The estimate moves APPROVED | SENT ->
  // CONVERTED (see PUT_STATUS_TRANSITIONS above) with a compare-and-set in the
  // same transaction that creates the proposal, so a double click, a retry or
  // a client answering at the same moment can never produce two proposals or
  // a converted estimate without one.
  fastify.post('/:id/convert', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const estimate = await request.prisma.estimate.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true } } }
    });
    if (!estimate) return reply.status(404).send({ error: 'Estimate not found' });
    if (!ESTIMATE_CONVERTIBLE_STATUSES.includes(estimate.status)) {
      return reply.status(400).send({ error: 'Only approved or sent estimates can be converted' });
    }

    const data = proposalDataFromEstimate(estimate, { createdById: request.user.id });
    const proposal = await request.prisma.$transaction(async (tx) => {
      const claimed = await tx.estimate.updateMany({
        where: { id, status: { in: ESTIMATE_CONVERTIBLE_STATUSES } },
        data: { status: 'CONVERTED' },
      });
      if (claimed.count !== 1) return null;
      return tx.proposal.create({ data, include: { lineItems: true } });
    });
    if (!proposal) {
      return reply.status(409).send({ error: 'This estimate was already converted or answered', code: 'ESTIMATE_STATUS_CHANGED' });
    }

    return { proposal, estimateId: id };
  });
}
