// Invoice routes — full CRUD + send + PDF + payments + templates
import { CheckoutNotPayableError, CLEARED_CHECKOUT_FIELDS, checkoutPersistenceData, createPaymentLink, ensureCheckoutSession, expireCheckoutSession, handleCheckoutFailure, handleWebhook, recordCheckoutAuditEvents, recordCompletedCheckout, recordRefusedCheckout } from '../services/stripe.service.js';
import { generateInvoicePdf } from '../utils/generate-invoice-pdf.js';
import { deliveryFieldsFromSend, withDeliveryState } from '../services/mailgun-delivery.service.js';
import { createNumberedInvoice, isUniqueViolationOn } from '../utils/invoice.js';
import { createPublicAccessWindow, invoicePublicAccessFailure, INVOICE_OPEN_STATUSES } from '../utils/public-document-access.js';
import { validateBody, createInvoiceSchema, updateInvoiceSchema, markInvoicePaidSchema, sendInvoiceSchema, lineItemTemplateCreateSchema, invoiceBulkIdsSchema, invoiceBulkArchiveSchema, bulkMarkPaidSchema } from '../validators/schemas.js';
import { sendInvoiceDeliveryEmail } from '../services/email.service.js';
import { recordRequestAuditEvent } from '../services/audit-event.service.js';
import { defaultInvoiceCurrency, normalizeInvoiceCurrency } from '../utils/money.js';
import { InvalidPaymentAmountError, InvoiceOverpaymentError, recordManualPayment, settleInvoiceManually } from '../services/invoice-payment.service.js';
import { invoiceAmountPaid, invoiceBalance, SENT_INVOICE_STATUSES, UNPAID_INVOICE_STATUSES, withInvoiceBalance } from '../utils/invoice-balance.js';
import { clampTake } from '../utils/query-limits.js';
import { firstRecurringDate } from '../jobs/recurring-invoices.js';
import { proposalTaxRate, taxTypeForRate } from '../utils/proposal-totals.js';
import { invoiceTotals, lineTotal } from '../utils/money-totals.js';

const HST_RATE = 13; // Ontario HST
const VOID_UNDO_WINDOW_MS = 10_000;
// Any unpaid invoice (DRAFT, SENT, VIEWED, OVERDUE) can be voided.
const VOIDABLE_STATUSES = new Set(['DRAFT', ...UNPAID_INVOICE_STATUSES]);

class InvoiceHasPaymentsError extends Error {}

export { isUniqueViolationOn };

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// Proposals are pre-tax. One converted from an estimate carries the
// estimate's tax rate in its metadata (proposalDataFromEstimate in
// estimate.routes.js) so the invoice bills the estimate's total; any other
// proposal is invoiced at the Ontario HST default. The proposal pages show
// the same tax (proposalTaxSummary in src/utils/proposal-totals.js).
export function proposalInvoiceTaxRate(proposal) {
  return proposalTaxRate(proposal);
}

// The list's ?sort= and ?order= come from the query string; anything outside
// these allowlists falls back to the default rather than reaching Prisma.
export const INVOICE_SORT_FIELDS = Object.freeze([
  'createdAt', 'updatedAt', 'issueDate', 'dueDate', 'invoiceNumber', 'title', 'status', 'total', 'paidAt', 'sentAt',
]);

export function invoiceListOrderBy(sort, order) {
  const field = INVOICE_SORT_FIELDS.includes(sort) ? sort : 'createdAt';
  const direction = order === 'asc' || order === 'desc' ? order : 'desc';
  return { [field]: direction };
}

// Bulk send works through each draft sequentially (Checkout + email per
// invoice), so the batch is capped to keep one request well inside proxy and
// client timeouts; larger batches are sent in several requests.
export const INVOICE_BULK_SEND_MAX = 25;

/**
 * @param {any} fastify
 * @param {{ createPaymentLink?: Function, sendInvoiceDeliveryEmail?: Function, expireCheckoutSession?: Function }} [options]
 *   Test seams for the Stripe and email providers; production uses the defaults.
 */
