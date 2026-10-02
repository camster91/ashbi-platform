// Recurring invoice processor. Scheduling is owned by BullMQ in queue.js.

import { invoiceTotals } from '../utils/money-totals.js';
import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';
import { allocateInvoiceNumber } from '../utils/invoice.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';

export function getNextRecurringDate(currentDate, interval) {
  const d = new Date(currentDate);
  const originalDay = d.getUTCDate();
  const advanceMonths = (months) => {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(originalDay, lastDay));
  };
  switch (interval) {
    case 'MONTHLY':
      advanceMonths(1);
      break;
    case 'QUARTERLY':
      advanceMonths(3);
      break;
    case 'ANNUALLY':
      advanceMonths(12);
      break;
    default:
      advanceMonths(1);
  }
  return d;
}

// Which invoices can be the template for the next generated copy. Only an
// invoice that was actually issued to the client (SENT, OVERDUE or PAID)
// recurs: a DRAFT is still being edited and may never be sent, so copying it
// would bill the client for terms they never received, and a VOID invoice was
// cancelled. A recurring draft starts generating once it is sent; if its
// recurringNextDate already passed by then, the next run bills one copy and
// moves the date to the next future boundary (no backlog of copies).
export const RECURRING_SOURCE_STATUSES = Object.freeze(['SENT', 'OVERDUE', 'PAID']);

const INTERVAL_MONTHS = Object.freeze({ MONTHLY: 1, QUARTERLY: 3, ANNUALLY: 12 });

/** `anchor` plus `months`, on the anchor's day of month (clamped to the month's last day). */
function addMonthsFromAnchor(anchor, months) {
  const d = new Date(anchor);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * The next billing date after `now` for a recurring invoice anchored on
 * `anchor` (its issue date): the first anchor + k intervals (k >= 1) that is
 * after now. Every date is computed from the anchor, so a 31st-of-the-month
 * invoice bills on the last day of short months and on the 31st again after
 * them, and a back-dated or overdue source never generates a backlog.
 */
export function firstRecurringDate(anchor, interval, now = new Date()) {
  const months = INTERVAL_MONTHS[interval] ?? 1;
  const start = new Date(anchor ?? now);
  const elapsedMonths = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  let k = Math.max(1, Math.floor(elapsedMonths / months));
  let next = addMonthsFromAnchor(start, k * months);
  while (next <= now) {
    k += 1;
    next = addMonthsFromAnchor(start, k * months);
  }
  return next;
}

export async function processRecurringInvoices(tenantPrisma, invoiceNumberAllocator = allocateInvoiceNumber, { now = new Date() } = {}) {
  logger.debug({ now: now.toISOString() }, '[recurring-invoices] checking for due invoices');

  try {
    const dueInvoices = await tenantPrisma.invoice.findMany({
      where: {
        isRecurring: true,
        recurringNextDate: { lte: now },
        status: { in: [...RECURRING_SOURCE_STATUSES] }
      },
      include: {
        lineItems: true,
        client: { select: { id: true, name: true } }
      }
    });

    if (dueInvoices.length === 0) {
      logger.debug('[recurring-invoices] no recurring invoices due');
      return { examined: 0, generated: 0, failed: 0 };
    }

    logger.info({ count: dueInvoices.length }, '[recurring-invoices] found due invoices');

    let generated = 0;
    const failures = [];
    for (const invoice of dueInvoices) {
      try {
        const lineItemsData = invoice.lineItems.map((li, idx) => ({
          description: li.description,
          itemType: li.itemType || 'LABOR',
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
          position: li.position ?? idx,
        }));

        // Totals from the line items, with the arithmetic every invoice uses
        // (src/utils/money-totals.js).
        const { subtotal, tax, total } = invoiceTotals(lineItemsData, invoice.taxRate, invoice.discountAmount || 0);

        // One copy per run at most: the next date is the first boundary after
        // now (anchored on the issue date), so a source that was due for
        // several periods (worker outage, a draft sent late) is not billed
        // once per missed period.
        const nextDate = firstRecurringDate(invoice.issueDate ?? invoice.recurringNextDate, invoice.recurringInterval, now);
        // Claim and generate in one serializable transaction. A competing
        // worker either observes the advanced date or receives a retryable
        // serialization conflict; it cannot commit a second invoice.
        const result = await tenantPrisma.$transaction(async (tx) => {
          const claimed = await tx.invoice.updateMany({
            where: {
              id: invoice.id,
              isRecurring: true,
              recurringNextDate: invoice.recurringNextDate,
              status: { in: [...RECURRING_SOURCE_STATUSES] },
            },
            data: { recurringNextDate: nextDate },
          });
          if (claimed.count !== 1) return null;

          // Numbers are allocated from the organization's counter inside this
          // transaction; a serialization conflict rolls both back and BullMQ
          // retries.
          const { invoiceNumber, organizationId } = await invoiceNumberAllocator(tx, { clientId: invoice.clientId });
          return tx.invoice.create({ data: {
            invoiceNumber,
            organizationId,
            status: 'DRAFT',
            title: invoice.title,
            notes: invoice.notes,
            currency: invoice.currency,
            taxRate: invoice.taxRate,
            taxType: invoice.taxType,
            discountAmount: invoice.discountAmount || 0,
            subtotal,
            tax,
            total,
            clientId: invoice.clientId,
            projectId: invoice.projectId,
            createdById: invoice.createdById,
            issueDate: now,
            // Do NOT mark the new one as recurring — it's a generated instance
            isRecurring: false,
            lineItems: {
              create: lineItemsData
            }
          } });
        }, { isolationLevel: 'Serializable' });
        if (!result) continue;
        generated += 1;

        logger.info(
          {
            generated: result.invoiceNumber,
            fromRecurring: invoice.invoiceNumber,
            clientId: invoice.clientId,
            clientName: invoice.client?.name,
            nextDue: nextDate.toISOString(),
          },
          '[recurring-invoices] generated invoice'
        );
      } catch (err) {
        logger.error(
          { err, recurringInvoiceId: invoice.id, recurringInvoiceNumber: invoice.invoiceNumber },
          '[recurring-invoices] failed to process invoice'
        );
        failures.push({ invoiceId: invoice.id, error: err.message });
      }
    }
    if (failures.length > 0) {
      const error = new Error(`Failed to process ${failures.length} recurring invoice(s)`);
      error.failures = failures;
      throw error;
    }
    return { examined: dueInvoices.length, generated, failed: 0 };
  } catch (err) {
    logger.error({ err }, '[recurring-invoices] failed to query recurring invoices');
    throw err;
  }
}

export async function processRecurringInvoicesForAllOrganizations() {
  const organizationIds = await resolveTenantOrganizationIds(prisma);
  const results = [];
  for (const organizationId of organizationIds) {
    results.push(await runTenantJob(prisma, organizationId, processRecurringInvoices));
  }
  return { organizations: results };
}
