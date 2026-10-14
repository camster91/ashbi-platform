import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import invoiceRoutes from '../../routes/invoice.routes.js';
import expenseRoutes from '../../routes/expense.routes.js';
import { financialPortfolioWhere, invoicePortfolioWhere } from '../../shared/financial-portfolio.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const reply = { status(code) { this.code = code; return this; }, send(body) { return { status: this.code, ...body }; } };
async function handlers(registrar, prisma, options = {}) {
  const routes = {};
  const register = (url, _config, handler) => { routes[url] = handler; };
  await registrar({ prisma, authenticate() {}, addHook() {}, get: register, post() {}, put() {}, patch() {}, delete() {} }, options);
  return routes;
}
test('unclassified financial records include unlinked projects without inferring a client portfolio', () => {
  assert.deepEqual(financialPortfolioWhere('UNCLASSIFIED'), { OR: [{ projectId: null }, { project: { portfolio: null } }] });
  assert.deepEqual(financialPortfolioWhere('FREELANCE'), { project: { portfolio: 'FREELANCE' } });
  assert.deepEqual(financialPortfolioWhere(), {});
});
test('invoice list and all currency/payment statistics use the same selected portfolio', async () => {
  const calls = [];
  const prisma = { project: { findMany: async () => [{ id: 'p1' }] }, invoice: { findMany: async query => { calls.push(query); return []; }, count: async query => { calls.push(query); return 0; }, groupBy: async query => { calls.push(query); return []; } }, invoicePayment: { findMany: async query => { calls.push(query); return []; } } };
  const routes = await handlers(invoiceRoutes, prisma);
  await routes['/']({ query: { portfolio: 'UNCLASSIFIED', search: 'brief', status: 'OVERDUE' } }, reply);
  assert.deepEqual(calls[0].where.OR, [{ projectId: null }, { projectId: { in: ['p1'] } }]);
  assert.equal(calls[0].where.AND.length, 2);
  assert.deepEqual(calls[2].where.OR, calls[0].where.OR);
  assert.deepEqual(calls[3].where.OR, calls[0].where.OR);
  assert.deepEqual(calls[4].where.invoice.OR, calls[0].where.OR);
  await routes['/']({ query: { portfolio: 'FREELANCE', projectId: 'other-project' } }, reply);
  assert.deepEqual(calls[5].where.projectId, { in: ['p1'] });
  assert.deepEqual(calls[5].where.AND, [{ projectId: 'other-project' }]);
  const before = calls.length;
  assert.equal((await routes['/stats']({ query: { portfolio: 'PRIVATE' } }, reply)).status, 400);
  assert.equal(calls.length, before);
});
test('expense summaries keep currencies separate and search cannot overwrite the unclassified filter', async t => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-portfolio-test-'));
  t.after(() => fs.rm(uploadsDir, { recursive: true, force: true }));
  const calls = [];
  const prisma = { expense: {
    findMany: async query => { calls.push(query); return []; }, count: async () => 0,
    groupBy: async query => {
      calls.push(query);
      return query.by.length === 2
        ? [{ currency: 'CAD', category: 'SOFTWARE', _sum: { amount: 15 }, _count: { _all: 150 } }, { currency: 'USD', category: 'HOSTING', _sum: { amount: 30 }, _count: { _all: 1 } }]
        : [{ currency: 'CAD', _sum: { amount: 25 }, _count: { _all: 150 } }, { currency: 'USD', _sum: { amount: 50 }, _count: { _all: 1 } }];
    },
  } };
  const routes = await handlers(expenseRoutes, prisma, { uploadsDir });
  await routes['/']({ query: { portfolio: 'UNCLASSIFIED', search: 'design' }, prisma }, reply);
  assert.deepEqual(calls[0].where.OR, financialPortfolioWhere('UNCLASSIFIED').OR);
  assert.equal(calls[0].where.AND[0].OR.length, 2);
  const result = await routes['/summary']({ query: { portfolio: 'FREELANCE' }, prisma }, reply);
  assert.equal(result.mixedCurrency, true);
  assert.equal(result.allTimeTotal, null); assert.equal(result.totalThisMonth, null);
  assert.equal(result.allTimeCount, 151);
  assert.equal(result.byCurrency.CAD.allTimeTotal, 25);
  assert.equal(result.byCurrency.USD.totalThisMonth, 30);
  assert.deepEqual(calls[1].where.project, { portfolio: 'FREELANCE' });
  assert.deepEqual(calls[2].where.project, { portfolio: 'FREELANCE' });
});
test('MCP financial reads retain explicit organization scope and omit payable links and receipt URLs', async () => {
  const calls = {};
  const prisma = { project: { findMany: async () => [{ id: 'p1' }] }, invoice: { findMany: async args => { calls.invoice = args; return []; } }, expense: { findMany: async args => { calls.expense = args; return []; } } };
  const ctx = { user: { id: 'staff', role: 'TEAM', organizationId: 'org-a' }, scopes: ['workspace:read'], prisma };
  const tools = createWorkspaceTools();
  await tools.call(ctx, 'list_invoices', { portfolio: 'FREELANCE' });
  await tools.call(ctx, 'list_expenses', { portfolio: 'UNCLASSIFIED' });
  assert.deepEqual(calls.invoice.where, { organizationId: 'org-a', projectId: { in: ['p1'] } });
  assert.deepEqual(calls.expense.where, { organizationId: 'org-a', ...financialPortfolioWhere('UNCLASSIFIED') });
  assert.equal(calls.invoice.select.stripePaymentLink, undefined);
  assert.equal(calls.expense.select.receiptUrl, undefined);
  assert.equal(calls.invoice.take, 26);
});
test('invoice classification reads all authorized project IDs without altering archived history', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}` }));
  const queries = [];
  const prisma = { project: { findMany: async query => { queries.push(query); return rows.filter(row => !query.where.id || row.id > query.where.id.gt).slice(0, query.take); } } };
  const where = await invoicePortfolioWhere(prisma, 'FREELANCE', 'org-a');
  assert.equal(where.projectId.in.length, 101);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.where.organizationId === 'org-a' && query.where.portfolio === 'FREELANCE'));
  assert.deepEqual(queries[0].where.deletedAt, {});
  assert.equal(where.project, undefined);
});
