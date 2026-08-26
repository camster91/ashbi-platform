// Invoice routes — full CRUD + send + PDF + payments + templates
import { createPaymentLink } from '../services/stripe.service.js';
import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import { generateInvoiceNumber } from '../utils/invoice.js';
import { createPublicAccessWindow, publicAccessFailure } from '../utils/public-document-access.js';
import { validateBody, createInvoiceSchema, updateInvoiceSchema, markInvoicePaidSchema, sendInvoiceSchema, lineItemTemplateCreateSchema, invoiceBulkIdsSchema, invoiceBulkArchiveSchema, bulkMarkPaidSchema, proposalInvoiceDraftSchema } from '../validators/schemas.js';
import { sendInvoiceDeliveryEmail } from '../services/email.service.js';
import { createDraftInvoiceFromProposal } from '../services/proposalInvoice.service.js';
import { createManualInvoiceDraft } from '../services/manualInvoice.service.js';
import { invalidateInvoiceCheckout } from '../services/invoiceCheckoutInvalidation.service.js';

const VOID_UNDO_WINDOW_MS = 10_000;
const VOIDABLE_STATUSES = new Set(['DRAFT', 'SENT', 'OVERDUE']);

export default async function invoiceRoutes(fastify) {

  function calcTotals(lineItems, taxRate, discountAmount = 0) {
    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const discounted = Math.max(0, subtotal - discountAmount);
    const tax = parseFloat(((discounted * taxRate) / 100).toFixed(2));
    const total = parseFloat((discounted + tax).toFixed(2));
    return { subtotal: parseFloat(subtotal.toFixed(2)), tax, total };
  }

  function processLineItems(lineItems) {
    return lineItems.map((li, idx) => ({
      description: li.description,
      itemType: li.itemType || 'LABOR',
      quantity: parseFloat(li.quantity) || 1,
      unitPrice: parseFloat(li.unitPrice) || 0,
      total: parseFloat(((parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0)).toFixed(2)),
      position: li.position ?? idx,
    }));
  }

  function flagOverdue(inv) {
    const now = new Date();
    const isOverdue = inv.status === 'SENT' && inv.dueDate && new Date(inv.dueDate) < now;
    return { ...inv, isOverdue };
  }

  // ─── GET / — list invoices ──────────────────────────────────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const { clientId, projectId, status, search, sort = 'createdAt', order = 'desc', limit, offset } = request.query;

    const where = {};
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (status && status !== 'OVERDUE') where.status = status;
    if (status === 'OVERDUE') {
      where.status = 'SENT';
      where.dueDate = { lt: new Date() };
    }
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      fastify.prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { lineItems: true, payments: true } }
        },
        orderBy: { [sort]: order },
        take: limit ? parseInt(limit) : undefined,
        skip: offset ? parseInt(offset) : undefined,
      }),
      fastify.prisma.invoice.count({ where })
    ]);

    return {
      invoices: invoices.map(flagOverdue),
      total,
      stats: await getStats()
    };
  });

  async function getStats() {
    // Performance: previously this ran `findMany({ select })` with no `where`
    // and pulled every invoice row to compute aggregates in JS — a full table
    // scan on every GET /api/invoices call. Replace with `groupBy` so the
    // database does the aggregation server-side. The overdue total still
    // needs a separate aggregation since it depends on `dueDate < now`.
    const now = new Date();
    const [byStatus, overdueAgg] = await Promise.all([
      fastify.prisma.invoice.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { total: true },
      }),
      fastify.prisma.invoice.aggregate({
        where: { status: 'SENT', dueDate: { lt: now } },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    const stats = {
      draft: { count: 0, amount: 0 },
      sent: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      overdue: { count: overdueAgg._count._all, amount: overdueAgg._sum.total ?? 0 },
      void: { count: 0, amount: 0 },
      totalOutstanding: 0,
    };

    for (const row of byStatus) {
      const key = row.status.toLowerCase();
      if (stats[key]) {
        stats[key].count = row._count._all;
        stats[key].amount = row._sum.total ?? 0;
      }
    }

    stats.totalOutstanding = stats.sent.amount + stats.overdue.amount;
    return stats;
  }

  // ─── GET /stats — collections dashboard ────────────────────────────────────
  fastify.get('/stats', { onRequest: [fastify.authenticate] }, async () => {
    return getStats();
  });

  // ─── GET /templates — line item templates ──────────────────────────────────
  fastify.get('/templates', { onRequest: [fastify.authenticate] }, async () => {
    return fastify.prisma.lineItemTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });
  });

  // ─── POST /templates — create template ─────────────────────────────────────
  fastify.post('/templates', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(lineItemTemplateCreateSchema),
  }, async (request) => {
    const { name, description, itemType = 'LABOR', unitPrice, unit = 'hr' } = request.body;
    return fastify.prisma.lineItemTemplate.create({
      data: { name, description, itemType, unitPrice: parseFloat(unitPrice), unit }
    });
  });

  // ─── DELETE /templates/:id ──────────────────────────────────────────────────
  fastify.delete('/templates/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await fastify.prisma.lineItemTemplate.update({
      where: { id: request.params.id },
      data: { isActive: false }
    });
    return { success: true };
  });

  // ─── GET /:id — single invoice ──────────────────────────────────────────────
  fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        },
        createdBy: { select: { id: true, name: true, email: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
      }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    return flagOverdue(invoice);
  });

  // ─── POST / — create invoice ────────────────────────────────────────────────
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [validateBody(createInvoiceSchema)],
  }, async (request) => createManualInvoiceDraft({
    prisma: request.prisma,
    actorUserId: request.user.id,
    input: request.body,
    invoiceNumberFactory: () => generateInvoiceNumber(),
  }));

  // ─── PUT /:id — update invoice ──────────────────────────────────────────────
  fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [validateBody(updateInvoiceSchema)] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft invoices can be fully updated. Use /mark-paid or /void for status changes.' });

    const {
      title,
      lineItems,
      notes,
      internalNotes,
      dueDate,
      issueDate,
      taxRate,
      taxType,
      discountAmount,
      projectId,
      isRecurring,
      recurringInterval,
    } = request.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (notes !== undefined) updateData.notes = notes;
    if (internalNotes !== undefined) updateData.internalNotes = internalNotes;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (issueDate !== undefined) updateData.issueDate = new Date(issueDate);
    if (taxRate !== undefined) updateData.taxRate = parseFloat(taxRate);
    if (taxType !== undefined) updateData.taxType = taxType;
    if (discountAmount !== undefined) updateData.discountAmount = parseFloat(discountAmount);
    if (projectId !== undefined) updateData.projectId = projectId || null;
    if (isRecurring !== undefined) updateData.isRecurring = isRecurring;
    if (recurringInterval !== undefined) updateData.recurringInterval = recurringInterval;

    if (lineItems) {
      await fastify.prisma.invoiceLineItem.deleteMany({ where: { invoiceId: request.params.id } });
      const processedItems = processLineItems(lineItems);
      const effectiveTaxRate = updateData.taxRate ?? invoice.taxRate;
      const effectiveDiscount = updateData.discountAmount ?? invoice.discountAmount;
      const { subtotal, tax, total } = calcTotals(processedItems, effectiveTaxRate, effectiveDiscount);
      updateData.subtotal = subtotal;
      updateData.tax = tax;
      updateData.total = total;

      await fastify.prisma.invoiceLineItem.createMany({
        data: processedItems.map(li => ({ ...li, invoiceId: request.params.id }))
      });
    } else if (taxRate !== undefined || discountAmount !== undefined) {
      // Recalculate tax if rate/discount changed without new line items
      const existingItems = await fastify.prisma.invoiceLineItem.findMany({
        where: { invoiceId: request.params.id }
      });
      const effectiveTaxRate = updateData.taxRate ?? invoice.taxRate;
      const effectiveDiscount = updateData.discountAmount ?? invoice.discountAmount;
      const { subtotal, tax, total } = calcTotals(existingItems, effectiveTaxRate, effectiveDiscount);
      updateData.subtotal = subtotal;
      updateData.tax = tax;
      updateData.total = total;
    }

    return fastify.prisma.invoice.update({
      where: { id: request.params.id },
      data: updateData,
      include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: true,
      }
    });
  });

  // ─── DELETE /:id — archive/void invoice ────────────────────────────────────
  fastify.delete('/:id', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Cannot void a paid invoice' });
    if (!VOIDABLE_STATUSES.has(invoice.status)) {
      return reply.status(409).send({ error: 'Invoice is already void or cannot be voided' });
    }

    try {
      const updated = await invalidateInvoiceCheckout({
        prisma: request.prisma,
        invoice,
        action: 'VOID',
        actorUserId: request.user.id,
      });
      return {
        ...updated,
        undoExpiresAt: new Date(updated.voidedAt.getTime() + VOID_UNDO_WINDOW_MS),
        reconciliationRequired: false,
      };
    } catch (error) {
      if (!error.reconciliationRequired) throw error;
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        reconciliationRequired: true,
      });
    }
  });

  fastify.post('/:id/undo-void', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    return request.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findUnique({ where: { id: request.params.id } });
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      if (invoice.status !== 'VOID' || !VOIDABLE_STATUSES.has(invoice.voidedFromStatus)) {
        return reply.status(409).send({ error: 'Invoice void has already been undone' });
      }
      if (!invoice.voidedAt || Date.now() - invoice.voidedAt.getTime() > VOID_UNDO_WINDOW_MS) {
        return reply.status(410).send({ error: 'Invoice void undo window has expired' });
      }

      return transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          status: invoice.voidedFromStatus,
          voidedAt: null,
          voidedFromStatus: null,
        },
      });
    }, { isolationLevel: 'Serializable' });
  });

  // ─── POST /:id/send — send invoice to client ───────────────────────────────
  fastify.post('/:id/send', { onRequest: [fastify.authenticate], preHandler: [validateBody(sendInvoiceSchema)] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft invoices can be sent' });

    const access = createPublicAccessWindow(invoice.dueDate);
    const claimed = await request.prisma.invoice.updateMany({
      where: { id: request.params.id, status: 'DRAFT' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: access.revokedAt,
      },
    });
    if (claimed.count !== 1) {
      return reply.status(409).send({ error: 'Invoice delivery was already started' });
    }

    const preparedInvoice = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
        lineItems: { orderBy: { position: 'asc' } },
      },
    });

    let paymentLink = null;

    // Attempt Stripe payment link
    try {
      const result = await createPaymentLink(preparedInvoice);
      if (result) {
        paymentLink = result.paymentLink;
        await request.prisma.invoice.update({
          where: { id: request.params.id },
          data: {
            stripePaymentLink: result.paymentLink,
            stripeCheckoutSessionId: result.checkoutSessionId,
            stripePaymentIntentId: result.paymentIntentId,
          },
        });
      }
    } catch (err) {
      fastify.log.warn({ err }, 'Stripe payment link failed — sending without it');
    }

    // Stub Mailgun email send
    const primaryContact = preparedInvoice.client?.contacts?.[0];
    let emailSent = false;
    if (primaryContact?.email) {
      try {
        const viewUrl = `${process.env.APP_URL || 'https://hub.ashbi.ca'}/portal/invoice/${preparedInvoice.viewToken}`;
        const delivery = await sendInvoiceDeliveryEmail({
          to: primaryContact.email,
          clientName: primaryContact.name || preparedInvoice.client.name,
          invoiceNumber: preparedInvoice.invoiceNumber,
          total: preparedInvoice.total,
          dueDate: preparedInvoice.dueDate,
          viewUrl,
          paymentLink,
        });
        emailSent = delivery.ok;
        if (emailSent) fastify.log.info('Invoice email accepted by delivery provider');
        else fastify.log.warn({ emailError: delivery.error }, 'Invoice email delivery unavailable');
      } catch (emailErr) {
        fastify.log.warn({ emailErr }, 'Email send failed — invoice still marked sent');
      }
    }

    const updated = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } }
      }
    });

    return { ...flagOverdue(updated), emailSent };
  });

  // ─── GET /:id/pdf — generate and download PDF ──────────────────────────────
  fastify.get('/:id/pdf', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        },
        createdBy: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
      }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });

    try {
      const pdfBuffer = await generateInvoicePdf(invoice);
      const filename = `${invoice.invoiceNumber}.pdf`;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', pdfBuffer.length);
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error({ err }, 'PDF generation failed');
      return reply.status(500).send({ error: 'PDF generation failed' });
    }
  });

  // ─── POST /:id/pdf — legacy stub, redirect to GET ──────────────────────────
  fastify.post('/:id/pdf', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return reply.redirect(301, `/api/invoices/${request.params.id}/pdf`);
  });

  // ─── POST /:id/mark-paid — mark as paid ────────────────────────────────────
  fastify.post('/:id/mark-paid', { onRequest: [fastify.authenticate], preHandler: [validateBody(markInvoicePaidSchema)] }, async (request, reply) => {
    const { method, paymentMethod: requestedPaymentMethod, paymentNotes, transactionId, amount, paidAt } = request.body;
    const paymentMethod = requestedPaymentMethod || method || 'OTHER';
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Invoice already paid' });
    if (invoice.status === 'VOID') return reply.status(400).send({ error: 'Cannot pay a voided invoice' });

    const paidDate = paidAt ? new Date(paidAt) : new Date();
    const paidAmount = amount ?? invoice.total;

    const updated = await request.prisma.$transaction(async (tx) => {
      const paidInvoice = await tx.invoice.update({
        where: { id: request.params.id },
        data: { status: 'PAID', paidAt: paidDate, paymentMethod, paymentNotes: paymentNotes || null, transactionId: transactionId || null }
      });
      await tx.invoicePayment.create({
        data: {
          invoiceId: request.params.id,
          amount: paidAmount,
          amountMinor: Math.round(paidAmount * 100),
          currency: invoice.currency,
          method: paymentMethod,
          notes: paymentNotes || null,
          transactionId: transactionId || null,
          paidAt: paidDate,
        }
      });
      return paidInvoice;
    });

    return updated;
  });

  // ─── POST /:id/payment-link — generate or return Stripe payment link ───────
  fastify.post('/:id/payment-link', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: { client: true, lineItems: true }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'SENT') return reply.status(409).send({ error: 'Only sent invoices can have a payment link' });
    const accessFailure = publicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    // Return existing link if already generated
    if (invoice.stripePaymentLink) {
      return { paymentLinkUrl: invoice.stripePaymentLink };
    }

    try {
      const result = await createPaymentLink(invoice);
      if (!result) return reply.status(503).send({ error: 'Stripe not configured' });

      const updated = await request.prisma.invoice.update({
        where: { id: request.params.id },
        data: {
          stripePaymentLink: result.paymentLink,
          stripeCheckoutSessionId: result.checkoutSessionId,
          stripePaymentIntentId: result.paymentIntentId,
        }
      });

      return { paymentLinkUrl: updated.stripePaymentLink };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to create Stripe payment link');
      return reply.status(500).send({ error: 'Failed to create payment link', detail: err.message });
    }
  });

  // ─── GET /:id/payments — payment history ───────────────────────────────────
  fastify.get('/:id/payments', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
      select: { id: true }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });

    return request.prisma.invoicePayment.findMany({
      where: { invoiceId: request.params.id },
      include: {
        refunds: { orderBy: { providerCreatedAt: 'desc' } },
      },
      orderBy: { paidAt: 'desc' }
    });
  });

  // ─── POST /from-proposal/:proposalId — create from approved proposal ────────
  fastify.post('/from-proposal/:proposalId', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(proposalInvoiceDraftSchema),
  }, async (request) => createDraftInvoiceFromProposal({
    prisma: request.prisma,
    proposalId: request.params.proposalId,
    actorUserId: request.user.id,
    taxDecision: request.body,
    invoiceNumberFactory: () => generateInvoiceNumber(),
  }));

  // ─── GET /client/:viewToken — public client view ────────────────────────────
  fastify.get('/client/:viewToken', { config: { public: true } }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { viewToken: request.params.viewToken },
      include: {
        client: { select: { name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        createdBy: { select: { name: true } }
      }
    });
    const accessFailure = publicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    // Don't expose internal notes in public view
    const {
      internalNotes,
      stripePaymentIntentId,
      stripeCheckoutSessionId,
      createdById,
      clientId,
      projectId,
      proposalId,
      viewToken,
      publicAccessRevokedAt,
      ...safe
    } = invoice;
    return safe;
  });

  fastify.post('/:id/public-link/revoke', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    try {
      await invalidateInvoiceCheckout({
        prisma: request.prisma,
        invoice,
        action: 'REVOKE',
        actorUserId: request.user.id,
      });
      return { revoked: true, reconciliationRequired: false };
    } catch (error) {
      if (!error.reconciliationRequired) throw error;
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        reconciliationRequired: true,
      });
    }
  });

  fastify.post('/:id/resend', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
        lineItems: { orderBy: { position: 'asc' } },
      },
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'SENT') return reply.status(409).send({ error: 'Only sent invoices can be resent' });
    const accessFailure = publicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    const contact = invoice.client?.contacts?.[0];
    if (!contact?.email) return reply.status(409).send({ error: 'Primary client email is missing' });
    const viewUrl = `${process.env.APP_URL || 'https://hub.ashbi.ca'}/portal/invoice/${invoice.viewToken}`;
    const delivery = await sendInvoiceDeliveryEmail({
      to: contact.email,
      clientName: contact.name || invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      dueDate: invoice.dueDate,
      viewUrl,
      paymentLink: invoice.stripePaymentLink,
    });
    if (!delivery.ok) return reply.status(503).send({ error: 'Invoice email delivery is unavailable', retryable: true });
    return { emailSent: true };
  });

  fastify.post('/:id/public-link/rotate', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (!['SENT', 'PAID'].includes(invoice.status)) return reply.status(409).send({ error: 'Invoice has not been sent' });
    try {
      const updated = await invalidateInvoiceCheckout({
        prisma: request.prisma,
        invoice,
        action: 'ROTATE',
        actorUserId: request.user.id,
      });
      return {
        viewToken: updated.viewToken,
        publicAccessExpiresAt: updated.publicAccessExpiresAt,
        reconciliationRequired: false,
      };
    } catch (error) {
      if (!error.reconciliationRequired) throw error;
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        reconciliationRequired: true,
      });
    }
  });

  // ─── POST /bulk/mark-paid — mark multiple invoices as paid ──────────────────
  fastify.post('/bulk/mark-paid', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(bulkMarkPaidSchema),
  }, async (request, reply) => {
    const { ids, paymentMethod } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    const paidDate = new Date();
    const method = paymentMethod || 'OTHER';
    let updated = 0;

    for (const id of ids) {
      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } });
      if (!invoice || invoice.status === 'PAID' || invoice.status === 'VOID') continue;

      await fastify.prisma.$transaction([
        fastify.prisma.invoice.update({
          where: { id },
          data: { status: 'PAID', paidAt: paidDate, paymentMethod: method }
        }),
        fastify.prisma.invoicePayment.create({
          data: { invoiceId: id, amount: invoice.total, method, paidAt: paidDate }
        })
      ]);
      updated++;
    }

    return { updated };
  });

  // ─── POST /bulk/send — send multiple invoices ───────────────────────────────
  fastify.post('/bulk/send', {
    onRequest: [fastify.authenticate],
    preHandler: validateBody(invoiceBulkIdsSchema),
  }, async (request, reply) => {
    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    let sent = 0;
    for (const id of ids) {
      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id },
        include: { client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } } }
      });
      if (!invoice || invoice.status !== 'DRAFT') continue;

      await fastify.prisma.invoice.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date() }
      });
      sent++;
    }

    return { sent };
  });

  // ─── POST /bulk/archive — archive (void) multiple invoices ──────────────────
  fastify.post('/bulk/archive', { onRequest: [fastify.authenticate],
    preHandler: validateBody(invoiceBulkArchiveSchema),
  }, async (request, reply) => {
    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    let archived = 0;
    for (const id of ids) {
      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } });
      if (!invoice || invoice.status === 'PAID' || invoice.status === 'VOID') continue;

      await fastify.prisma.invoice.update({
        where: { id },
        data: { status: 'VOID' }
      });
      archived++;
    }

    return { archived };
  });
}

