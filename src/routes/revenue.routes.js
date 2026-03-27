// Revenue Dashboard Routes
// MRR, ARR, collections rate, client breakdown, seasonal trends

import { prisma } from '../index.js';

// Simple in-memory cache
let cache = null;
let cacheTime = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isCacheValid() {
  return cache && cacheTime && (Date.now() - cacheTime) < CACHE_TTL;
}

async function buildRevenueDashboard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // Fetch all invoices with client info
  const allInvoices = await prisma.invoice.findMany({
    include: {
      client: { select: { id: true, name: true, status: true } },
      lineItems: true
    },
    orderBy: { createdAt: 'desc' }
  });

  // --- MRR Calculation ---
  // Sum of all active retainer invoices issued in the last 30 days
  const retainerInvoices = allInvoices.filter(inv =>
    inv.isRecurring &&
    inv.status === 'PAID' &&
    new Date(inv.createdAt) >= new Date(now - 45 * 24 * 60 * 60 * 1000)
  );

  // Also count retainer plans
  const retainerPlans = await prisma.retainerPlan.findMany({
    include: { client: { select: { id: true, name: true, status: true } } }
  });

  const retainerMRR = retainerPlans.reduce((sum, rp) => {
    if (rp.client?.status === 'ACTIVE') {
      // tier is the monthly rate (e.g. "999", "1999", "3999")
      const rate = parseInt(rp.tier) || 0;
      return sum + rate;
    }
    return sum;
  }, 0);

  // Fallback: if no retainer plans, estimate from recurring invoices
  const invoiceMRR = retainerInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
  const mrr = retainerMRR > 0 ? retainerMRR : invoiceMRR;
  const arr = mrr * 12;

  // --- This Month Revenue ---
  const thisMonthInvoices = allInvoices.filter(inv =>
    new Date(inv.createdAt) >= startOfMonth
  );
  const thisMonthRevenue = thisMonthInvoices
    .filter(inv => inv.status === 'PAID')
    .reduce((sum, inv) => sum + (inv.total || 0), 0);

  const thisMonthSent = thisMonthInvoices
    .filter(inv => ['PAID', 'SENT', 'OVERDUE'].includes(inv.status))
    .reduce((sum, inv) => sum + (inv.total || 0), 0);

  // --- Overdue Invoices ---
  const overdueInvoices = allInvoices.filter(inv =>
    inv.status === 'OVERDUE' ||
    (inv.status !== 'PAID' && inv.status !== 'VOID' && inv.status !== 'DRAFT' &&
     inv.dueDate && new Date(inv.dueDate) < now)
  );
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
  const overdueByClient = {};
  for (const inv of overdueInvoices) {
    const cn = inv.client?.name || 'Unknown';
    if (!overdueByClient[cn]) overdueByClient[cn] = { amount: 0, count: 0, invoices: [] };
    overdueByClient[cn].amount += inv.total || 0;
    overdueByClient[cn].count++;
    overdueByClient[cn].invoices.push({
      id: inv.id,
      number: inv.invoiceNumber,
      amount: inv.total,
      dueDate: inv.dueDate
    });
  }

  // --- Collections Rate ---
  const paidInvoices = allInvoices.filter(inv => inv.status === 'PAID');
  const sentInvoices = allInvoices.filter(inv => ['PAID', 'SENT', 'OVERDUE'].includes(inv.status));
  const collectionsRate = sentInvoices.length > 0
    ? Math.round((paidInvoices.length / sentInvoices.length) * 100)
    : 100;

  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
  const totalSent = sentInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
  const collectionsRateByAmount = totalSent > 0
    ? Math.round((totalRevenue / totalSent) * 100)
    : 100;

  // --- Revenue by Client ---
  const clientRevMap = {};
  for (const inv of paidInvoices) {
    const cid = inv.clientId;
    const cn = inv.client?.name || 'Unknown';
    if (!clientRevMap[cid]) {
      clientRevMap[cid] = { clientId: cid, clientName: cn, total: 0, invoiceCount: 0, lastPayment: null };
    }
    clientRevMap[cid].total += inv.total || 0;
    clientRevMap[cid].invoiceCount++;
    const paidAt = inv.paidAt ? new Date(inv.paidAt) : new Date(inv.updatedAt);
    if (!clientRevMap[cid].lastPayment || paidAt > new Date(clientRevMap[cid].lastPayment)) {
      clientRevMap[cid].lastPayment = paidAt.toISOString();
    }
  }
  const revenueByClient = Object.values(clientRevMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // --- Seasonal Trends (last 12 months) ---
  const monthlyData = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = { month: key, revenue: 0, invoiceCount: 0, paid: 0, sent: 0 };
  }

  for (const inv of allInvoices) {
    const d = new Date(inv.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyData[key]) {
      if (inv.status === 'PAID') {
        monthlyData[key].revenue += inv.total || 0;
        monthlyData[key].paid++;
      }
      if (['PAID', 'SENT', 'OVERDUE'].includes(inv.status)) {
        monthlyData[key].sent++;
      }
      monthlyData[key].invoiceCount++;
    }
  }

  const seasonalTrends = Object.values(monthlyData);

  // --- YTD Revenue ---
  const ytdRevenue = allInvoices
    .filter(inv => inv.status === 'PAID' && new Date(inv.createdAt) >= startOfYear)
    .reduce((sum, inv) => sum + (inv.total || 0), 0);

  // --- Outstanding (not yet due) ---
  const outstandingInvoices = allInvoices.filter(inv =>
    (inv.status === 'SENT' || inv.status === 'DRAFT') &&
    (!inv.dueDate || new Date(inv.dueDate) >= now)
  );
  const outstandingAmount = outstandingInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  // --- Invoice Status Breakdown ---
  const statusBreakdown = {};
  for (const inv of allInvoices) {
    statusBreakdown[inv.status] = (statusBreakdown[inv.status] || 0) + 1;
  }

  return {
    generatedAt: now.toISOString(),
    cached: false,
    summary: {
      mrr: Math.round(mrr),
      arr: Math.round(arr),
      thisMonthRevenue: Math.round(thisMonthRevenue),
      thisMonthSent: Math.round(thisMonthSent),
      ytdRevenue: Math.round(ytdRevenue),
      totalRevenue: Math.round(totalRevenue),
      overdueAmount: Math.round(overdueAmount),
      overdueCount: overdueInvoices.length,
      outstandingAmount: Math.round(outstandingAmount),
      outstandingCount: outstandingInvoices.length,
      collectionsRate,
      collectionsRateByAmount,
      totalInvoices: allInvoices.length,
      paidInvoices: paidInvoices.length
    },
    overdueByClient,
    revenueByClient,
    seasonalTrends,
    statusBreakdown,
    retainerPlans: retainerPlans.map(rp => ({
      clientName: rp.client?.name,
      clientStatus: rp.client?.status,
      monthlyRate: parseInt(rp.tier) || 0,
      tier: rp.tier,
      hoursPerMonth: rp.hoursPerMonth,
      startDate: rp.billingCycleStart
    }))
  };
}

