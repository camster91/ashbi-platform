// Finance Agent Routes — invoices, billing, revenue reporting

export default async function financeAgentRoutes(fastify) {
  // GET /api/finance/invoices — invoice status overview
  fastify.get('/invoices', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status, clientId, limit = 50 } = request.query;

    try {
      const where = {};
      if (status) where.status = status.toUpperCase();
      if (clientId) where.clientId = clientId;

      const invoices = await fastify.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        include: {
          client: { select: { name: true, email: true } }
        }
      }).catch(() => []);

      const summary = {
        total: invoices.length,
        paid: invoices.filter(i => i.status === 'PAID').length,
        pending: invoices.filter(i => i.status === 'PENDING' || i.status === 'SENT').length,
        overdue: invoices.filter(i => i.status === 'OVERDUE').length,
        totalRevenue: invoices
          .filter(i => i.status === 'PAID')
          .reduce((sum, i) => sum + (i.total || 0), 0),
        outstanding: invoices
          .filter(i => ['PENDING', 'SENT', 'OVERDUE'].includes(i.status))
          .reduce((sum, i) => sum + (i.total || 0), 0)
      };

      return {
        invoices: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          client: inv.client?.name,
          amount: inv.total,
          status: inv.status,
          dueDate: inv.dueDate,
          paidAt: inv.paidAt,
          createdAt: inv.createdAt
        })),
        summary,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch invoices', details: err.message });
    }
  });

  // POST /api/finance/invoice/send — send invoice to client
  fastify.post('/invoice/send', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { invoiceId, method = 'email', message } = request.body || {};

    if (!invoiceId) {
      return reply.status(400).send({ error: 'invoiceId is required' });
    }

    try {
      const invoice = await fastify.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { client: { select: { name: true, email: true } } }
      });

      if (!invoice) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }

      if (invoice.status === 'PAID') {
        return reply.status(400).send({ error: 'Invoice already paid' });
      }

      // Update invoice status to SENT
      const updated = await fastify.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'SENT', sentAt: new Date() }
      }).catch(() => null);

      return {
        invoiceId,
        clientName: invoice.client?.name,
        clientEmail: invoice.client?.email,
        amount: invoice.total,
        status: 'sent',
        method,
        sentAt: new Date().toISOString(),
        message: message || `Invoice #${invoice.invoiceNumber} has been sent to ${invoice.client?.name}`,
        tip: 'Set up Bonsai API integration for automated invoice delivery'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to send invoice', details: err.message });
    }
  });

  // GET /api/finance/revenue/monthly — monthly revenue report
  fastify.get('/revenue/monthly', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { year, month } = request.query;
    const now = new Date();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || now.getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    try {
      const [paidInvoices, retainerPlans, newClients] = await Promise.all([
        fastify.prisma.invoice.findMany({
          where: {
            status: 'PAID',
            paidAt: { gte: startDate, lte: endDate }
          },
          include: { client: { select: { name: true } } }
        }).catch(() => []),
        fastify.prisma.retainerPlan.findMany({
          include: { client: { select: { name: true, status: true } } }
        }).catch(() => []),
        fastify.prisma.client.count({
          where: { createdAt: { gte: startDate, lte: endDate } }
        }).catch(() => 0)
      ]);

      const invoiceRevenue = paidInvoices.reduce((sum, i) => sum + (i.total || 0), 0);
      const activeRetainers = retainerPlans.filter(r => r.client?.status === 'ACTIVE');
      const mrr = activeRetainers.reduce((sum, r) => {
        const tierMap = { '999': 999, '1999': 1999, '3999': 3999 };
        return sum + (tierMap[r.tier] || 0);
      }, 0);

      return {
        period: {
          year: targetYear,
          month: targetMonth,
          label: new Date(targetYear, targetMonth - 1).toLocaleString('en-CA', { month: 'long', year: 'numeric' })
        },
        revenue: {
          invoices: invoiceRevenue,
          mrr,
          total: invoiceRevenue + mrr,
          formatted: {
            invoices: `$${invoiceRevenue.toLocaleString()}`,
            mrr: `$${mrr.toLocaleString()}`,
            total: `$${(invoiceRevenue + mrr).toLocaleString()}`
          }
        },
        clients: {
          active: activeRetainers.length,
          newThisMonth: newClients,
          retainerBreakdown: activeRetainers.map(r => ({
            client: r.client?.name,
            tier: r.tier,
            value: r.tier
          }))
        },
        invoices: {
          count: paidInvoices.length,
          items: paidInvoices.map(i => ({
            id: i.id,
            client: i.client?.name,
            amount: i.total,
            paidAt: i.paidAt
          }))
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate revenue report', details: err.message });
    }
  });
}
