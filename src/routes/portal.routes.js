// Client Portal routes (public - no auth required, token-based access)

import { CheckoutNotPayableError, ensureCheckoutSession } from '../services/stripe.service.js';
import { invoiceBalance } from '../utils/invoice-balance.js';
import { onProposalApproved, onContractSigned } from '../services/automation.service.js';
import crypto from 'crypto';
import { validateBody, bookingSchema, contractSignSchema, formSubmitSchema, proposalDeclineSchema } from '../validators/schemas.js';
import { invoicePublicAccessFailure, INVOICE_OPEN_STATUSES, publicAccessFailure } from '../utils/public-document-access.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { recordContractSigned, recordProposalApproved } from '../services/domain-event-producers.js';
import env from '../config/env.js';

// Per-IP limits for the unauthenticated capability-link routes that still use
// the legacy never-expiring project and intake-form view tokens (security
// audit M1; moving those to expiring, revocable links is tracked separately).
// Every route here is public: addressed by a capability token in the URL or
// a public intake form, never acting with a staff member's authority
// (`config.public`, see src/auth/mfa-enforcement.js).
const PUBLIC = { config: { public: true } };
const LEGACY_LINK_VIEW_RATE_LIMIT = { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } };
const LEGACY_LINK_SUBMIT_RATE_LIMIT = { config: { public: true, rateLimit: { max: 10, timeWindow: '15 minutes' } } };

