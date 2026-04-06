// Client Portal routes (public - no auth required, token-based access)

import { prisma } from '../index.js';
import { safeParse } from '../utils/safeParse.js';
import { createPaymentLink } from '../services/stripe.service.js';
import { onProposalApproved, onContractSigned } from '../services/automation.service.js';
import crypto from 'crypto';

export default async function portalRoutes(fastify) {
  // ==================== PROJECT PORTAL ====================

  // Public project portal view
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params;

    const project = await prisma.project.findUnique({
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

    const proposal = await prisma.proposal.findUnique({
      where: { viewToken },
      include: {
        lineItems: true,
        client: {
          select: { id: true, name: true, email: true, company: true }
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

    // Mark as VIEWED if currently SENT
    if (proposal.status === 'SENT') {
      await prisma.proposal.update({
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
  fastify.post('/proposal/:viewToken/approve', async (request, reply) => {
    const { viewToken } = request.params;

    const proposal = await prisma.proposal.findUnique({ where: { viewToken } });
    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    if (proposal.status === 'APPROVED') {
      return reply.status(400).send({ error: 'Proposal already approved' });
    }
    if (proposal.status === 'DECLINED') {
      return reply.status(400).send({ error: 'Proposal was declined' });
    }
    if (proposal.validUntil && new Date(proposal.validUntil) < new Date()) {
      return reply.status(400).send({ error: 'Proposal has expired' });
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date()
      }
    });

    // Trigger automation: proposal approved
    onProposalApproved(proposal.id).catch(err =>
      console.error('[Portal] Automation trigger failed:', err)
    );

    return { success: true, status: 'APPROVED', approvedAt: updated.approvedAt };
  });

  // Decline proposal
  fastify.post('/proposal/:viewToken/decline', async (request, reply) => {
    const { viewToken } = request.params;
    const { reason } = request.body || {};

    const proposal = await prisma.proposal.findUnique({ where: { viewToken } });
    if (!proposal) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    if (proposal.status === 'APPROVED') {
      return reply.status(400).send({ error: 'Proposal already approved' });
    }
    if (proposal.status === 'DECLINED') {
      return reply.status(400).send({ error: 'Proposal already declined' });
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
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

    const contract = await prisma.contract.findUnique({
      where: { signToken },
      include: {
        client: {
          select: { id: true, name: true, email: true, company: true }
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
  fastify.post('/contract/:signToken/sign', async (request, reply) => {
    const { signToken } = request.params;
    const { name, signature } = request.body || {};

    if (!name || !signature) {
      return reply.status(400).send({ error: 'Name and signature are required' });
    }

    const contract = await prisma.contract.findUnique({ where: { signToken } });
    if (!contract) {
      return reply.status(404).send({ error: 'Contract not found' });
    }
    if (contract.status === 'SIGNED') {
      return reply.status(400).send({ error: 'Contract already signed' });
    }
    if (contract.status === 'VOID') {
      return reply.status(400).send({ error: 'Contract has been voided' });
    }

    // Hash the signature image for integrity verification
    const sigHash = crypto.createHash('sha256').update(signature).digest('hex');
    const now = new Date();

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'SIGNED',
        clientSigHash: sigHash,
        clientSigName: name,
        clientSigDate: now,
        signedAt: now
      }
    });

    // Trigger automation: contract signed
    onContractSigned(contract.id).catch(err =>
      console.error('[Portal] Automation trigger failed:', err)
    );

    return {
      success: true,
      status: 'SIGNED',
      signedAt: updated.signedAt,
      signerName: name
    };
  });

  // ==================== INVOICES ====================

  // View invoice by token
  fastify.get('/invoice/:viewToken', async (request, reply) => {
    const { viewToken } = request.params;

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
      include: {
        lineItems: { orderBy: { position: 'asc' } },
        client: {
          select: { id: true, name: true, email: true, company: true }
        },
        project: {
          select: { id: true, name: true }
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
      project: invoice.project,
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

    const invoice = await prisma.invoice.findUnique({ where: { viewToken } });
    if (!invoice) {
      return reply.status(404).send({ error: 'Invoice not found' });
    }
    if (invoice.status === 'PAID') {
      return reply.status(400).send({ error: 'Invoice already paid' });
    }
    if (invoice.status === 'VOID') {
      return reply.status(400).send({ error: 'Invoice has been voided' });
    }

    // If there's already a Stripe payment link, return it
    if (invoice.stripePaymentLink) {
      return { paymentUrl: invoice.stripePaymentLink };
    }

    try {
      const result = await createPaymentLink(invoice);
      if (!result) {
        return reply.status(500).send({ error: 'Payment service not configured' });
      }

      // Store the payment link and intent ID
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          stripePaymentLink: result.paymentLink,
          stripePaymentIntentId: result.paymentIntentId
        }
      });

      return { paymentUrl: result.paymentLink };
    } catch (error) {
      fastify.log.error('Stripe payment link creation failed:', error);
      return reply.status(500).send({ error: 'Failed to create payment session' });
    }
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

    const existingEvents = await prisma.calendarEvent.findMany({
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
  fastify.post('/booking', async (request, reply) => {
    const { name, email, date, time, notes, phone } = request.body || {};

    if (!name || !email || !date || !time) {
      return reply.status(400).send({ error: 'Name, email, date, and time are required' });
    }

    // Validate date format and time format
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
    const conflict = await prisma.calendarEvent.findFirst({
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
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true }
    });

    if (!adminUser) {
      return reply.status(500).send({ error: 'System configuration error' });
    }

    const event = await prisma.calendarEvent.create({
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
