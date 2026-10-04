// Invoice Chaser Agent — drafts payment reminder emails for overdue invoices

import aiClient from '../ai/client.js';
import { validateBody, invoiceChaserSchema } from '../validators/schemas.js';
import { isAiControlError, sendAiError } from '../ai/errors.js';
import { UNPAID_INVOICE_STATUSES, withInvoiceBalance } from '../utils/invoice-balance.js';
import { invoicePublicAccessFailure } from '../utils/public-document-access.js';
import { organizationNameFor, senderDescription, signOffName } from '../utils/organization-name.js';

function hubUrl() {
  return process.env.APP_URL || process.env.HUB_URL || 'https://hub.ashbi.ca';
}

// Like the overdue reminder job: chase what is still owed (the balance after
// partial payments), and link the public invoice page, which creates or
// refreshes a Checkout session for that balance on demand. A stored Checkout
// URL may be priced from an older balance, so it is never quoted.
function payLink(invoice) {
  if (!invoice.viewToken || invoicePublicAccessFailure(invoice)) return null;
  return `${hubUrl()}/portal/invoice/${invoice.viewToken}`;
}

// "Generate all" drafts one AI reminder per invoice, so a single request
// covers at most this many (the longest overdue first).
export const CHASE_ALL_LIMIT = 20;

// Both routes serve only the admin Invoice Chaser page (AdminRoute in
// web/src/App.jsx), so both are admin-only.
export default async function invoiceChaserRoutes(fastify) {
  const { prisma } = fastify;

  // POST /invoice-chaser/chase — generate reminder emails for overdue invoices
  fastify.post('/chase', {
    onRequest: [fastify.adminOnly],
    preHandler: validateBody(invoiceChaserSchema),
  }, async (request, reply) => {
    const { invoiceId } = request.body || {};

    // Get overdue invoices (or a specific one)
    // Open invoices: SENT, VIEWED (treated as SENT) or OVERDUE.
    const where = { status: { in: [...UNPAID_INVOICE_STATUSES] } };
    if (invoiceId) {
      where.id = invoiceId;
    } else {
      where.dueDate = { lt: new Date() };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      ...(invoiceId ? {} : { orderBy: { dueDate: 'asc' }, take: CHASE_ALL_LIMIT }),
      include: {
        client: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        },
        lineItems: true,
        payments: { select: { amount: true } },
      }
    });

    if (invoices.length === 0) {
      return { message: 'No overdue invoices found', reminders: [] };
    }

    const reminders = [];
    // Signed by the person generating the reminders and their workspace.
    const organizationName = await organizationNameFor(request);
    const signOff = signOffName(request.user, organizationName);

    for (const loaded of invoices) {
      const invoice = await withInvoiceBalance(prisma, loaded);
      if (!(invoice.balanceDue > 0)) continue;
      const link = payLink(invoice);
      const daysOverdue = invoice.dueDate
        ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000)
        : 0;

      const contactName = invoice.client?.contacts?.[0]?.name || 'there';
      const contactEmail = invoice.client?.contacts?.[0]?.email || null;

      const system = `You are a professional but friendly payment reminder writer for ${senderDescription(request.user, organizationName)}. You write firm but polite payment reminders that maintain the client relationship while being clear about the outstanding amount. Never be aggressive or threatening.`;

      const urgency = daysOverdue > 30 ? 'final notice' : daysOverdue > 14 ? 'second reminder' : 'friendly reminder';

      const prompt = `Write a ${urgency} email for an overdue invoice.

Details:
- Client: ${invoice.client?.name || 'Client'}
- Contact: ${contactName}
- Invoice #: ${invoice.invoiceNumber}
- Amount due: $${invoice.balanceDue.toLocaleString()}${invoice.amountPaid > 0 ? ` (of $${invoice.total.toLocaleString()}; $${invoice.amountPaid.toLocaleString()} already received)` : ''}
- Due date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA') : 'N/A'}
- Days overdue: ${daysOverdue}
- Items: ${invoice.lineItems.map(li => li.description).join(', ')}

${link ? `Payment link: ${link}` : 'Payment: bank transfer or check'}

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body",
  "urgency": "${urgency}"
}

${signOff ? `Sign off as ${signOff}.` : 'Sign off without a name; the sender will add one.'}`;

      try {
        const result = await aiClient.chatJSON({ system, prompt, temperature: 0.4 });
        reminders.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.client?.name,
          contactEmail,
          amount: invoice.balanceDue,
          total: invoice.total,
          amountPaid: invoice.amountPaid,
          daysOverdue,
          ...result,
        });
      } catch (err) {
        if (isAiControlError(err)) return sendAiError(reply, err);
        fastify.log.error(`Invoice chaser error for ${invoice.invoiceNumber}:`, err);
        reminders.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: 'Reminder could not be generated',
        });
      }
    }

    return { total: reminders.length, reminders };
  });

  // GET /invoice-chaser/overdue — list overdue invoices
  fastify.get('/overdue', {
    onRequest: [fastify.adminOnly]
  }, async (request) => {
    const now = new Date();

    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: [...UNPAID_INVOICE_STATUSES] },
        dueDate: { lt: now }
      },
      include: {
        client: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
        _count: { select: { lineItems: true } }
      },
      orderBy: { dueDate: 'asc' }
    });

    const withBalances = await Promise.all(invoices.map((inv) => withInvoiceBalance(prisma, inv)));
    return withBalances.map(({ payments: _payments, ...inv }) => ({
      ...inv,
      daysOverdue: Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000),
    }));
  });
}
