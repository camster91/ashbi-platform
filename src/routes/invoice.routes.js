// Invoice routes — full CRUD + send + PDF + payments + templates
import { createPaymentLink, handleWebhook } from '../services/stripe.service.js';

const HST_RATE = 13; // Ontario HST

export default async function invoiceRoutes(fastify) {

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const lastInvoice = await fastify.prisma.invoice.findFirst({
      where: { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' }
    });

    let nextNum = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNumber.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      nextNum = isNaN(lastNum) ? 1 : lastNum + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

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
    const now = new Date();
    const [allInvoices, overdueInvoices] = await Promise.all([
      fastify.prisma.invoice.findMany({
        select: { status: true, total: true, dueDate: true }
      }),
      fastify.prisma.invoice.findMany({
        where: { status: 'SENT', dueDate: { lt: now } },
        select: { id: true, total: true }
      })
    ]);

    const stats = {
      draft: { count: 0, amount: 0 },
      sent: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      overdue: { count: overdueInvoices.length, amount: 0 },
      void: { count: 0, amount: 0 },
      totalOutstanding: 0,
    };

    for (const inv of allInvoices) {
      const s = inv.status.toLowerCase();
      if (stats[s]) {
        stats[s].count++;
        stats[s].amount += inv.total;
      }
    }

    for (const inv of overdueInvoices) {
      stats.overdue.amount += inv.total;
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
  fastify.post('/templates', { onRequest: [fastify.authenticate] }, async (request) => {
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
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const {
      clientId,
      projectId,
      title,
      lineItems = [],
      notes,
      internalNotes,
      dueDate,
      issueDate,
      taxRate = HST_RATE,
      taxType = 'HST',
      discountAmount = 0,
      isRecurring = false,
      recurringInterval,
    } = request.body;

    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });
    if (lineItems.length === 0) return reply.status(400).send({ error: 'At least one line item is required' });

    const invoiceNumber = await generateInvoiceNumber();
    const processedItems = processLineItems(lineItems);
    const { subtotal, tax, total } = calcTotals(processedItems, taxRate, discountAmount);

    return fastify.prisma.invoice.create({
      data: {
        invoiceNumber,
        title: title || null,
        clientId,
        projectId: projectId || null,
        subtotal,
        discountAmount: parseFloat(discountAmount),
        taxRate: parseFloat(taxRate),
        taxType,
        tax,
        total,
        notes: notes || null,
        internalNotes: internalNotes || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        issueDate: issueDate ? new Date(issueDate) : new Date(),
        isRecurring,
        recurringInterval: isRecurring ? recurringInterval : null,
        createdById: request.user.id,
        lineItems: {
          create: processedItems
        }
      },
      include: {
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: true,
      }
    });
  });

  // ─── PUT /:id — update invoice ──────────────────────────────────────────────
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({ where: { id: request.params.id } });
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
    const invoice = await fastify.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Cannot void a paid invoice' });

    return fastify.prisma.invoice.update({
      where: { id: request.params.id },
      data: { status: 'VOID' }
    });
  });

  // ─── POST /:id/send — send invoice to client ───────────────────────────────
  fastify.post('/:id/send', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: {
          include: { contacts: { where: { isPrimary: true }, take: 1 } }
        },
        lineItems: { orderBy: { position: 'asc' } }
      }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'DRAFT') return reply.status(400).send({ error: 'Only draft invoices can be sent' });

    const updateData = { status: 'SENT', sentAt: new Date() };

    // Attempt Stripe payment link
    try {
      const result = await createPaymentLink(invoice);
      if (result) {
        updateData.stripePaymentLink = result.paymentLink;
        updateData.stripePaymentIntentId = result.paymentIntentId;
      }
    } catch (err) {
      fastify.log.warn({ err }, 'Stripe payment link failed — sending without it');
    }

    // Stub Mailgun email send
    const primaryContact = invoice.client?.contacts?.[0];
    if (primaryContact?.email) {
      try {
        const viewUrl = `${process.env.APP_URL || 'https://hub.ashbi.ca'}/view/invoice/${invoice.viewToken}`;
        await sendInvoiceEmail({
          to: primaryContact.email,
          name: primaryContact.name,
          invoice,
          viewUrl,
          paymentLink: updateData.stripePaymentLink,
        });
        fastify.log.info(`Invoice email sent to ${primaryContact.email}`);
      } catch (emailErr) {
        fastify.log.warn({ emailErr }, 'Email send failed — invoice still marked sent');
      }
    }

    const updated = await fastify.prisma.invoice.update({
      where: { id: request.params.id },
      data: updateData,
      include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } }
      }
    });

    return { ...flagOverdue(updated), emailSent: !!primaryContact?.email };
  });

  // ─── POST /:id/pdf — generate PDF (stub, returns HTML) ─────────────────────
  fastify.post('/:id/pdf', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: true,
        createdBy: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: true,
      }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });

    const html = generateInvoiceHTML(invoice);
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  // ─── POST /:id/mark-paid — mark as paid ────────────────────────────────────
  fastify.post('/:id/mark-paid', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { paymentMethod = 'BANK', paymentNotes, transactionId, paidAt } = request.body || {};
    const invoice = await fastify.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Invoice already paid' });
    if (invoice.status === 'VOID') return reply.status(400).send({ error: 'Cannot pay a voided invoice' });

    const paidDate = paidAt ? new Date(paidAt) : new Date();

    const [updated] = await fastify.prisma.$transaction([
      fastify.prisma.invoice.update({
        where: { id: request.params.id },
        data: { status: 'PAID', paidAt: paidDate, paymentMethod, paymentNotes: paymentNotes || null }
      }),
      fastify.prisma.invoicePayment.create({
        data: {
          invoiceId: request.params.id,
          amount: invoice.total,
          method: paymentMethod,
          notes: paymentNotes || null,
          transactionId: transactionId || null,
          paidAt: paidDate,
        }
      })
    ]);

    return updated;
  });

  // ─── GET /:id/payments — payment history ───────────────────────────────────
  fastify.get('/:id/payments', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      select: { id: true }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });

    return fastify.prisma.invoicePayment.findMany({
      where: { invoiceId: request.params.id },
      orderBy: { paidAt: 'desc' }
    });
  });

  // ─── POST /from-proposal/:proposalId — create from approved proposal ────────
  fastify.post('/from-proposal/:proposalId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const proposal = await fastify.prisma.proposal.findUnique({
      where: { id: request.params.proposalId },
      include: { client: true, lineItems: true }
    });

    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });
    if (proposal.status !== 'APPROVED') return reply.status(400).send({ error: 'Proposal must be approved first' });

    const invoiceNumber = await generateInvoiceNumber();
    const processedItems = proposal.lineItems.map((li, idx) => ({
      description: li.description,
      itemType: 'LABOR',
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      total: li.total,
      position: idx,
    }));

    const { subtotal, tax, total } = calcTotals(processedItems, HST_RATE, proposal.discount || 0);

    return fastify.prisma.invoice.create({
      data: {
        invoiceNumber,
        title: `Invoice for: ${proposal.title}`,
        clientId: proposal.clientId,
        projectId: proposal.projectId || null,
        proposalId: proposal.id,
        subtotal,
        discountAmount: proposal.discount || 0,
        taxRate: HST_RATE,
        taxType: 'HST',
        tax,
        total,
        notes: `Invoice for proposal: ${proposal.title}`,
        createdById: request.user.id,
        lineItems: { create: processedItems }
      },
      include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        payments: true,
      }
    });
  });

  // ─── GET /client/:viewToken — public client view ────────────────────────────
  fastify.get('/client/:viewToken', async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { viewToken: request.params.viewToken },
      include: {
        client: { select: { name: true } },
        lineItems: { orderBy: { position: 'asc' } },
        createdBy: { select: { name: true } }
      }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    // Don't expose internal notes in public view
    const { internalNotes, stripePaymentIntentId, ...safe } = invoice;
    return safe;
  });

  // ─── POST /stripe-webhook ───────────────────────────────────────────────────
  fastify.post('/stripe-webhook', { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) return reply.status(400).send({ error: 'Missing stripe-signature header' });

    try {
      const event = await handleWebhook(request.rawBody || request.body, signature);

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoiceId;
        if (invoiceId) {
          const invoice = await fastify.prisma.invoice.findUnique({ where: { id: invoiceId } });
          if (invoice && invoice.status !== 'PAID') {
            await fastify.prisma.$transaction([
              fastify.prisma.invoice.update({
                where: { id: invoiceId },
                data: {
                  status: 'PAID',
                  paidAt: new Date(),
                  paymentMethod: 'STRIPE',
                  stripePaymentIntentId: session.payment_intent || session.id,
                }
              }),
              fastify.prisma.invoicePayment.create({
                data: {
                  invoiceId,
                  amount: invoice.total,
                  method: 'STRIPE',
                  transactionId: session.payment_intent || session.id,
                  notes: 'Paid via Stripe Checkout',
                }
              })
            ]);
          }
        }
      }

      return { received: true };
    } catch (err) {
      fastify.log.error({ err }, 'Stripe webhook error');
      return reply.status(400).send({ error: 'Webhook verification failed' });
    }
  });
}

