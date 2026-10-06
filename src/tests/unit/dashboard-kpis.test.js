import assert from 'node:assert/strict';
import test from 'node:test';
import dashboardRoutes from '../../routes/dashboard.routes.js';

async function statsHandler() {
  let handler;
  const fastify = {
    authenticate: async () => {},
    get(path, options, routeHandler) { if (path === '/stats') handler = routeHandler; },
  };
  await dashboardRoutes(fastify);
  return handler;
}

function fakePrisma({ invoicesByStatus }) {
  const model = (overrides = {}) => new Proxy(overrides, {
    get: (target, prop) => target[prop] ?? (async () => (prop === 'count' ? 0 : prop === 'aggregate' ? { _sum: {} } : [])),
  });
  // Evaluates the invoice filters the route sends to the database.
  const matchingInvoices = (where) => {
    const statuses = typeof where.status === 'string' ? [where.status] : where.status.in;
    return statuses
      .flatMap((status) => (invoicesByStatus[status] || []).map((row) => ({ status, ...row })))
      .filter((row) => !where.OR || where.OR.some((clause) => (clause.status && row.status === clause.status)
        || (clause.dueDate && row.dueDate && row.dueDate < clause.dueDate.lt)));
  };
  return {
    retainerPlan: model({ aggregate: async () => ({ _sum: { monthlyAmountUsd: null }, _count: { _all: 0 } }) }),
    invoice: model({
      aggregate: async ({ where }) => {
        const rows = matchingInvoices(where);
        return { _sum: { total: rows.length ? rows.reduce((sum, r) => sum + r.total, 0) : null }, _count: { _all: rows.length } };
      },
    }),
    // Payments recorded on the matching invoices (row.paid).
    invoicePayment: model({
      aggregate: async ({ where }) => {
        const paid = matchingInvoices(where.invoice).reduce((sum, r) => sum + (r.paid || 0), 0);
        return { _sum: { amount: paid || null } };
      },
    }),
    project: model(),
    approval: model(),
    activity: model(),
    notification: model(),
    client: model(),
    thread: model(),
    task: model(),
    timeEntry: model(),
    user: model({ findUnique: async () => ({ weeklyCapacityHours: 40 }) }),
    calendarEvent: model(),
    $queryRaw: async () => [],
  };
}

test('dashboard reports draft invoices separately from outstanding (SENT/OVERDUE) totals', async () => {
  const handler = await statsHandler();
  const stats = await handler({
    user: { id: 'u1', role: 'ADMIN' },
    organizationId: 'org-1',
    prisma: fakePrisma({
      invoicesByStatus: {
        DRAFT: [{ total: 10170 }, { total: 2034 }],
        SENT: [],
        OVERDUE: [],
      },
    }),
  });
  assert.equal(stats.totalOutstanding, 0);
  assert.equal(stats.outstandingCount, 0);
  assert.equal(stats.draftInvoiceTotal, 12204);
  assert.equal(stats.draftInvoiceCount, 2);
  assert.equal(stats.mrr, 0);
  assert.equal(stats.activeRetainerCount, 0);
});

test('outstanding sums sent and overdue invoices only', async () => {
  const handler = await statsHandler();
  const stats = await handler({
    user: { id: 'u1', role: 'ADMIN' },
    organizationId: 'org-1',
    prisma: fakePrisma({
      invoicesByStatus: {
        DRAFT: [{ total: 500 }],
        SENT: [{ total: 1000, status: 'SENT', dueDate: new Date(Date.now() + 864e5) }],
        OVERDUE: [{ total: 250, status: 'OVERDUE', dueDate: new Date(Date.now() - 864e5) }],
      },
    }),
  });
  assert.equal(stats.totalOutstanding, 1250);
  assert.equal(stats.outstandingCount, 2);
  assert.equal(stats.overdueCount, 1);
  assert.equal(stats.draftInvoiceTotal, 500);
});

test('money and counts come from database aggregates, never from a capped list read', async () => {
  const handler = await statsHandler();
  const prisma = fakePrisma({ invoicesByStatus: { DRAFT: [], SENT: [], OVERDUE: [] } });
  prisma.invoice.findMany = async () => { throw new Error('the dashboard must not total invoices from findMany (capped at 100 rows)'); };
  prisma.retainerPlan.findMany = async () => { throw new Error('the dashboard must not total retainers from findMany (capped at 100 rows)'); };
  prisma.retainerPlan.aggregate = async () => ({ _sum: { monthlyAmountUsd: 150 * 1000 }, _count: { _all: 150 } });
  const stats = await handler({ user: { id: 'u1', role: 'ADMIN' }, organizationId: 'org-1', prisma });
  assert.equal(stats.mrr, 150000);
  assert.equal(stats.activeRetainerCount, 150);
});