export default async function portalRoutes(fastify) {
  // ==================== PROJECT PORTAL ====================

  // Public project portal view
  fastify.get('/:token', LEGACY_LINK_VIEW_RATE_LIMIT, async (request, reply) => {
    const { token } = request.params;

    // A trashed or cancelled project is not shown, as in the signed-in
    // client portal.
    const project = await request.prisma.project.findFirst({
      where: { viewToken: token, deletedAt: null, status: { not: 'CANCELLED' } },
      // An explicit select: the internal health rating, AI summary and notes
      // are never loaded for this public view.
      select: {
        name: true,
        description: true,
        status: true,
        updatedAt: true,
        client: { select: { name: true } },
        revisionRounds: {
          orderBy: { roundNumber: 'desc' },
          take: 10,
          // The same client-facing fields as the signed-in portal.
          select: { id: true, roundNumber: true, status: true, notes: true, requestedAt: true, approvedAt: true, updatedAt: true },
        },
        milestones: {
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            dueDate: true,
            completedAt: true
          }
        },
        tasks: {
          where: { status: { not: 'COMPLETED' } },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            category: true,
            dueDate: true
          }
        }
      }
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Client-facing: never the internal health rating, the AI summary, or
    // project notes (pinning a note is a staff feature, not a publish action;
    // notes have no client-visible flag).
    return {
      name: project.name,
      description: project.description,
      status: project.status,
      clientName: project.client?.name,
      milestones: project.milestones,
      revisionRounds: project.revisionRounds,
      activeTasks: project.tasks.map(t => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category,
        dueDate: t.dueDate
      })),
      updatedAt: project.updatedAt
    };
  });

  // ==================== PROPOSALS ====================

  // View proposal by token
  fastify.get('/proposal/:viewToken', PUBLIC, async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await request.prisma.proposal.findUnique({
      where: { viewToken },
      include: {
        lineItems: true,
        client: {
          select: { id: true, name: true, email: true }
        },
        project: {
          select: { id: true, name: true }
        },
        createdBy: {
          select: { name: true, email: true }
        }
      }
    });

    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    // Mark as VIEWED if currently SENT
    if (proposal.status === 'SENT') {
      await request.prisma.proposal.update({
        where: { id: proposal.id },
        data: { status: 'VIEWED' }
      });
    }

    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status === 'SENT' ? 'VIEWED' : proposal.status,
      validUntil: proposal.validUntil,
      subtotal: proposal.subtotal,
      discount: proposal.discount,
      total: proposal.total,
      notes: proposal.notes,
      sentAt: proposal.sentAt,
      approvedAt: proposal.approvedAt,
      declinedAt: proposal.declinedAt,
      client: proposal.client,
      project: proposal.project,
      createdBy: { name: proposal.createdBy.name },
      lineItems: proposal.lineItems.map(li => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        total: li.total
      }))
    };
  });

  // Approve proposal
  fastify.post('/proposal/:viewToken/approve', PUBLIC, async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await request.prisma.proposal.findUnique({ where: { viewToken } });
    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (proposal.status === 'APPROVED') {
      return reply.status(400).send({ error: 'Proposal already approved' });
    }
    if (proposal.status === 'DECLINED') {
      return reply.status(400).send({ error: 'Proposal was declined' });
    }
    if (!['SENT', 'VIEWED'].includes(proposal.status)) {
      return reply.status(409).send({ error: 'Proposal is not awaiting approval' });
    }
    if (proposal.validUntil && new Date(proposal.validUntil) < new Date()) {
      return reply.status(400).send({ error: 'Proposal has expired' });
    }

    // Compare-and-set on an awaiting-answer status: two concurrent approvals
    // (double click, replayed link) must not both run the automation or
    // both write an audit event.
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
        await recordProposalApproved(tx, { proposal, via: 'portal_link', approvedAt, correlationId: request.id });
      }
      return result;
    });
    if (transitioned.count !== 1) {
      return reply.status(409).send({ error: 'Proposal is no longer awaiting approval' });
    }

    await recordRequestAuditEvent(request.prisma, request, {
      action: 'proposal.approved',
      actorType: 'CLIENT',
      actorUserId: null,
      organizationId: null,
      ownerClientId: proposal.clientId,
      entityId: proposal.id,
      metadata: { fromStatus: proposal.status, toStatus: 'APPROVED', total: proposal.total, via: 'portal_link' },
    });

    // Trigger automation: proposal approved
    onProposalApproved(proposal.id).catch(err =>
      console.error('[Portal] Automation trigger failed:', err)
    );

    return { success: true, status: 'APPROVED', approvedAt };
  });

  // Decline proposal
  fastify.post('/proposal/:viewToken/decline', { ...PUBLIC, preHandler: [validateBody(proposalDeclineSchema)] }, async (request, reply) => {
    const { viewToken } = request.params;
    const { reason } = request.body;

    const proposal = await request.prisma.proposal.findUnique({ where: { viewToken } });
    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const accessFailure = publicAccessFailure(proposal);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (proposal.status === 'APPROVED') {
      return reply.status(400).send({ error: 'Proposal already approved' });
    }
    if (proposal.status === 'DECLINED') {
      return reply.status(400).send({ error: 'Proposal already declined' });
    }

    // Compare-and-set: only a proposal still awaiting an answer can be
    // declined, so a decline racing an approval never overwrites it.
    const declinedAt = new Date();
    const transitioned = await request.prisma.proposal.updateMany({
      where: { id: proposal.id, status: { in: ['SENT', 'VIEWED'] }, publicAccessRevokedAt: null },
      data: {
        status: 'DECLINED',
        declinedAt,
        publicAccessRevokedAt: declinedAt,
        // Store decline reason in internalNotes (no dedicated field)
        internalNotes: reason
          ? `${proposal.internalNotes ? proposal.internalNotes + '\n' : ''}[Client declined] ${reason}`
          : proposal.internalNotes
      }
    });
    if (transitioned.count !== 1) {
      return reply.status(409).send({ error: 'Proposal is no longer awaiting a decision' });
    }

    return { success: true, status: 'DECLINED', declinedAt };
  });

  // ==================== CONTRACTS ====================

  // View contract by sign token
  fastify.get('/contract/:signToken', PUBLIC, async (request, reply) => {
    const { signToken } = request.params;

    const contract = await request.prisma.contract.findUnique({
      where: { signToken },
      include: {
        client: {
          select: { id: true, name: true, email: true }
        },
        proposal: {
          select: { id: true, title: true, total: true }
        },
        createdBy: {
          select: { name: true }
        }
      }
    });

    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found' });
    }
    const accessFailure = publicAccessFailure(contract);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    return {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      content: contract.content,
      templateType: contract.templateType,
      client: contract.client,
      proposal: contract.proposal,
      createdBy: { name: contract.createdBy.name },
      signedAt: contract.signedAt,
      clientSigName: contract.clientSigName,
      createdAt: contract.createdAt
    };
  });

  // Sign contract
  fastify.post('/contract/:signToken/sign', { ...PUBLIC, preHandler: [validateBody(contractSignSchema)] }, async (request, reply) => {
    const { signToken } = request.params;
    const { signerName, signatureType, signatureImage, agreement } = request.body;

    const contract = await request.prisma.contract.findUnique({ where: { signToken } });
    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found' });
    }
    const accessFailure = publicAccessFailure(contract);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (contract.status === 'SIGNED') {
      return reply.status(400).send({ error: 'Contract already signed' });
    }
    if (contract.status === 'VOID') {
      return reply.status(400).send({ error: 'Contract has been voided' });
    }

    if (!agreement) return reply.status(400).send({ error: 'Explicit agreement is required' });
    const signatureSecret = process.env.CONTRACT_SIGNATURE_SECRET || process.env.JWT_SECRET;
    if (!signatureSecret) return reply.status(503).send({ error: 'Contract signing is unavailable' });
    const now = new Date();
    const signedContentHash = crypto.createHash('sha256').update(contract.content).digest('hex');
    const signatureDataHash = crypto.createHash('sha256')
      .update(signatureType === 'draw' ? signatureImage : signerName)
      .digest('hex');
    const sigHash = crypto.createHmac('sha256', signatureSecret)
      .update(`${contract.id}:${signedContentHash}:${signerName}:${signatureType}:${signatureDataHash}:${now.toISOString()}`)
      .digest('hex');

    // The signature and its outbox event (docs/event-outbox.md) commit together.
    const updated = await request.prisma.$transaction(async (tx) => {
      const result = await tx.contract.updateMany({
        where: { id: contract.id, status: 'SENT', publicAccessRevokedAt: null },
        data: {
          status: 'SIGNED',
          clientSigHash: sigHash,
          clientSigName: signerName,
          clientSigDate: now,
          signedAt: now,
          signedContentHash,
          signatureType,
          signatureDataHash,
          signerIp: request.ip,
          signerUserAgent: String(request.headers['user-agent'] || '').slice(0, 500),
          publicAccessRevokedAt: now,
        }
      });
      if (result.count === 1) {
        await recordContractSigned(tx, {
          contract, signingMethod: signatureType, documentHash: signedContentHash, via: 'portal_link', signedAt: now, correlationId: request.id,
        });
      }
      return result;
    });
    if (updated.count !== 1) return reply.status(409).send({ error: 'Contract is no longer awaiting signature' });

    // The signer's name and full IP stay on the contract as signing evidence;
    // the audit event carries only ids and the content hash.
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'contract.signed',
      actorType: 'CLIENT',
      actorUserId: null,
      organizationId: null,
      ownerClientId: contract.clientId,
      entityId: contract.id,
      metadata: { fromStatus: contract.status, toStatus: 'SIGNED', signingMethod: signatureType, documentHash: signedContentHash, via: 'portal_link' },
    });

    // Trigger automation: contract signed
    onContractSigned(contract.id).catch(err =>
      console.error('[Portal] Automation trigger failed:', err)
    );

    return {
      success: true,
      status: 'SIGNED',
      signedAt: now,
      signerName,
      signedContentHash,
      signatureType,
    };
  });

  // ==================== INVOICES ====================

  // View invoice by token
  fastify.get('/invoice/:viewToken', PUBLIC, async (request, reply) => {
    const { viewToken } = request.params;

    const invoice = await request.prisma.invoice.findUnique({
      where: { viewToken },
      include: {
        lineItems: { orderBy: { position: 'asc' } },
        client: {
          select: { id: true, name: true, email: true }
        },
        payments: {
          orderBy: { paidAt: 'desc' }
        },
        createdBy: {
          select: { name: true }
        }
      }
    });

    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }
    const accessFailure = invoicePublicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      title: invoice.title,
      dueDate: invoice.dueDate,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      taxRate: invoice.taxRate,
      taxType: invoice.taxType,
      tax: invoice.tax,
      total: invoice.total,
      // What is still owed after partial payments (the pay button charges it).
      ...invoiceBalance(invoice.total, invoice.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)),
      notes: invoice.notes,
      paidAt: invoice.paidAt,
      sentAt: invoice.sentAt,
      client: invoice.client,
      createdBy: { name: invoice.createdBy.name },
      lineItems: invoice.lineItems.map(li => ({
        id: li.id,
        description: li.description,
        itemType: li.itemType,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        total: li.total
      })),
      payments: invoice.payments.map(p => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        paidAt: p.paidAt
      }))
    };
  });

  // Pay invoice — creates Stripe checkout session
  fastify.post('/invoice/:viewToken/pay', PUBLIC, async (request, reply) => {
    const { viewToken } = request.params;

    const invoice = await request.prisma.invoice.findUnique({ where: { viewToken } });
    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }
    const accessFailure = invoicePublicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (invoice.status === 'PAID') {
      return reply.status(400).send({ error: 'Invoice already paid' });
    }
    if (invoice.status === 'VOID') {
      return reply.status(400).send({ error: 'Invoice has been voided' });
    }
    if (!INVOICE_OPEN_STATUSES.includes(invoice.status)) {
      return reply.status(409).send({ error: 'Invoice is not awaiting payment' });
    }

    try {
      // Reuses the open session when amount/currency still match and it has
      // not expired; otherwise creates (and stores) a fresh one.
      const result = await ensureCheckoutSession(request.prisma, invoice);
      if (!result) {
        return reply.status(500).send({ error: 'Payment service not configured' });
      }

      return { checkoutUrl: result.paymentLink };
    } catch (error) {
      if (error instanceof CheckoutNotPayableError) return reply.status(409).send({ error: 'Invoice is not awaiting payment', code: error.code });
      fastify.log.error('Stripe payment link creation failed:', error);
      return reply.status(500).send({ error: 'Failed to create payment session' });
    }
  });

  // ==================== INTAKE FORMS ====================

  // Public: get form by viewToken
  fastify.get('/form/:viewToken', LEGACY_LINK_VIEW_RATE_LIMIT, async (request, reply) => {
    const { viewToken } = request.params;

    const form = await request.prisma.intakeForm.findUnique({
      where: { viewToken },
      include: {
        client: { select: { name: true } },
      },
    });

    if (!form) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    if (!form.isActive) {
      return reply.status(410).send({ error: 'This form is no longer accepting responses' });
    }

    return {
      id: form.id,
      name: form.name,
      description: form.description,
      fields: JSON.parse(form.fields || '[]'),
      clientName: form.client?.name,
    };
  });

  // Public: submit response to form
  fastify.post('/form/:viewToken', { ...LEGACY_LINK_SUBMIT_RATE_LIMIT, preHandler: [validateBody(formSubmitSchema)] }, async (request, reply) => {
    const { viewToken } = request.params;
    const { answers, respondentName, respondentEmail } = request.body;

    const form = await request.prisma.intakeForm.findUnique({ where: { viewToken } });

    if (!form) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    if (!form.isActive) {
      return reply.status(410).send({ error: 'This form is no longer accepting responses' });
    }

    const response = await request.prisma.intakeFormResponse.create({
      data: {
        formId: form.id,
        answers: JSON.stringify(answers || {}),
        respondentName,
        respondentEmail,
        clientId: form.clientId,
      },
    });

    return {
      success: true,
      id: response.id,
    };
  });

  // ==================== PUBLIC BOOKING ====================

  // The booking page is anonymous, so it cannot take its tenant from a
  // session. Every lookup below is restricted to the one booking organization
  // so a visitor never sees another tenant's busy times or books into their
  // calendar.
  async function resolveBookingOrganization(prisma) {
    const where = { role: 'ADMIN', isActive: true };
    if (env.publicBookingOrganizationId) {
      where.organizationId = env.publicBookingOrganizationId;
    } else if ((await prisma.organization.count()) !== 1) {
      // With several workspaces and no configured booking organization,
      // guessing one (for example by admin age) could silently send visitors'
      // details into another tenant's calendar, so refuse instead.
      fastify.log.warn('Public booking is disabled: set PUBLIC_BOOKING_ORGANIZATION_ID when more than one organization exists');
      return null;
    }
    return prisma.user.findFirst({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, organizationId: true },
    });
  }

  // Get available time slots for a given date
  fastify.get('/booking/availability', PUBLIC, async (request, reply) => {
    const { date } = request.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'Date parameter required (YYYY-MM-DD)' });
    }

    const dayDate = new Date(date + 'T00:00:00');
    const dayOfWeek = dayDate.getDay(); // 0=Sun, 6=Sat

    // No availability on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { date, slots: [], message: 'No availability on weekends' };
    }

    // No availability in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dayDate < today) {
      return { date, slots: [], message: 'Cannot book dates in the past' };
    }

    // Define available hours: 9am-5pm ET, 1-hour slots
    const SLOT_DURATION = 60; // minutes
    const START_HOUR = 9;
    const END_HOUR = 17;

    // Get existing events for this day
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(date + 'T23:59:59');

    const owner = await resolveBookingOrganization(request.prisma);
    if (!owner) {
      return reply.status(503).send({ error: 'Booking is not available' });
    }

    // Any event overlapping the day blocks its slots, including ones that
    // start the evening before or run past midnight.
    const existingEvents = await request.prisma.calendarEvent.findMany({
      where: {
        startTime: { lte: dayEnd },
        endTime: { gte: dayStart },
        createdBy: { organizationId: owner.organizationId }
      },
      select: { startTime: true, endTime: true }
    });

    // Generate all possible slots
    const slots = [];
    for (let hour = START_HOUR; hour < END_HOUR; hour++) {
      const slotStart = new Date(date + `T${String(hour).padStart(2, '0')}:00:00`);
      const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION * 60000);

      // Check for conflicts with existing events
      const hasConflict = existingEvents.some(event => {
        const eStart = new Date(event.startTime);
        const eEnd = new Date(event.endTime);
        return slotStart < eEnd && slotEnd > eStart;
      });

      // Skip slots that are in the past (for today)
      const now = new Date();
      if (slotStart <= now) continue;

      slots.push({
        // The wall-clock "HH:MM" the booking form sends back as `time`. It is
        // in the server's local timezone (slotStart above and POST /booking
        // both parse `${date}T${time}` as server-local); there is no
        // configured booking timezone to label it with.
        time: `${String(hour).padStart(2, '0')}:00`,
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: !hasConflict
      });
    }

    return { date, slots };
  });

  // Book a time slot
  fastify.post('/booking', { ...PUBLIC, preHandler: [validateBody(bookingSchema)] }, async (request, reply) => {
    const { name, email, date, time, notes, phone } = request.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'Invalid date format (YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return reply.status(400).send({ error: 'Invalid time format (HH:MM)' });
    }

    const startTime = new Date(`${date}T${time}:00`);
    const endTime = new Date(startTime.getTime() + 60 * 60000); // 1 hour

    // Validate weekday
    const dayOfWeek = startTime.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return reply.status(400).send({ error: 'Bookings only available on weekdays' });
    }

    // Validate business hours
    const hour = startTime.getHours();
    if (hour < 9 || hour >= 17) {
      return reply.status(400).send({ error: 'Bookings available 9am-5pm only' });
    }

    // Validate not in the past
    if (startTime <= new Date()) {
      return reply.status(400).send({ error: 'Cannot book a time in the past' });
    }

    // The booking is owned by the booking organization's longest-standing
    // active admin.
    const adminUser = await resolveBookingOrganization(request.prisma);
    if (!adminUser) {
      return reply.status(503).send({ error: 'Booking is not available' });
    }

    // Check for conflicts and book inside one transaction holding a
    // per-organization advisory lock, so two visitors cannot both take the
    // same slot between the check and the insert.
    const event = await request.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`public-booking:${adminUser.organizationId}`}))`;
      const conflict = await tx.calendarEvent.findFirst({
        where: {
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } },
            { createdBy: { organizationId: adminUser.organizationId } }
          ]
        }
      });
      if (conflict) return null;
      return tx.calendarEvent.create({
        data: {
          title: `Booking: ${name}`,
          description: `Client booking\nName: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ''}${notes ? `\nNotes: ${notes}` : ''}`,
          startTime,
          endTime,
          type: 'MEETING',
          color: '#10B981', // Green for bookings
          createdById: adminUser.id
        }
      });
    });

    if (!event) {
      return reply.status(409).send({ error: 'This time slot is no longer available' });
    }

    return {
      success: true,
      booking: {
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime
      }
    };
  });
}
