import { prisma } from '../index.js';

export default async function bookkeepingRoutes(fastify) {
  // Get unified transaction list
  fastify.get('/transactions', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, type, clientId, page = '1', limit = '50' } = request.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const dateFilter = {};
    if (startDate || endDate) {
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
    }

    const transactions = [];

    // Income from invoices
    const invoiceFilter = {};
    if (clientId) invoiceFilter.clientId = clientId;
    if (Object.keys(dateFilter).length > 0) invoiceFilter.createdAt = dateFilter;

    const invoices = await prisma.invoice.findMany({
      where: invoiceFilter,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });

    for (const inv of invoices) {
      transactions.push({
        id: inv.id,
        type: 'income',
        source: 'invoice',
        description: `Invoice ${inv.invoiceNumber || inv.id.slice(-6)}`,
        amount: inv.total,
        date: inv.createdAt,
        client: inv.client,
        status: inv.status,
        referenceId: inv.id
      });
    }

    // Payments received
    const paymentFilter = {};
    if (Object.keys(dateFilter).length > 0) paymentFilter.paidAt = dateFilter;

    const payments = await prisma.invoicePayment.findMany({
      where: paymentFilter,
      include: { invoice: { include: { client: { select: { id: true, name: true } } } } },
      orderBy: { paidAt: 'desc' }
    });

    for (const pay of payments) {
      transactions.push({
        id: pay.id,
        type: 'payment',
        source: 'payment',
        description: `Payment for Invoice ${pay.invoice?.invoiceNumber || pay.invoiceId?.slice(-6)}`,
        amount: pay.amount,
        date: pay.paidAt,
        client: pay.invoice?.client,
        status: 'RECEIVED',
        referenceId: pay.invoiceId
      });
    }

    // Expenses
    const expenseFilter = {};
    if (clientId) expenseFilter.clientId = clientId;
    if (Object.keys(dateFilter).length > 0) expenseFilter.date = dateFilter;

    const expenses = await prisma.expense.findMany({
      where: expenseFilter,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' }
    });

    for (const exp of expenses) {
      transactions.push({
        id: exp.id,
        type: 'expense',
        source: 'expense',
        description: exp.description || exp.category,
        amount: exp.amount,
        date: exp.date,
        client: exp.client,
        status: 'PAID',
        referenceId: exp.id
      });
    }

    // Sort all transactions by date
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Filter by type if specified
    const filtered = type ? transactions.filter(t => t.type === type) : transactions;

    return {
      transactions: filtered.slice(skip, skip + parseInt(limit)),
      total: filtered.length,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // Get financial summary
  fastify.get('/summary', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;
    const dateFilter = {};
    if (startDate || endDate) {
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
    }

    // Total invoiced
    const invoiceFilter = { status: { not: 'VOID' } };
    if (Object.keys(dateFilter).length > 0) invoiceFilter.createdAt = dateFilter;

    const invoiceStats = await prisma.invoice.aggregate({
      where: invoiceFilter,
      _sum: { total: true },
      _count: true
    });

    // Total paid
    const paidFilter = {};
    if (Object.keys(dateFilter).length > 0) paidFilter.paidAt = dateFilter;

    const paymentStats = await prisma.invoicePayment.aggregate({
      where: paidFilter,
      _sum: { amount: true },
      _count: true
    });

    // Total expenses
    const expenseFilter = {};
    if (Object.keys(dateFilter).length > 0) expenseFilter.date = dateFilter;

    const expenseStats = await prisma.expense.aggregate({
      where: expenseFilter,
      _sum: { amount: true },
      _count: true
    });

    const totalInvoiced = invoiceStats._sum.total || 0;
    const totalPaid = paymentStats._sum.amount || 0;
    const totalExpenses = expenseStats._sum.amount || 0;
    const outstanding = totalInvoiced - totalPaid;
    const netIncome = totalPaid - totalExpenses;

    return {
      totalInvoiced,
      totalPaid,
      outstanding,
      totalExpenses,
      netIncome,
      invoiceCount: invoiceStats._count,
      paymentCount: paymentStats._count,
      expenseCount: expenseStats._count
    };
  });

  // Get balance (outstanding receivables)
  fastify.get('/balance', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    // Outstanding invoices
    const outstandingInvoices = await prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'OVERDUE'] } },
      include: { client: { select: { id: true, name: true } } }
    });

    const totalReceivables = outstandingInvoices.reduce((sum, inv) => {
      const paid = inv.payments?.reduce((s, p) => s + p.amount, 0) || 0;
      return sum + (inv.total - paid);
    }, 0);

    // Overdue
    const overdue = outstandingInvoices.filter(inv => inv.dueDate && new Date(inv.dueDate) < new Date());
    const totalOverdue = overdue.reduce((sum, inv) => {
      const paid = inv.payments?.reduce((s, p) => s + p.amount, 0) || 0;
      return sum + (inv.total - paid);
    }, 0);

    return {
      totalReceivables,
      totalOverdue,
      outstandingCount: outstandingInvoices.length,
      overdueCount: overdue.length
    };
  });
}