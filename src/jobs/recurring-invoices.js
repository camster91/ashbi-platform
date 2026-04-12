// Recurring Invoices Cron Job
// Runs on startup and every hour to generate new invoices from recurring templates

import prisma from '../config/db.js';
import { generateInvoiceNumber } from '../utils/invoice.js';

const ONE_HOUR = 60 * 60 * 1000;

function getNextRecurringDate(currentDate, interval) {
  const d = new Date(currentDate);
  switch (interval) {
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'ANNUALLY':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}

async function processRecurringInvoices() {
  const now = new Date();
  console.log(`[recurring-invoices] Checking for due recurring invoices at ${now.toISOString()}`);

  try {
    const dueInvoices = await prisma.invoice.findMany({
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
      console.log('[recurring-invoices] No recurring invoices due');
      return;
    }

    console.log(`[recurring-invoices] Found ${dueInvoices.length} recurring invoice(s) due`);

    for (const invoice of dueInvoices) {
      try {
        const invoiceNumber = await generateInvoiceNumber();

        // Copy line items without id/invoiceId
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

        // Create new invoice as DRAFT
        const newInvoice = await prisma.invoice.create({
          data: {
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
          }
        });

        // Advance the original invoice's recurringNextDate
        const nextDate = getNextRecurringDate(
          invoice.recurringNextDate,
          invoice.recurringInterval
        );

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { recurringNextDate: nextDate }
        });

        console.log(
          `[recurring-invoices] Generated ${invoiceNumber} from recurring invoice ${invoice.invoiceNumber} ` +
          `for client "${invoice.client?.name || invoice.clientId}". Next due: ${nextDate.toISOString()}`
        );
      } catch (err) {
        console.error(`[recurring-invoices] Error processing invoice ${invoice.invoiceNumber}:`, err);
      }
    }
  } catch (err) {
    console.error('[recurring-invoices] Error querying recurring invoices:', err);
  }
}

export function startRecurringInvoicesJob() {
  console.log('[recurring-invoices] Starting recurring invoices job (runs every hour)');

  // Run immediately on startup
  processRecurringInvoices();

  // Then run every hour
  setInterval(processRecurringInvoices, ONE_HOUR);
}