// ─── Invoice HTML/PDF generator ──────────────────────────────────────────────
function generateInvoiceHTML(invoice) {
  const client = invoice.client;
  const lineItems = invoice.lineItems || [];
  const issueDate = new Date(invoice.issueDate || invoice.createdAt).toLocaleDateString('en-CA', { dateStyle: 'long' });
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA', { dateStyle: 'long' }) : 'Upon receipt';

  const fmt = (n) => `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lineItemsHTML = lineItems.map(li => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${li.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:center;">${li.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;">${fmt(li.unitPrice)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:500;">${fmt(li.total)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1e293b; background:#fff; }
    .page { max-width:800px; margin:40px auto; padding:48px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:48px; }
    .brand { font-size:24px; font-weight:700; color:#2563eb; letter-spacing:-0.5px; }
    .brand-sub { font-size:12px; color:#64748b; margin-top:2px; }
    .invoice-meta { text-align:right; }
    .invoice-number { font-size:28px; font-weight:700; color:#1e293b; }
    .status-badge { display:inline-block; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-top:6px; }
    .status-DRAFT { background:#f1f5f9; color:#64748b; }
    .status-SENT { background:#dbeafe; color:#1d4ed8; }
    .status-PAID { background:#dcfce7; color:#16a34a; }
    .status-OVERDUE { background:#fee2e2; color:#dc2626; }
    .status-VOID { background:#f1f5f9; color:#94a3b8; }
    .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:40px; }
    .party-label { font-size:11px; font-weight:600; text-transform:uppercase; color:#64748b; letter-spacing:0.5px; margin-bottom:8px; }
    .party-name { font-size:16px; font-weight:600; margin-bottom:4px; }
    .party-detail { font-size:13px; color:#64748b; }
    .dates { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:40px; padding:20px 24px; background:#f8fafc; border-radius:8px; }
    .date-label { font-size:11px; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; }
    .date-value { font-size:14px; font-weight:500; }
    table { width:100%; border-collapse:collapse; margin-bottom:24px; }
    thead th { background:#f8fafc; padding:10px 12px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; }
    thead th:not(:first-child) { text-align:right; }
    thead th:nth-child(2) { text-align:center; }
    .totals { margin-left:auto; width:280px; }
    .totals-row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
    .totals-row.discount { color:#16a34a; }
    .totals-row.total { border-top:2px solid #1e293b; margin-top:8px; padding-top:12px; font-size:18px; font-weight:700; }
    .notes { margin-top:40px; padding:20px 24px; background:#f8fafc; border-radius:8px; }
    .notes-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin-bottom:8px; }
    .notes-text { font-size:14px; color:#475569; line-height:1.6; }
    .footer { margin-top:48px; padding-top:24px; border-top:1px solid #e2e8f0; text-align:center; font-size:12px; color:#94a3b8; }
    .pay-btn { display:inline-block; margin-top:24px; padding:14px 32px; background:#2563eb; color:#fff; text-decoration:none; border-radius:8px; font-weight:600; font-size:15px; }
    @media print {
      .page { margin:0; padding:32px; }
      .no-print { display:none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <div class="brand">Ashbi Design</div>
        <div class="brand-sub">ashbi.ca · hello@ashbi.ca</div>
      </div>
      <div class="invoice-meta">
        <div class="invoice-number">INVOICE</div>
        <div style="font-size:16px;color:#64748b;margin-top:4px;">${invoice.invoiceNumber}</div>
        <span class="status-badge status-${invoice.status}">${invoice.status}</span>
      </div>
    </div>

    <div class="parties">
      <div>
        <div class="party-label">From</div>
        <div class="party-name">Ashbi Design</div>
        <div class="party-detail">Toronto, Ontario, Canada</div>
        <div class="party-detail">HST: 123456789 RT 0001</div>
      </div>
      <div>
        <div class="party-label">Bill To</div>
        <div class="party-name">${client?.name || 'Client'}</div>
        ${client?.domain ? `<div class="party-detail">${client.domain}</div>` : ''}
      </div>
    </div>

    <div class="dates">
      <div>
        <div class="date-label">Issue Date</div>
        <div class="date-value">${issueDate}</div>
      </div>
      <div>
        <div class="date-label">Due Date</div>
        <div class="date-value">${dueDate}</div>
      </div>
    </div>

    ${invoice.title ? `<h2 style="margin-bottom:16px;font-size:18px;color:#1e293b;">${invoice.title}</h2>` : ''}

    <table>
      <thead>
        <tr>
          <th style="width:50%">Description</th>
          <th style="width:12%;text-align:center;">Qty</th>
          <th style="width:19%;text-align:right;">Unit Price</th>
          <th style="width:19%;text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHTML}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${fmt(invoice.subtotal)}</span>
      </div>
      ${invoice.discountAmount > 0 ? `
      <div class="totals-row discount">
        <span>Discount</span>
        <span>-${fmt(invoice.discountAmount)}</span>
      </div>` : ''}
      <div class="totals-row">
        <span>${invoice.taxType || 'HST'} (${invoice.taxRate || 13}%)</span>
        <span>${fmt(invoice.tax)}</span>
      </div>
      <div class="totals-row total">
        <span>Total Due</span>
        <span>${fmt(invoice.total)} CAD</span>
      </div>
      ${invoice.status === 'PAID' && invoice.payments?.length > 0 ? `
      <div class="totals-row" style="color:#16a34a;margin-top:8px;">
        <span>✓ Paid</span>
        <span>${fmt(invoice.total)}</span>
      </div>` : ''}
    </div>

    ${invoice.notes ? `
    <div class="notes">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${invoice.notes}</div>
    </div>` : ''}

    ${invoice.stripePaymentLink && invoice.status === 'SENT' ? `
    <div style="text-align:center;margin-top:40px;" class="no-print">
      <a href="${invoice.stripePaymentLink}" class="pay-btn">Pay Now — ${fmt(invoice.total)} CAD</a>
    </div>` : ''}

    <div class="footer">
      <p>Thank you for your business!</p>
      <p style="margin-top:4px;">Ashbi Design · Toronto, Ontario · ashbi.ca</p>
    </div>
  </div>
</body>
</html>`;
}