// ─── Email stub (Mailgun) ─────────────────────────────────────────────────────
async function sendInvoiceEmail({ to, name, invoice, viewUrl, paymentLink }) {
  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) return; // No-op if not configured

  const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA', { dateStyle: 'long' }) : 'upon receipt';
  const formData = new FormData();
  formData.append('from', `Cameron Ashley <noreply@${MAILGUN_DOMAIN}>`);
  formData.append('to', `${name} <${to}>`);
  formData.append('subject', `Invoice ${invoice.invoiceNumber} from Ashbi Design — $${invoice.total.toLocaleString('en-CA', { minimumFractionDigits: 2 })}`);
  formData.append('html', `
    <p>Hi ${name},</p>
    <p>Please find your invoice ${invoice.invoiceNumber} attached below.</p>
    <p><strong>Amount due: $${invoice.total.toLocaleString('en-CA', { minimumFractionDigits: 2 })} CAD</strong><br>
    Due: ${dueDate}</p>
    ${paymentLink ? `<p><a href="${paymentLink}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Pay Now</a></p>` : ''}
    <p><a href="${viewUrl}">View invoice online</a></p>
    ${invoice.notes ? `<p>${invoice.notes}</p>` : ''}
    <p>Thank you for your business!<br>Cameron Ashley<br>Ashbi Design</p>
  `);

  const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailgun error: ${text}`);
  }
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
