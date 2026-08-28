// Client Portal routes (public - no auth required, token-based access)

import { safeParse } from '../utils/safeParse.js';
import { createPaymentLink } from '../services/stripe.service.js';
import { onProposalApproved, onContractSigned } from '../services/automation.service.js';
import crypto from 'crypto';
import { validateBody, bookingSchema, contractSignSchema, formSubmitSchema, proposalDeclineSchema } from '../validators/schemas.js';
import { publicAccessFailure } from '../utils/public-document-access.js';

export default async function portalRoutes(fastify) {
  // ==================== PROJECT PORTAL ====================

  // Public project portal view
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params;

    const project = await request.prisma.project.findUnique({
      where: { viewToken: token },
      include: {
        client: { select: { name: true } },
        revisionRounds: {
          orderBy: { roundNumber: 'desc' },
          take: 10
        },
        notes: {
          where: { isPinned: true },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            content: true,
            updatedAt: true
          }
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

    return {
      name: project.name,
      description: project.description,
      status: project.status,
      health: project.health,
      clientName: project.client?.name,
      aiSummary: project.aiSummary,
      milestones: project.milestones,
      revisionRounds: project.revisionRounds,
      pinnedNotes: project.notes,
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
  fastify.get('/proposal/:viewToken', async (request, reply) => {
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
      currency: proposal.currency,
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
  fastify.post('/proposal/:viewToken/approve', async (request, reply) => {
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
    if (proposal.validUntil && new Date(proposal.validUntil) < new Date()) {
      return reply.status(400).send({ error: 'Proposal has expired' });
    }
    if (!['CAD', 'USD'].includes(proposal.currency)) {
      return reply.status(409).send({ error: 'Proposal currency must be reviewed before approval' });
    }

    const updated = await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        publicAccessRevokedAt: new Date(),
      }
    });

    // Trigger automation: proposal approved
    onProposalApproved(proposal.id).catch(err =>
      console.error('[Portal] Automation trigger failed:', err)
    );

    return { success: true, status: 'APPROVED', approvedAt: updated.approvedAt };
  });

  // Decline proposal
  fastify.post('/proposal/:viewToken/decline', { preHandler: [validateBody(proposalDeclineSchema)] }, async (request, reply) => {
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

    const updated = await request.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        publicAccessRevokedAt: new Date(),
        // Store decline reason in internalNotes (no dedicated field)
        internalNotes: reason
          ? `${proposal.internalNotes ? proposal.internalNotes + '\n' : ''}[Client declined] ${reason}`
          : proposal.internalNotes
      }
    });

    return { success: true, status: 'DECLINED', declinedAt: updated.declinedAt };
  });

  // ==================== CONTRACTS ====================

  // View contract by sign token
  fastify.get('/contract/:signToken', async (request, reply) => {
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
  fastify.post('/contract/:signToken/sign', { preHandler: [validateBody(contractSignSchema)] }, async (request, reply) => {
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

    const updated = await request.prisma.contract.updateMany({
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
    if (updated.count !== 1) return reply.status(409).send({ error: 'Contract is no longer awaiting signature' });

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
  fastify.get('/invoice/:viewToken', async (request, reply) => {
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
    const accessFailure = publicAccessFailure(invoice);
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
  fastify.post('/invoice/:viewToken/pay', async (request, reply) => {
    const { viewToken } = request.params;

    const invoice = await request.prisma.invoice.findUnique({ where: { viewToken } });
    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }
    const accessFailure = publicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    if (invoice.status === 'PAID') {
      return reply.status(400).send({ error: 'Invoice already paid' });
    }
    if (invoice.status === 'VOID') {
      return reply.status(400).send({ error: 'Invoice has been voided' });
    }

    // If there's already a Stripe payment link, return it
    if (invoice.stripePaymentLink) {
      return { checkoutUrl: invoice.stripePaymentLink };
    }

    try {
      const result = await createPaymentLink(invoice);
      if (!result) {
        return reply.status(500).send({ error: 'Payment service not configured' });
      }

      // Store the payment link and intent ID
      await request.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          stripePaymentLink: result.paymentLink,
          stripeCheckoutSessionId: result.checkoutSessionId,
          stripePaymentIntentId: result.paymentIntentId
        }
      });

      return { checkoutUrl: result.paymentLink };
    } catch (error) {
      fastify.log.error('Stripe payment link creation failed:', error);
      return reply.status(500).send({ error: 'Failed to create payment session' });
    }
  });

  // ==================== INTAKE FORMS ====================

  // Public: get form by viewToken
  fastify.get('/form/:viewToken', async (request, reply) => {
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
  fastify.post('/form/:viewToken', { preHandler: [validateBody(formSubmitSchema)] }, async (request, reply) => {
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

  // Get available time slots for a given date
  fastify.get('/booking/availability', async (request, reply) => {
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

    const existingEvents = await request.prisma.calendarEvent.findMany({
      where: {
        startTime: { gte: dayStart },
        endTime: { lte: dayEnd }
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
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: !hasConflict
      });
    }

    return { date, slots };
  });

  // Book a time slot
  fastify.post('/booking', { preHandler: [validateBody(bookingSchema)] }, async (request, reply) => {
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

    // Check for conflicts
    const conflict = await request.prisma.calendarEvent.findFirst({
      where: {
        AND: [
          { startTime: { lt: endTime } },
          { endTime: { gt: startTime } }
        ]
      }
    });

    if (conflict) {
      return reply.status(409).send({ error: 'This time slot is no longer available' });
    }

    // Get or use a system user for createdById (first admin)
    const adminUser = await request.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true }
    });

    if (!adminUser) {
      return reply.status(500).send({ error: 'System configuration error' });
    }

    const event = await request.prisma.calendarEvent.create({
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
