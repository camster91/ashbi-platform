// Recurring invoice processor. Scheduling is owned by BullMQ in queue.js.

import { prisma } from '../config/db.js';
import logger from '../utils/logger.js';
import { generateInvoiceNumber } from '../utils/invoice.js';
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

export async function processRecurringInvoices(tenantPrisma, invoiceNumberGenerator = generateInvoiceNumber) {
  const now = new Date();
  logger.debug({ now: now.toISOString() }, '[recurring-invoices] checking for due invoices');

  try {
    const dueInvoices = await tenantPrisma.invoice.findMany({
      where: {
        isRecurring: true,
        recurringNextDate: { lte: now },
        status: { not: 'VOID' }
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

        // Calculate totals from line items
        const subtotal = lineItemsData.reduce((sum, li) => sum + li.total, 0);
        const discounted = Math.max(0, subtotal - (invoice.discountAmount || 0));
        const tax = parseFloat(((discounted * invoice.taxRate) / 100).toFixed(2));
        const total = parseFloat((discounted + tax).toFixed(2));

        const nextDate = getNextRecurringDate(invoice.recurringNextDate, invoice.recurringInterval);
        // Invoice numbers are globally unique, so this lookup intentionally
        // uses the raw client rather than the tenant-scoped transaction.
        // A concurrent collision rolls the transaction back and BullMQ retries.
        const invoiceNumber = await invoiceNumberGenerator(prisma);

        // Claim and generate in one serializable transaction. A competing
        // worker either observes the advanced date or receives a retryable
        // serialization conflict; it cannot commit a second invoice.
        const result = await tenantPrisma.$transaction(async (tx) => {
          const claimed = await tx.invoice.updateMany({
            where: {
              id: invoice.id,
              isRecurring: true,
              recurringNextDate: invoice.recurringNextDate,
              status: { not: 'VOID' },
            },
            data: { recurringNextDate: nextDate },
          });
          if (claimed.count !== 1) return null;

          return tx.invoice.create({ data: {
            invoiceNumber,
            status: 'DRAFT',
            title: invoice.title,
            notes: invoice.notes,
            currency: invoice.currency,
            taxRate: invoice.taxRate,
            taxType: invoice.taxType,
            discountAmount: invoice.discountAmount || 0,
            subtotal: parseFloat(subtotal.toFixed(2)),
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
