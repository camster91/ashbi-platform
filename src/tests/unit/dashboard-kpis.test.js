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
  return {
    retainerPlan: model({ findMany: async () => [] }),
    invoice: model({
      findMany: async ({ where }) => where.status.in.flatMap((s) => invoicesByStatus[s] || []),
      aggregate: async ({ where }) => {
        const rows = invoicesByStatus[where.status] || [];
        return { _sum: { total: rows.reduce((sum, r) => sum + r.total, 0) }, _count: { _all: rows.length } };
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