export default async function revenueRoutes(fastify) {

  // GET /api/revenue/dashboard - Main revenue dashboard
  fastify.get('/dashboard', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { refresh } = request.query;

      if (refresh === 'true') {
        cache = null;
        cacheTime = null;
      }

      if (isCacheValid()) {
        return { ...cache, cached: true, cacheAge: Math.round((Date.now() - cacheTime) / 1000) + 's' };
      }

      const start = Date.now();
      const data = await buildRevenueDashboard();
      const elapsed = Date.now() - start;

      cache = data;
      cacheTime = Date.now();

      return { ...data, queryTimeMs: elapsed };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to build revenue dashboard', details: err.message });
    }
  });

  // GET /api/revenue/mrr - Quick MRR/ARR lookup
  fastify.get('/mrr', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      if (isCacheValid()) {
        const { mrr, arr } = cache.summary;
        return { mrr, arr, cached: true };
      }
      const data = await buildRevenueDashboard();
      cache = data;
      cacheTime = Date.now();
      return { mrr: data.summary.mrr, arr: data.summary.arr };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch MRR', details: err.message });
    }
  });

  // GET /api/revenue/overdue - Overdue invoices detail
  fastify.get('/overdue', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const now = new Date();
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          OR: [
            { status: 'OVERDUE' },
            {
              status: { notIn: ['PAID', 'VOID', 'DRAFT'] },
              dueDate: { lt: now }
            }
          ]
        },
        include: {
          client: { select: { id: true, name: true, domain: true } },
          lineItems: true
        },
        orderBy: { dueDate: 'asc' }
      });

      const total = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

      return {
        count: overdueInvoices.length,
        totalAmount: Math.round(total),
        invoices: overdueInvoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          clientName: inv.client?.name,
          amount: inv.total,
          dueDate: inv.dueDate,
          daysOverdue: inv.dueDate
            ? Math.floor((now - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24))
            : null,
          status: inv.status
        }))
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch overdue invoices', details: err.message });
    }
  });

  // GET /api/revenue/trends - Monthly trend data for charts
  fastify.get('/trends', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { months = 12 } = request.query;
      const now = new Date();
      const monthlyData = {};

      for (let i = parseInt(months) - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyData[key] = { month: key, revenue: 0, invoiceCount: 0 };
      }

      const invoices = await prisma.invoice.findMany({
        where: {
          status: 'PAID',
          createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - parseInt(months) + 1, 1) }
        },
        select: { createdAt: true, total: true }
      });

      for (const inv of invoices) {
        const d = new Date(inv.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyData[key]) {
          monthlyData[key].revenue += inv.total || 0;
          monthlyData[key].invoiceCount++;
        }
      }

      return { months: parseInt(months), trends: Object.values(monthlyData) };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch trends', details: err.message });
    }
  });

  // POST /api/revenue/cache/clear - Clear the cache
  fastify.post('/cache/clear', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    cache = null;
    cacheTime = null;
    return { message: 'Cache cleared', timestamp: new Date().toISOString() };
  });
}
