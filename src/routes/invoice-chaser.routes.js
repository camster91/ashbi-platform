// Invoice Chaser Agent — drafts payment reminder emails for overdue invoices

import aiClient from '../ai/client.js';

export default async function invoiceChaserRoutes(fastify) {
  const { prisma } = fastify;

  // POST /invoice-chaser/chase — generate reminder emails for overdue invoices
  fastify.post('/chase', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { invoiceId } = request.body || {};

    // Get overdue invoices (or a specific one)
    const where = { status: 'SENT' };
    if (invoiceId) {
      where.id = invoiceId;
    } else {
      where.dueDate = { lt: new Date() };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        client: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 }
          }
        },
        lineItems: true,
      }
    });

    if (invoices.length === 0) {
      return { message: 'No overdue invoices found', reminders: [] };
    }

    const reminders = [];

    for (const invoice of invoices) {
      const daysOverdue = invoice.dueDate
        ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000)
        : 0;

      const contactName = invoice.client?.contacts?.[0]?.name || 'there';
      const contactEmail = invoice.client?.contacts?.[0]?.email || null;

      const system = `You are a professional but friendly payment reminder writer for Ashbi Design. You write firm but polite payment reminders that maintain the client relationship while being clear about the outstanding amount. Never be aggressive or threatening.`;

      const urgency = daysOverdue > 30 ? 'final notice' : daysOverdue > 14 ? 'second reminder' : 'friendly reminder';

      const prompt = `Write a ${urgency} email for an overdue invoice.

Details:
- Client: ${invoice.client?.name || 'Client'}
- Contact: ${contactName}
- Invoice #: ${invoice.invoiceNumber}
- Amount: $${invoice.total.toLocaleString()}
- Due date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}
- Days overdue: ${daysOverdue}
- Items: ${invoice.lineItems.map(li => li.description).join(', ')}

${invoice.stripePaymentLink ? `Payment link: ${invoice.stripePaymentLink}` : 'Payment: bank transfer or check'}

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body",
  "urgency": "${urgency}"
}

Sign off as Cameron Ashley, Ashbi Design.`;

      try {
        const result = await aiClient.chatJSON({ system, prompt, temperature: 0.4 });
        reminders.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.client?.name,
          contactEmail,
          amount: invoice.total,
          daysOverdue,
          ...result,
        });
      } catch (err) {
        fastify.log.error(`Invoice chaser error for ${invoice.invoiceNumber}:`, err);
        reminders.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: err.message,
        });
      }
    }

    return { total: reminders.length, reminders };
  });

  // GET /invoice-chaser/overdue — list overdue invoices
  fastify.get('/overdue', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const now = new Date();

    const invoices = await prisma.invoice.findMany({
      where: {
        status: 'SENT',
        dueDate: { lt: now }
      },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { lineItems: true } }
      },
      orderBy: { dueDate: 'asc' }
    });

    return invoices.map(inv => ({
      ...inv,
      daysOverdue: Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000),
    }));
  });
}