test('VIEWED invoices are unpaid: counted as outstanding, and overdue once past due', async () => {
  const handler = await statsHandler();
  const stats = await handler({
    user: { id: 'u1', role: 'ADMIN' },
    organizationId: 'org-1',
    prisma: fakePrisma({
      invoicesByStatus: {
        DRAFT: [],
        SENT: [{ total: 100, status: 'SENT', dueDate: new Date(Date.now() + 864e5) }],
        VIEWED: [
          { total: 40, status: 'VIEWED', dueDate: new Date(Date.now() + 864e5) },
          { total: 60, status: 'VIEWED', dueDate: new Date(Date.now() - 864e5), paid: 10 },
        ],
        OVERDUE: [],
      },
    }),
  });
  assert.equal(stats.totalOutstanding, 190);
  assert.equal(stats.outstandingCount, 3);
  assert.equal(stats.overdueCount, 1);
  assert.equal(stats.overdueAmount, 50);
});

test('MRR counts CAD retainers in CAD, and reports mixed currencies apart', async () => {
  const handler = await statsHandler();
  const plans = [
    { retainerStatus: 'ACTIVE', monthlyAmountUsd: null, monthlyAmountCad: 3000 },
    { retainerStatus: 'ACTIVE', monthlyAmountUsd: 0, monthlyAmountCad: 1500 },
    { retainerStatus: 'PAUSED', monthlyAmountUsd: null, monthlyAmountCad: 9999 },
  ];
  // Applies the where clauses the dashboard sends (ACTIVE, and "no USD rate").
  const aggregate = async ({ where }) => {
    const rows = plans.filter((plan) => plan.retainerStatus === where.retainerStatus)
      .filter((plan) => !where.OR || !(Number(plan.monthlyAmountUsd) > 0));
    const sum = (key) => rows.reduce((total, plan) => total + (Number(plan[key]) || 0), 0) || null;
    return { _sum: { monthlyAmountUsd: sum('monthlyAmountUsd'), monthlyAmountCad: sum('monthlyAmountCad') }, _count: { _all: rows.length } };
  };
  const prisma = fakePrisma({ invoicesByStatus: { DRAFT: [], SENT: [], OVERDUE: [] } });
  prisma.retainerPlan.aggregate = aggregate;
  let stats = await handler({ user: { id: 'u1', role: 'ADMIN' }, organizationId: 'org-1', prisma });
  assert.deepEqual([stats.mrr, stats.mrrCurrency], [4500, 'CAD'], 'CAD retainers are not US$0');
  assert.deepEqual(stats.mrrByCurrency, { CAD: 4500 });
  assert.equal(stats.activeRetainerCount, 2);

  // A plan with a USD rate counts in USD (the currency it is invoiced in), once.
  plans.push({ retainerStatus: 'ACTIVE', monthlyAmountUsd: 999, monthlyAmountCad: 1350 });
  stats = await handler({ user: { id: 'u1', role: 'ADMIN' }, organizationId: 'org-1', prisma });
  assert.deepEqual([stats.mrr, stats.mrrCurrency], [null, null]);
  assert.deepEqual(stats.mrrByCurrency, { USD: 999, CAD: 4500 });
});

test('outstanding and overdue amounts are balances after partial payments', async () => {
  const handler = await statsHandler();
  const stats = await handler({
    user: { id: 'u1', role: 'ADMIN' },
    organizationId: 'org-1',
    prisma: fakePrisma({
      invoicesByStatus: {
        DRAFT: [],
        SENT: [{ total: 1000, paid: 400, status: 'SENT', dueDate: new Date(Date.now() + 864e5) }],
        OVERDUE: [{ total: 250, paid: 50, status: 'OVERDUE', dueDate: new Date(Date.now() - 864e5) }],
      },
    }),
  });
  assert.equal(stats.totalOutstanding, 800);
  assert.equal(stats.overdueAmount ?? stats.overdueTotal, 200);
  assert.equal(stats.outstandingCount, 2);
});
