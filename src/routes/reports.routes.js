// Financial reports + pipeline routes

import { generateWeeklyReport } from '../services/weeklyReport.service.js';

export default async function reportRoutes(fastify) {

  // ─── WEEKLY REPORTS (existing) ─────────────────────────────────────────────

  // POST /reports/weekly/:clientId — generate a weekly report for a client
  fastify.post('/reports/weekly/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    try {
      const report = await generateWeeklyReport(request.params.clientId);

      // Save the report
      const saved = await fastify.prisma.report.create({
        data: {
          type: 'WEEKLY',
          subject: report.subject,
          body: report.body,
          clientId: report.clientId
        }
      });

      return { ...report, reportId: saved.id };
    } catch (err) {
      if (err.message === 'Client not found') {
        return reply.status(404).send({ error: 'Client not found' });
      }
      throw err;
    }
  });

  // POST /reports/weekly/all — generate reports for all active clients
  fastify.post('/reports/weekly/all', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (request.user.role !== 'BOT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin or Bot access required' });
    }

    const clients = await fastify.prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true }
    });

    const results = [];
    for (const client of clients) {
      try {
        const report = await generateWeeklyReport(client.id);
        const saved = await fastify.prisma.report.create({
          data: {
            type: 'WEEKLY',
            subject: report.subject,
            body: report.body,
            clientId: client.id
          }
        });
        results.push({ clientId: client.id, clientName: client.name, reportId: saved.id, status: 'generated' });
      } catch (err) {
        results.push({ clientId: client.id, clientName: client.name, status: 'failed', error: err.message });
      }
    }

    return { total: clients.length, results };
  });

  // GET /reports/history/:clientId — past generated reports
  fastify.get('/reports/history/:clientId', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const reports = await fastify.prisma.report.findMany({
      where: { clientId: request.params.clientId },
      orderBy: { generatedAt: 'desc' },
      take: 20
    });
    return reports;
  });

  // ─── P&L REPORT ────────────────────────────────────────────────────────────

  fastify.get('/reports/pnl', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, clientId } = request.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(endDate) : new Date();
    // Make end inclusive of the full day
    end.setHours(23, 59, 59, 999);

    const dateFilter = { gte: start, lte: end };

    // Revenue: sum of PAID invoices in range
    const invoiceWhere = {
      status: 'PAID',
      paidAt: dateFilter,
      ...(clientId ? { clientId } : {}),
    };

    const paidInvoices = await fastify.prisma.invoice.findMany({
      where: invoiceWhere,
      include: { client: { select: { id: true, name: true } } },
    });

    const totalRevenue = paidInvoices.reduce((s, i) => s + i.total, 0);
    const totalTax = paidInvoices.reduce((s, i) => s + (i.tax || 0), 0);

    // Expenses in range
    const expenseWhere = {
      date: dateFilter,
      ...(clientId ? { clientId } : {}),
    };

    const expenses = await fastify.prisma.expense.findMany({
      where: expenseWhere,
      include: { client: { select: { id: true, name: true } } },
    });

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const profit = totalRevenue - totalTax - totalExpenses;

    // Breakdown by client
    const clientMap = {};
    for (const inv of paidInvoices) {
      const cid = inv.clientId;
      if (!clientMap[cid]) {
        clientMap[cid] = { clientId: cid, clientName: inv.client?.name || 'Unknown', revenue: 0, expenses: 0, tax: 0 };
      }
      clientMap[cid].revenue += inv.total;
      clientMap[cid].tax += inv.tax || 0;
    }
    for (const exp of expenses) {
      const cid = exp.clientId || '_unassigned';
      if (!clientMap[cid]) {
        clientMap[cid] = { clientId: cid, clientName: exp.client?.name || 'Unassigned', revenue: 0, expenses: 0, tax: 0 };
      }
      clientMap[cid].expenses += exp.amount;
    }
    const byClient = Object.values(clientMap).map(c => ({
      ...c,
      profit: c.revenue - c.tax - c.expenses,
    })).sort((a, b) => b.profit - a.profit);

    // Breakdown by month
    const monthMap = {};
    for (const inv of paidInvoices) {
      const key = `${inv.paidAt.getFullYear()}-${String(inv.paidAt.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { month: key, revenue: 0, expenses: 0, tax: 0 };
      monthMap[key].revenue += inv.total;
      monthMap[key].tax += inv.tax || 0;
    }
    for (const exp of expenses) {
      const d = new Date(exp.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { month: key, revenue: 0, expenses: 0, tax: 0 };
      monthMap[key].expenses += exp.amount;
    }
    const byMonth = Object.values(monthMap)
      .map(m => ({ ...m, profit: m.revenue - m.tax - m.expenses }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalRevenue: +totalRevenue.toFixed(2),
      totalExpenses: +totalExpenses.toFixed(2),
      totalTax: +totalTax.toFixed(2),
      profit: +profit.toFixed(2),
      byClient,
      byMonth,
    };
  });

  // ─── CLIENT PROFITABILITY ──────────────────────────────────────────────────

  fastify.get('/reports/client-profitability', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const clients = await fastify.prisma.client.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
    });

    const results = [];

    for (const client of clients) {
      // Revenue from paid invoices
      const invoices = await fastify.prisma.invoice.findMany({
        where: { clientId: client.id, status: 'PAID' },
        select: { total: true, tax: true },
      });
      const revenue = invoices.reduce((s, i) => s + i.total, 0);
      const tax = invoices.reduce((s, i) => s + (i.tax || 0), 0);
      const netRevenue = revenue - tax;

      // Time entries
      const timeEntries = await fastify.prisma.timeEntry.findMany({
        where: { project: { clientId: client.id } },
        select: { duration: true, billable: true },
      });
      const totalMinutes = timeEntries.reduce((s, t) => s + t.duration, 0);
      const totalHours = +(totalMinutes / 60).toFixed(1);
      const billableMinutes = timeEntries.filter(t => t.billable).reduce((s, t) => s + t.duration, 0);
      const billableHours = +(billableMinutes / 60).toFixed(1);

      // Expenses
      const expenses = await fastify.prisma.expense.findMany({
        where: { clientId: client.id },
        select: { amount: true },
      });
      const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

      const profit = netRevenue - totalExpenses;
      const effectiveHourlyRate = billableHours > 0 ? +(netRevenue / billableHours).toFixed(2) : 0;

      results.push({
        clientId: client.id,
        clientName: client.name,
        revenue: +netRevenue.toFixed(2),
        totalHours,
        billableHours,
        expenses: +totalExpenses.toFixed(2),
        profit: +profit.toFixed(2),
        effectiveHourlyRate,
      });
    }

    return results.sort((a, b) => b.profit - a.profit);
  });

  // ─── TEAM UTILIZATION ──────────────────────────────────────────────────────

  fastify.get('/reports/team-utilization', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const dateFilter = { gte: start, lte: end };

    const users = await fastify.prisma.user.findMany({
      where: { role: { not: 'BOT' } },
      select: { id: true, name: true, email: true },
    });

    // Calculate working days in range (Mon-Fri)
    let workingDays = 0;
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) workingDays++;
      d.setDate(d.getDate() + 1);
    }
    const capacityHours = workingDays * 8; // 8 hours per working day

    const results = [];

    for (const user of users) {
      const entries = await fastify.prisma.timeEntry.findMany({
        where: { userId: user.id, date: dateFilter },
        select: { duration: true, billable: true },
      });

      const totalMinutes = entries.reduce((s, t) => s + t.duration, 0);
      const totalHours = +(totalMinutes / 60).toFixed(1);
      const billableMinutes = entries.filter(t => t.billable).reduce((s, t) => s + t.duration, 0);
      const billableHours = +(billableMinutes / 60).toFixed(1);

      const utilizationRate = capacityHours > 0 ? +((billableHours / capacityHours) * 100).toFixed(1) : 0;

      // Revenue from invoices on projects they worked on
      const projectIds = await fastify.prisma.timeEntry.findMany({
        where: { userId: user.id, date: dateFilter },
        select: { projectId: true },
        distinct: ['projectId'],
      });
      const pIds = projectIds.map(p => p.projectId);

      let revenue = 0;
      if (pIds.length > 0) {
        const invoices = await fastify.prisma.invoice.findMany({
          where: { projectId: { in: pIds }, status: 'PAID', paidAt: dateFilter },
          select: { total: true, tax: true },
        });
        revenue = invoices.reduce((s, i) => s + (i.total - (i.tax || 0)), 0);
      }

      results.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        totalHours,
        billableHours,
        capacityHours,
        utilizationRate,
        revenue: +revenue.toFixed(2),
      });
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      workingDays,
      capacityHoursPerPerson: capacityHours,
      team: results.sort((a, b) => b.utilizationRate - a.utilizationRate),
    };
  });

  // ─── PIPELINE VIEW ─────────────────────────────────────────────────────────

  fastify.get('/reports/pipeline', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Stage 1: Leads
    const leads = await fastify.prisma.outreachLead.findMany({
      where: { status: { in: ['NEW', 'CONTACTED'] } },
    });

    // Stage 2: Proposals (SENT or VIEWED)
    const proposals = await fastify.prisma.proposal.findMany({
      where: { status: { in: ['SENT', 'VIEWED'] } },
      select: { id: true, title: true, total: true, status: true, clientId: true, client: { select: { name: true } } },
    });
    const proposalValue = proposals.reduce((s, p) => s + (p.total || 0), 0);

    // Stage 3: Contracts (SENT)
    const contracts = await fastify.prisma.contract.findMany({
      where: { status: 'SENT' },
      select: { id: true, title: true, clientId: true, client: { select: { name: true } } },
    });

    // Stage 4: Active projects
    const activeProjects = await fastify.prisma.project.findMany({
      where: { status: { notIn: ['LAUNCHED', 'CANCELLED'] } },
      select: { id: true, name: true, budget: true, status: true, clientId: true, client: { select: { name: true } } },
    });
    const projectValue = activeProjects.reduce((s, p) => s + (p.budget || 0), 0);

    // Stage 5: Invoiced (SENT)
    const invoicedInvoices = await fastify.prisma.invoice.findMany({
      where: { status: 'SENT' },
      select: { id: true, invoiceNumber: true, total: true, clientId: true, client: { select: { name: true } } },
    });
    const invoicedValue = invoicedInvoices.reduce((s, i) => s + i.total, 0);

    // Stage 6: Paid in last 30 days
    const paidInvoices = await fastify.prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: thirtyDaysAgo } },
      select: { id: true, invoiceNumber: true, total: true, clientId: true, client: { select: { name: true } } },
    });
    const paidValue = paidInvoices.reduce((s, i) => s + i.total, 0);

    // Conversion rates
    const totalLeadsEver = await fastify.prisma.outreachLead.count();
    const totalProposalsEver = await fastify.prisma.proposal.count();
    const approvedProposals = await fastify.prisma.proposal.count({ where: { status: 'APPROVED' } });
    const signedContracts = await fastify.prisma.contract.count({ where: { status: 'SIGNED' } });
    const totalContractsEver = await fastify.prisma.contract.count();
    const totalInvoicesEver = await fastify.prisma.invoice.count();
    const paidInvoicesEver = await fastify.prisma.invoice.count({ where: { status: 'PAID' } });

    const conversionRates = {
      leadToProposal: totalLeadsEver > 0 ? +((totalProposalsEver / totalLeadsEver) * 100).toFixed(1) : 0,
      proposalToContract: totalProposalsEver > 0 ? +((approvedProposals / totalProposalsEver) * 100).toFixed(1) : 0,
      contractToProject: totalContractsEver > 0 ? +((signedContracts / totalContractsEver) * 100).toFixed(1) : 0,
      invoiceToPaid: totalInvoicesEver > 0 ? +((paidInvoicesEver / totalInvoicesEver) * 100).toFixed(1) : 0,
    };

    return {
      stages: [
        { key: 'leads', label: 'Leads', count: leads.length, value: null, items: leads.map(l => ({ id: l.id, name: l.name, company: l.company, status: l.status })) },
        { key: 'proposals', label: 'Proposals', count: proposals.length, value: +proposalValue.toFixed(2), items: proposals.map(p => ({ id: p.id, title: p.title, total: p.total, status: p.status, clientName: p.client?.name })) },
        { key: 'contracts', label: 'Contracts', count: contracts.length, value: null, items: contracts.map(c => ({ id: c.id, title: c.title, clientName: c.client?.name })) },
        { key: 'projects', label: 'Active Projects', count: activeProjects.length, value: +projectValue.toFixed(2), items: activeProjects.map(p => ({ id: p.id, name: p.name, budget: p.budget, status: p.status, clientName: p.client?.name })) },
        { key: 'invoiced', label: 'Invoiced', count: invoicedInvoices.length, value: +invoicedValue.toFixed(2), items: invoicedInvoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, total: i.total, clientName: i.client?.name })) },
        { key: 'paid', label: 'Paid (30d)', count: paidInvoices.length, value: +paidValue.toFixed(2), items: paidInvoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, total: i.total, clientName: i.client?.name })) },
      ],
      conversionRates,
    };
  });
}