export default async function invoiceRoutes(fastify, options = {}) {
  const createCheckout = options.createPaymentLink || createPaymentLink;
  const deliverInvoiceEmail = options.sendInvoiceDeliveryEmail || sendInvoiceDeliveryEmail;
  const expireSession = options.expireCheckoutSession || expireCheckoutSession;

  // A voided invoice must not stay payable through a stored Checkout session:
  // forget it on the invoice and ask Stripe to expire it (best-effort; a
  // completion that still arrives is refused as INVOICE_VOID).
  // `reason` names why the session is retired (voided invoice, payment
  // recorded) in the warning when Stripe could not expire it.
  async function retireCheckoutSession(invoice, reason = 'Voided invoice') {
    if (!invoice.stripeCheckoutSessionId) return;
    const expired = await expireSession(invoice.stripeCheckoutSessionId, { log: fastify.log });
    if (!expired) fastify.log.warn({ invoiceId: invoice.id, reason }, `${reason}: Checkout session was not expired at Stripe`);
  }

  // Shared with estimates, proposals and the recurring job
  // (src/utils/money-totals.js) so every document rounds the same cents.
  function calcTotals(lineItems, taxRate, discountAmount = 0) {
    const { subtotal, tax, total } = invoiceTotals(lineItems, taxRate, discountAmount);
    return { subtotal, tax, total };
  }

  function processLineItems(lineItems) {
    return lineItems.map((li, idx) => ({
      description: li.description,
      itemType: li.itemType || 'LABOR',
      quantity: parseFloat(li.quantity) || 1,
      unitPrice: parseFloat(li.unitPrice) || 0,
      total: lineTotal(parseFloat(li.quantity) || 1, parseFloat(li.unitPrice) || 0),
      position: li.position ?? idx,
    }));
  }

  // A manual payment both settles the invoice and adds a ledger row; both are
  // audited so either can be found from its own entity id.
  // A partial payment writes only the ledger event; invoice.paid is written
  // when the payments cover the total and the invoice moved to PAID.
  async function recordPaymentAudit(request, { invoice, paymentId, amount, method, bulk, fullyPaid = true }) {
    if (fullyPaid) {
      await recordRequestAuditEvent(fastify.prisma, request, {
        action: 'invoice.paid',
        entityId: invoice.id,
        metadata: { fromStatus: invoice.status, toStatus: 'PAID', method, bulk, total: invoice.total, currency: invoice.currency },
      });
    }
    await recordRequestAuditEvent(fastify.prisma, request, {
      action: 'payment.recorded',
      entityId: paymentId ?? null,
      metadata: { invoiceId: invoice.id, amount, method, source: 'manual', bulk, currency: invoice.currency },
    });
  }

  // Overdue = stored OVERDUE (set by the overdue job) or SENT/VIEWED past
  // its due date (before the job has run).
  function isOverdueInvoice(inv, now = new Date()) {
    return inv.status === 'OVERDUE' || Boolean(SENT_INVOICE_STATUSES.includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < now);
  }

  function flagOverdue(inv) {
    return withDeliveryState({ ...inv, isOverdue: isOverdueInvoice(inv) });
  }

  // ─── GET / — list invoices ──────────────────────────────────────────────────
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const { clientId, projectId, status, search, sort, order, limit, offset } = request.query;

    const where = {};
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    // "SENT" lists every sent-but-unpaid invoice, including any marked
    // VIEWED (VIEWED behaves exactly like SENT).
    if (status === 'SENT') where.status = { in: [...SENT_INVOICE_STATUSES] };
    else if (status && status !== 'OVERDUE') where.status = status;
    const and = [];
    if (status === 'OVERDUE') {
      and.push({ OR: [
        { status: 'OVERDUE' },
        { status: { in: [...SENT_INVOICE_STATUSES] }, dueDate: { lt: new Date() } },
      ] });
    }
    if (search) {
      and.push({ OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
      ] });
    }
    if (and.length) where.AND = and;

    const [invoices, total] = await Promise.all([
      fastify.prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { lineItems: true, payments: true } }
        },
        orderBy: invoiceListOrderBy(sort, order),
        ...(limit ? { take: clampTake(limit) } : {}),
        ...(Number.parseInt(offset, 10) > 0 ? { skip: Number.parseInt(offset, 10) } : {}),
      }),
      fastify.prisma.invoice.count({ where })
    ]);

    // amountPaid / balanceDue from the payment rows (partial payments keep
    // an invoice open).
    const paidRows = invoices.length > 0
      ? await fastify.prisma.invoicePayment.groupBy({
        by: ['invoiceId'],
        where: { invoiceId: { in: invoices.map((inv) => inv.id) } },
        _sum: { amount: true },
      })
      : [];
    const paidByInvoice = new Map(paidRows.map((row) => [row.invoiceId, row._sum.amount ?? 0]));

    return {
      invoices: invoices.map((inv) => flagOverdue({ ...inv, ...invoiceBalance(inv.total, paidByInvoice.get(inv.id) ?? 0) })),
      total,
      stats: await getStats()
    };
  });

  // Collection stats. Buckets are disjoint so no invoice is counted twice:
  //   sent    = SENT or VIEWED and not yet past due
  //   overdue = stored OVERDUE, or SENT/VIEWED past its due date
  //   totalOutstanding = sent + overdue (every open invoice once)
  // Money is grouped by currency in `byCurrency`; the top-level amounts are
  // only filled when every invoice shares one currency (`mixedCurrency`
  // false), otherwise they are null because adding currencies is meaningless.
  // Counts are always totals across currencies.
  async function getStats() {
    const now = new Date();
    const [byStatus, sentPastDue, openPayments] = await Promise.all([
      fastify.prisma.invoice.groupBy({
        by: ['status', 'currency'],
        _count: { _all: true },
        _sum: { total: true },
      }),
      fastify.prisma.invoice.groupBy({
        by: ['currency'],
        where: { status: { in: [...SENT_INVOICE_STATUSES] }, dueDate: { lt: now } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      // Partial payments on open invoices: outstanding money is the balance.
      fastify.prisma.invoicePayment.findMany({
        where: { invoice: { status: { in: [...UNPAID_INVOICE_STATUSES] } } },
        select: { amount: true, invoice: { select: { status: true, currency: true, dueDate: true } } },
      }),
    ]);

    const emptyBuckets = () => ({
      draft: { count: 0, amount: 0 },
      sent: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
      void: { count: 0, amount: 0 },
      totalOutstanding: 0,
    });
    const totals = emptyBuckets();
    const byCurrency = {};
    const bucketFor = (currency) => (byCurrency[currency || 'CAD'] ??= emptyBuckets());
    const add = (buckets, key, count, amount) => {
      buckets[key].count += count;
      buckets[key].amount = roundMoney(buckets[key].amount + amount);
    };

    for (const row of byStatus) {
      // A VIEWED invoice counts as sent.
      const key = row.status === 'VIEWED' ? 'sent' : row.status === 'OVERDUE' ? 'overdue' : row.status.toLowerCase();
      if (!totals[key]) continue;
      const count = row._count._all;
      const amount = row._sum.total ?? 0;
      add(totals, key, count, amount);
      add(bucketFor(row.currency), key, count, amount);
    }
    // Move SENT/VIEWED-but-past-due from "sent" to "overdue".
    for (const row of sentPastDue) {
      const count = row._count._all;
      const amount = row._sum.total ?? 0;
      for (const buckets of [totals, bucketFor(row.currency)]) {
        add(buckets, 'sent', -count, -amount);
        add(buckets, 'overdue', count, amount);
      }
    }
    for (const payment of openPayments) {
      const key = isOverdueInvoice(payment.invoice, now) ? 'overdue' : 'sent';
      for (const buckets of [totals, bucketFor(payment.invoice.currency)]) {
        buckets[key].amount = roundMoney(buckets[key].amount - payment.amount);
      }
    }
    for (const buckets of [totals, ...Object.values(byCurrency)]) {
      buckets.totalOutstanding = roundMoney(buckets.sent.amount + buckets.overdue.amount);
    }

    const currencies = Object.keys(byCurrency).sort();
    const mixedCurrency = currencies.length > 1;
    if (mixedCurrency) {
      for (const key of ['draft', 'sent', 'paid', 'overdue', 'void']) totals[key].amount = null;
      totals.totalOutstanding = null;
    }
    return { ...totals, currencies, mixedCurrency, byCurrency };
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
    return flagOverdue(await withInvoiceBalance(fastify.prisma, invoice));
  });

  // ─── POST / — create invoice ────────────────────────────────────────────────
  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [validateBody(createInvoiceSchema)] }, async (request, reply) => {
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
      currency,
    } = request.body;

    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });
    if (lineItems.length === 0) return reply.status(400).send({ error: 'At least one line item is required' });

    const client = await fastify.prisma.client.findFirst({ where: { id: clientId }, select: { id: true, name: true } });
    if (!client) return reply.status(404).send({ error: 'Client not found' });

    const processedItems = processLineItems(lineItems);
    const { subtotal, tax, total } = calcTotals(processedItems, taxRate, discountAmount);
    const effectiveIssueDate = issueDate ? new Date(issueDate) : new Date();

    // The number is allocated from the organization's counter inside the
    // same transaction as the insert (src/utils/invoice.js).
    return createNumberedInvoice(fastify.prisma, {
      organizationId: request.user.organizationId,
      data: {
        title: title || `Invoice for ${client.name}`,
        currency: normalizeInvoiceCurrency(currency) || defaultInvoiceCurrency(),
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
        issueDate: effectiveIssueDate,
        isRecurring,
        recurringInterval: isRecurring ? recurringInterval : null,
        // The recurring job selects on recurringNextDate, so it is set here
        // (and kept in step by PUT /:id); without it nothing ever recurs.
        recurringNextDate: isRecurring ? firstRecurringDate(effectiveIssueDate, recurringInterval) : null,
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
  fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [validateBody(updateInvoiceSchema)] }, async (request, reply) => {
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
      currency,
    } = request.body;

    const updateData = {};
    if (title !== undefined && title !== '') updateData.title = title;
    if (currency !== undefined) updateData.currency = normalizeInvoiceCurrency(currency);
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
    // Keep the recurring schedule in step with the flag, interval and issue
    // date: turning recurrence off clears it, any change recomputes it.
    const nextIsRecurring = isRecurring ?? invoice.isRecurring;
    if (!nextIsRecurring) {
      if (isRecurring === false) {
        updateData.recurringInterval = null;
        updateData.recurringNextDate = null;
      }
    } else if (isRecurring !== undefined || recurringInterval !== undefined || issueDate !== undefined) {
      const interval = (recurringInterval !== undefined ? recurringInterval : invoice.recurringInterval) || null;
      if (!interval) return reply.status(400).send({ error: 'recurringInterval is required for a recurring invoice' });
      updateData.recurringInterval = interval;
      updateData.recurringNextDate = firstRecurringDate(updateData.issueDate ?? invoice.issueDate, interval);
    }

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

  // Void one invoice: compare-and-set from the status read (only a voidable
  // status), retire its Checkout session and audit the transition. Returns
  // the voided invoice, or null when it changed (paid, voided) meanwhile.
  // An invoice with recorded payments is never voided (the money would be
  // left unapplied): { refused: 'has_payments' }. The transition takes the
  // row lock that every payment claims first (invoice-settlement.js), so the
  // payment check after it sees any payment that committed before.
  async function voidInvoice(request, invoice, { bulk = false } = {}) {
    const voidedAt = new Date();
    const outcome = await request.prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: [...VOIDABLE_STATUSES] } },
        data: { status: 'VOID', voidedAt, voidedFromStatus: invoice.status, ...CLEARED_CHECKOUT_FIELDS },
      });
      if (claimed.count !== 1) return null;
      if (await invoiceAmountPaid(tx, invoice.id) > 0) throw new InvoiceHasPaymentsError();
      return { voidedAt };
    }).catch((error) => {
      if (error instanceof InvoiceHasPaymentsError) return { refused: 'has_payments' };
      throw error;
    });
    if (!outcome || outcome.refused) return outcome;
    await retireCheckoutSession(invoice);
    await recordRequestAuditEvent(request.prisma, request, {
      action: 'invoice.voided',
      entityId: invoice.id,
      metadata: {
        fromStatus: invoice.status,
        toStatus: 'VOID',
        total: invoice.total,
        currency: invoice.currency,
        ...(bulk ? { bulk: true } : {}),
      },
    });
    return { voidedAt };
  }

  // ─── DELETE /:id — archive/void invoice ────────────────────────────────────
  fastify.delete('/:id', { onRequest: [fastify.adminOnly] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Cannot void a paid invoice' });
    if (!VOIDABLE_STATUSES.has(invoice.status)) {
      return reply.status(409).send({ error: 'Invoice is already void or cannot be voided' });
    }

    const voided = await voidInvoice(request, invoice);
    if (voided?.refused === 'has_payments') {
      return reply.status(409).send({ error: 'Invoice has recorded payments and cannot be voided', code: 'INVOICE_HAS_PAYMENTS' });
    }
    if (!voided) return reply.status(409).send({ error: 'Invoice is already void or cannot be voided' });
    const updated = await request.prisma.invoice.findUnique({ where: { id: invoice.id } });
    return {
      ...updated,
      undoExpiresAt: new Date(voided.voidedAt.getTime() + VOID_UNDO_WINDOW_MS),
    };
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
    }, { isolationLevel: 'Serializable' }).catch((error) => {
      // A voided retainer invoice whose month was billed again since cannot
      // come back: one live retainer invoice per client and month.
      if (isUniqueViolationOn(error, { index: 'invoices_clientId_retainerPeriod_live_key', fields: ['retainerPeriod'] })) {
        return reply.status(409).send({ error: 'This retainer month has been invoiced again since the void', code: 'RETAINER_PERIOD_ALREADY_INVOICED' });
      }
      throw error;
    });
  });

  // Single path for sending a draft (used by POST /:id/send and bulk send):
  // issue the public link, try a Checkout session, email the client, audit.
  // Returns { statusCode, body } so bulk send can report per item.
  async function sendDraftInvoice(request, invoiceId, { bulk = false } = {}) {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: {
          include: { contacts: { where: { isPrimary: true }, take: 1 } }
        },
        lineItems: { orderBy: { position: 'asc' } }
      }
    });
    if (!invoice) return { statusCode: 404, body: { error: 'Invoice not found' } };
    if (invoice.status !== 'DRAFT') return { statusCode: 400, body: { error: 'Only draft invoices can be sent', code: 'ALREADY_SENT' } };

    // The link is not tied to the due date: it stays valid while the invoice
    // is open (see invoicePublicAccessFailure), so overdue reminders work.
    const access = createPublicAccessWindow();
    // Claim DRAFT -> SENT with the new token before any side effect, so two
    // concurrent sends (single or bulk) cannot both create a Checkout session
    // and email the client, and the emailed link is the stored one.
    const claimed = await fastify.prisma.invoice.updateMany({
      where: { id: invoice.id, status: 'DRAFT' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        viewToken: access.token,
        publicAccessExpiresAt: access.expiresAt,
        publicAccessRevokedAt: access.revokedAt,
        // A recurring draft from before recurringNextDate was maintained (or
        // one the backfill skipped because it was a draft) starts recurring
        // once it is issued.
        ...(invoice.isRecurring && invoice.recurringInterval && !invoice.recurringNextDate
          ? { recurringNextDate: firstRecurringDate(invoice.issueDate, invoice.recurringInterval) }
          : {}),
      },
    });
    if (claimed.count !== 1) {
      return { statusCode: 409, body: { error: 'Invoice is already being sent or was sent', code: 'ALREADY_SENT' } };
    }
    const updateData = {};

    // Attempt Stripe payment link
    try {
      // The Checkout return URLs must point at the token issued by this send.
      const checkoutInvoice = { ...(await withInvoiceBalance(fastify.prisma, invoice)), status: 'SENT', viewToken: access.token };
      const result = await createCheckout(checkoutInvoice);
      if (result) Object.assign(updateData, checkoutPersistenceData(checkoutInvoice, result));
    } catch (err) {
      fastify.log.warn({ err }, 'Stripe payment link failed — sending without it');
    }

    // Stub Mailgun email send
    const primaryContact = invoice.client?.contacts?.[0];
    let emailSent = false;
    if (primaryContact?.email) {
      try {
        const viewUrl = `${process.env.APP_URL || 'https://hub.ashbi.ca'}/portal/invoice/${access.token}`;
        const delivery = await deliverInvoiceEmail({
          to: primaryContact.email,
          clientName: primaryContact.name || invoice.client.name,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          viewUrl,
          invoiceId: invoice.id,
        });
        emailSent = delivery.ok;
        Object.assign(updateData, deliveryFieldsFromSend(delivery));
        if (emailSent) fastify.log.info('Invoice email accepted by delivery provider');
        else fastify.log.warn({ emailError: delivery.error }, 'Invoice email delivery unavailable');
      } catch (emailErr) {
        fastify.log.warn({ emailErr }, 'Email send failed — invoice still marked sent');
      }
    }

    const updated = await fastify.prisma.invoice.update({
      where: { id: invoice.id },
      data: updateData,
      include: {
        client: { select: { id: true, name: true } },
        lineItems: { orderBy: { position: 'asc' } }
      }
    });

    await recordRequestAuditEvent(fastify.prisma, request, {
      action: 'invoice.sent',
      entityId: updated.id,
      metadata: {
        fromStatus: invoice.status,
        toStatus: 'SENT',
        deliveryAccepted: emailSent,
        paymentLinkAttached: Boolean(updateData.stripePaymentLink),
        total: invoice.total,
        currency: invoice.currency,
        ...(bulk ? { bulk: true } : {}),
      },
    });

    return { statusCode: 200, body: { ...flagOverdue(updated), emailSent } };
  }

  // ─── POST /:id/send — send invoice to client ───────────────────────────────
  fastify.post('/:id/send', { onRequest: [fastify.authenticate], preHandler: [validateBody(sendInvoiceSchema)] }, async (request, reply) => {
    const { statusCode, body } = await sendDraftInvoice(request, request.params.id);
    return reply.status(statusCode).send(body);
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

  // ─── POST /:id/mark-paid — record a payment ────────────────────────────────
  // `amount` defaults to the remaining balance. A payment that leaves a
  // balance keeps the invoice open (amountPaid/balanceDue in the response);
  // one that covers the total marks it PAID. More than the balance is a 400.
  fastify.post('/:id/mark-paid', { onRequest: [fastify.authenticate], preHandler: [validateBody(markInvoicePaidSchema)] }, async (request, reply) => {
    const { method, paymentMethod: requestedPaymentMethod, paymentNotes, transactionId, amount, paidAt } = request.body;
    const paymentMethod = requestedPaymentMethod || method || 'OTHER';
    const invoice = await fastify.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (invoice.status === 'PAID') return reply.status(400).send({ error: 'Invoice already paid' });
    if (invoice.status === 'VOID') return reply.status(400).send({ error: 'Cannot pay a voided invoice' });
    // A draft has not been issued: send it first, then record payments.
    if (invoice.status === 'DRAFT') return reply.status(400).send({ error: 'Send the invoice before recording a payment', code: 'INVOICE_NOT_SENT' });

    const paidDate = paidAt ? new Date(paidAt) : new Date();

    // Compare-and-set: the payment, any transition to PAID and its outbox
    // event (docs/event-outbox.md) commit together, and only if the invoice
    // is still payable, so a concurrent mark-paid or Stripe settlement cannot
    // double-pay (src/services/invoice-payment.service.js).
    let recorded;
    try {
      recorded = await recordManualPayment(fastify.prisma, {
        invoice,
        method: paymentMethod,
        amount: amount ?? null,
        paidAt: paidDate,
        invoiceFields: { paymentNotes: paymentNotes || null, transactionId: transactionId || null },
        paymentFields: { notes: paymentNotes || null, transactionId: transactionId || null },
        correlationId: request.id,
      });
    } catch (error) {
      if (error instanceof InvoiceOverpaymentError) {
        return reply.status(400).send({ error: 'Payment exceeds the balance due', code: error.code, balanceDue: error.balanceDue });
      }
      if (error instanceof InvalidPaymentAmountError) {
        return reply.status(400).send({ error: 'Payment amount must be greater than zero', code: error.code });
      }
      throw error;
    }
    if (!recorded) return reply.status(409).send({ error: 'Invoice is no longer payable', code: 'INVOICE_NOT_PAYABLE' });
    // The session the payment cleared under the row lock, which may have
    // been stored after this request first read the invoice.
    await retireCheckoutSession({ id: invoice.id, stripeCheckoutSessionId: recorded.clearedCheckoutSessionId }, 'Payment recorded');

    await recordPaymentAudit(request, {
      invoice, paymentId: recorded.payment?.id, amount: recorded.amount, method: paymentMethod, bulk: false, fullyPaid: recorded.fullyPaid,
    });

    return recorded.invoice;
  });

  // ─── POST /:id/payment-link — generate or return Stripe payment link ───────
  fastify.post('/:id/payment-link', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await fastify.prisma.invoice.findUnique({
      where: { id: request.params.id },
      include: { client: true, lineItems: true }
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (!INVOICE_OPEN_STATUSES.includes(invoice.status)) return reply.status(409).send({ error: 'Only sent or overdue invoices can have a payment link' });
    const accessFailure = invoicePublicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });

    try {
      const result = await ensureCheckoutSession(fastify.prisma, invoice);
      if (!result) return reply.status(503).send({ error: 'Stripe not configured' });
      return { paymentLinkUrl: result.paymentLink, reused: result.reused };
    } catch (err) {
      if (err instanceof CheckoutNotPayableError) return reply.status(409).send({ error: 'Invoice is not awaiting payment', code: err.code });
      fastify.log.error({ err }, 'Failed to create Stripe payment link');
      return reply.status(500).send({ error: 'Failed to create payment link' });
    }
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

    const invoiceInclude = {
      client: { select: { id: true, name: true } },
      lineItems: { orderBy: { position: 'asc' } },
      payments: true,
    };
    const existing = await fastify.prisma.invoice.findUnique({
      where: { proposalId: proposal.id },
      include: invoiceInclude
    });
    if (existing) return existing;

    const processedItems = proposal.lineItems.map((li, idx) => ({
      description: li.description,
      itemType: 'LABOR',
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      total: li.total,
      position: idx,
    }));

    const taxRate = proposalInvoiceTaxRate(proposal);
    const { subtotal, tax, total } = calcTotals(processedItems, taxRate, proposal.discount || 0);

    try {
      return await createNumberedInvoice(fastify.prisma, {
        organizationId: request.user.organizationId,
        data: {
          title: `Invoice for: ${proposal.title}`,
          // Proposals carry no currency; use the organization default.
          currency: defaultInvoiceCurrency(),
          clientId: proposal.clientId,
          projectId: proposal.projectId || null,
          proposalId: proposal.id,
          subtotal,
          discountAmount: proposal.discount || 0,
          taxRate,
          // HST only for the 13% Ontario default; another rate gets the
          // neutral "Tax" rather than a tax name it may not be.
          taxType: taxTypeForRate(taxRate),
          tax,
          total,
          notes: `Invoice for proposal: ${proposal.title}`,
          createdById: request.user.id,
          lineItems: { create: processedItems }
        },
        include: invoiceInclude
      });
    } catch (error) {
      // Only the one-invoice-per-proposal constraint means "already created";
      // any other unique violation is a real error.
      if (!isUniqueViolationOn(error, { index: 'invoices_proposalId_key', fields: ['proposalId'] })) throw error;
      return fastify.prisma.invoice.findUnique({
        where: { proposalId: proposal.id },
        include: invoiceInclude
      });
    }
  });

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
    const accessFailure = invoicePublicAccessFailure(invoice);
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
      deliveryMessageId,
      deliveryError,
      stripeCheckoutAttempt,
      ...safe
    } = invoice;
    return safe;
  });

  fastify.post('/:id/public-link/revoke', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    await request.prisma.invoice.update({
      where: { id: invoice.id },
      data: { publicAccessRevokedAt: new Date(), ...CLEARED_CHECKOUT_FIELDS },
    });
    return { revoked: true };
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
    if (!INVOICE_OPEN_STATUSES.includes(invoice.status)) return reply.status(409).send({ error: 'Only sent or overdue invoices can be resent' });
    const accessFailure = invoicePublicAccessFailure(invoice);
    if (accessFailure) return reply.status(accessFailure.statusCode).send({ error: accessFailure.error });
    const contact = invoice.client?.contacts?.[0];
    if (!contact?.email) return reply.status(409).send({ error: 'Primary client email is missing' });
    const viewUrl = `${process.env.APP_URL || 'https://hub.ashbi.ca'}/portal/invoice/${invoice.viewToken}`;
    const delivery = await sendInvoiceDeliveryEmail({
      to: contact.email,
      clientName: contact.name || invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      viewUrl,
      invoiceId: invoice.id,
    });
    await request.prisma.invoice.update({ where: { id: invoice.id }, data: deliveryFieldsFromSend(delivery) });
    if (!delivery.ok) return reply.status(503).send({ error: 'Invoice email delivery is unavailable', retryable: true });
    return { emailSent: true };
  });

  fastify.post('/:id/public-link/rotate', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const invoice = await request.prisma.invoice.findUnique({ where: { id: request.params.id } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    if (![...INVOICE_OPEN_STATUSES, 'PAID'].includes(invoice.status)) return reply.status(409).send({ error: 'Invoice has not been sent' });
    const access = createPublicAccessWindow();
    return request.prisma.invoice.update({
      where: { id: invoice.id },
      data: { viewToken: access.token, publicAccessExpiresAt: access.expiresAt, publicAccessRevokedAt: null, ...CLEARED_CHECKOUT_FIELDS },
      select: { viewToken: true, publicAccessExpiresAt: true },
    });
  });

  // ─── POST /stripe-webhook ───────────────────────────────────────────────────
  fastify.post('/stripe-webhook', { config: { rawBody: true, public: true } }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) return reply.status(400).send({ error: 'Missing stripe-signature header' });

    let event;
    try {
      event = await handleWebhook(request.rawBody || request.body, signature);
    } catch (err) {
      fastify.log.error({ errorName: err?.name }, 'Stripe webhook verification failed');
      return reply.status(400).send({ error: 'Webhook verification failed' });
    }

    if (event.type === 'checkout.session.completed') {
      try {
        const result = await recordCompletedCheckout(fastify.prisma, event, { correlationId: request.id });
        await recordCheckoutAuditEvents(fastify.prisma, request, event, result);
      } catch (err) {
        const failure = handleCheckoutFailure(err, { event, route: '/api/invoices/stripe-webhook', log: fastify.log });
        await recordRefusedCheckout(fastify.prisma, request, event, failure);
        // Permanent rejections are acknowledged so Stripe stops retrying them.
        if (failure.acknowledged) return reply.status(200).send({ received: true, recorded: false, code: failure.code });
        return reply.status(failure.statusCode).send({ error: failure.error, code: failure.code });
      }
    }

    return { received: true };
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
    // Additive to the original `{ updated }` response: why each other id was
    // left alone (not_found, already_paid, void, draft, invalid_amount, or
    // changed when another payment settled it between the read and the
    // compare-and-set).
    const skipped = [];

    for (const id of ids) {
      const invoice = await fastify.prisma.invoice.findUnique({ where: { id } });
      if (!invoice) { skipped.push({ id, reason: 'not_found' }); continue; }
      if (invoice.status === 'PAID') { skipped.push({ id, reason: 'already_paid' }); continue; }
      if (invoice.status === 'VOID') { skipped.push({ id, reason: 'void' }); continue; }
      if (invoice.status === 'DRAFT') { skipped.push({ id, reason: 'draft' }); continue; }

      // Settles the remaining balance (after any partial payments). One
      // invoice that cannot take the payment never stops the rest.
      let settled;
      try {
        settled = await settleInvoiceManually(fastify.prisma, {
          invoice, method, paidAt: paidDate, correlationId: request.id,
        });
      } catch (error) {
        if (error instanceof InvoiceOverpaymentError || error instanceof InvalidPaymentAmountError) {
          skipped.push({ id, reason: 'invalid_amount' });
          continue;
        }
        throw error;
      }
      if (!settled) { skipped.push({ id, reason: 'changed' }); continue; }
      await retireCheckoutSession({ id: invoice.id, stripeCheckoutSessionId: settled.clearedCheckoutSessionId }, 'Payment recorded');
      await recordPaymentAudit(request, { invoice, paymentId: settled.payment?.id, amount: settled.amount, method, bulk: true, fullyPaid: settled.fullyPaid });
      updated++;
    }

    return { updated, skipped };
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
    if (ids.length > INVOICE_BULK_SEND_MAX) {
      return reply.status(400).send({ error: `Send at most ${INVOICE_BULK_SEND_MAX} invoices per request` });
    }

    // Each invoice goes through the same path as a single send (claim, public
    // link, Checkout, email, audit); one failure never stops the rest.
    const results = [];
    for (const id of ids) {
      try {
        const { statusCode, body } = await sendDraftInvoice(request, id, { bulk: true });
        results.push(statusCode === 200
          ? { id, ok: true, statusCode, invoiceNumber: body.invoiceNumber, emailSent: body.emailSent }
          : { id, ok: false, statusCode, error: body.error, ...(body.code === 'ALREADY_SENT' ? { reason: 'already_sent' } : {}) });
      } catch (err) {
        fastify.log.error({ err, invoiceId: id }, 'Bulk invoice send failed for one invoice');
        results.push({ id, ok: false, statusCode: 500, error: 'Invoice could not be sent' });
      }
    }

    return { sent: results.filter((result) => result.ok).length, results };
  });

  // ─── POST /bulk/archive — archive (void) multiple invoices ──────────────────
  // Admin only, like DELETE /:id: each invoice goes through the same
  // compare-and-set void, Checkout retirement and audit event.
  fastify.post('/bulk/archive', { onRequest: [fastify.adminOnly],
    preHandler: validateBody(invoiceBulkArchiveSchema),
  }, async (request, reply) => {
    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids array is required' });
    }

    let archived = 0;
    // Additive to the original `{ archived }` response: why each other id
    // was left alone.
    const skipped = [];
    for (const id of ids) {
      const invoice = await request.prisma.invoice.findUnique({ where: { id } });
      if (!invoice) { skipped.push({ id, reason: 'not_found' }); continue; }
      if (!VOIDABLE_STATUSES.has(invoice.status)) {
        skipped.push({ id, reason: invoice.status === 'PAID' ? 'paid' : invoice.status === 'VOID' ? 'void' : 'not_voidable' });
        continue;
      }
      const voided = await voidInvoice(request, invoice, { bulk: true });
      if (voided?.refused === 'has_payments') { skipped.push({ id, reason: 'has_payments' }); continue; }
      if (!voided) { skipped.push({ id, reason: 'changed' }); continue; }
      archived++;
    }

    return { archived, skipped };
  });
}
