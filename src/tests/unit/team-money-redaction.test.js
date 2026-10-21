// Money is for admins only: team members (and bots / API keys) must not get
// client revenue, payment status, invoices or time-entry billing rates in the
// raw API response, not just have them hidden by the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import clientRoutes from '../../routes/client.routes.js';
import timeRoutes from '../../routes/time.routes.js';
import projectRoutes from '../../routes/project.routes.js';

async function handlers(registrar) {
  const routes = {};
  const register = method => (path, _options, fn) => { routes[`${method} ${path}`] = fn; };
  await registrar({ authenticate: () => {}, get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
  return routes;
}
const reply = { status(code) { this.code = code; return this; }, send(body) { return { status: this.code, ...body }; } };

const MONEY = { totalRevenueUsd: 900, totalRevenueCad: 1200, lastInvoiceDate: new Date('2026-09-01'), lastInvoiceStatus: 'PAID', paymentStatus: 'CURRENT' };
const storedClient = { id: 'c1', name: 'Northwind', communicationPrefs: '{}', satisfactionSignals: '{}', knowledgeBase: '[]', contacts: [], projects: [], threads: [], ...MONEY };
const invoice = { id: 'i1', status: 'SENT', total: 1130, currency: 'CAD', payments: [{ amount: 300 }] };

function clientDb(calls) {
  return {
    client: {
      findUnique: async (args) => { calls.push(args); return { ...storedClient, ...(args.include.invoices ? { invoices: [invoice] } : {}) }; },
      findMany: async () => [{ ...storedClient, _count: { projects: 0 } }],
      count: async () => 1,
    },
  };
}

for (const role of ['TEAM', 'BOT']) {
  test(`client detail sends ${role} no money and reads no invoices`, async () => {
    const calls = [];
    const routes = await handlers(clientRoutes);
    const body = await routes['GET /:id']({ params: { id: 'c1' }, user: { id: 'u', role }, prisma: clientDb(calls) }, reply);
    assert.equal(calls[0].include.invoices, undefined, 'invoices must not be queried');
    for (const field of [...Object.keys(MONEY), 'invoices', 'outstandingBalance', 'outstandingByCurrency', 'totalRevenue', 'revenueByCurrency']) {
      assert.equal(field in body, false, `${role} must not receive ${field}`);
    }
    assert.equal(body.name, 'Northwind');
  });

  test(`client list sends ${role} no revenue or payment status`, async () => {
    const routes = await handlers(clientRoutes);
    const body = await routes['GET /']({ query: {}, user: { id: 'u', role }, prisma: clientDb([]) });
    for (const field of Object.keys(MONEY)) assert.equal(field in body.clients[0], false, `${role} must not receive ${field}`);
    assert.equal(body.clients[0].name, 'Northwind');
  });
}

test('admins still get client money, invoices and balances', async () => {
  const calls = [];
  const routes = await handlers(clientRoutes);
  const body = await routes['GET /:id']({ params: { id: 'c1' }, user: { id: 'a', role: 'ADMIN' }, prisma: clientDb(calls) }, reply);
  assert.ok(calls[0].include.invoices);
  assert.equal(body.totalRevenueCad, 1200);
  assert.equal(body.outstandingBalance, 830);
  assert.equal(body.invoices.length, 1);
  const list = await routes['GET /']({ query: {}, user: { id: 'a', role: 'ADMIN' }, prisma: clientDb([]) });
  assert.equal(list.clients[0].paymentStatus, 'CURRENT');
});

test('client update returns no money to a team member', async () => {
  const routes = await handlers(clientRoutes);
  const db = { client: { findFirst: async () => null, findUnique: async () => storedClient, update: async () => ({ ...storedClient }) } };
  const body = await routes['PUT /:id']({ params: { id: 'c1' }, body: { name: 'Northwind' }, user: { id: 'u', role: 'TEAM' }, prisma: db }, reply);
  for (const field of Object.keys(MONEY)) assert.equal(field in body, false, `TEAM must not receive ${field}`);
});

const entry = { id: 't1', date: new Date('2026-10-01'), duration: 60, billable: true, hourlyRate: 150, invoiceId: 'inv-1', userId: 'u', user: { id: 'u', name: 'Bianca', hourlyRate: 120 } };
const timeDb = () => ({
  timeEntry: {
    findMany: async () => [structuredClone(entry)],
    count: async () => 1,
    aggregate: async () => ({ _sum: { duration: 60 } }),
  },
});

function assertNoRates(e, where) {
  assert.equal('hourlyRate' in e, false, `${where}: entry rate`);
  assert.equal('invoiceId' in e, false, `${where}: invoice link`);
  if (e.user) assert.equal('hourlyRate' in e.user, false, `${where}: user rate`);
  assert.equal(e.duration, 60, `${where}: hours stay`);
}

test('time entry lists send team members hours but no rates or invoice links', async () => {
  const routes = await handlers(timeRoutes);
  const request = (extra) => ({ user: { id: 'u', role: 'TEAM' }, query: {}, prisma: timeDb(), ...extra });

  const project = await routes['GET /projects/:projectId/time-entries'](request({ params: { projectId: 'p1' } }), reply);
  assertNoRates(project.entries[0], 'project entries');

  const mine = await routes['GET /time-entries/my'](request({}), reply);
  assertNoRates(Object.values(mine.grouped)[0].entries[0], 'my entries');

  let weeklyQuery;
  const weeklyDb = { timeEntry: { findMany: async (args) => { weeklyQuery = args; return [structuredClone(entry)]; } } };
  const weekly = await routes['GET /timesheets/weekly'](request({ prisma: weeklyDb }), reply);
  assert.equal(weeklyQuery.include.user.select.hourlyRate, false, 'weekly must not read the user rate');
  assertNoRates(Object.values(weekly.timesheets[0].days)[0].entries[0], 'weekly entries');
});

test('admins still get time entry rates', async () => {
  const routes = await handlers(timeRoutes);
  const project = await routes['GET /projects/:projectId/time-entries']({ user: { id: 'a', role: 'ADMIN' }, query: {}, params: { projectId: 'p1' }, prisma: timeDb() }, reply);
  assert.equal(project.entries[0].hourlyRate, 150);
  assert.equal(project.entries[0].invoiceId, 'inv-1');
});

const storedProject = { id: 'p1', name: 'Harbour Hotel rebuild', status: 'DESIGN_DEV', budget: 12000, hourlyBudget: 80, client: { id: 'c1', name: 'Harbour Hotel' }, _count: { threads: 0, tasks: 4 } };
const projectDb = () => ({
  project: { findMany: async () => [structuredClone(storedProject)], count: async () => 1 },
  task: { groupBy: async () => [{ projectId: 'p1', _count: 3 }] },
});

for (const role of ['TEAM', 'BOT']) {
  test(`project list sends ${role} no contract value`, async () => {
    const routes = await handlers(projectRoutes);
    const body = await routes['GET /']({ query: {}, user: { id: 'u', role }, prisma: projectDb() }, reply);
    assert.equal('budget' in body.projects[0], false, `${role} must not receive budget`);
    assert.equal(body.projects[0].name, 'Harbour Hotel rebuild');
    assert.equal(body.projects[0].hourlyBudget, 80, 'hour budgets are not money');
    assert.equal(body.projects[0].completedTaskCount, 3);
  });
}

test('admins still get the project contract value in the list', async () => {
  const routes = await handlers(projectRoutes);
  const body = await routes['GET /']({ query: {}, user: { id: 'a', role: 'ADMIN' }, prisma: projectDb() }, reply);
  assert.equal(body.projects[0].budget, 12000);
});

test('time entry create and update responses send team members no rate', async () => {
  const routes = await handlers(timeRoutes);
  const stored = { ...entry, invoiceId: null, invoiced: false, reviewStatus: 'PENDING' };
  const db = {
    timeEntry: {
      create: async () => structuredClone(stored),
      findUnique: async () => structuredClone(stored),
      updateMany: async () => ({ count: 1 }),
    },
    activity: { create: async () => ({}) },
  };
  const user = { id: 'u', role: 'TEAM' };
  const created = await routes['POST /time-entries']({ user, body: { projectId: 'p1', duration: 60 }, prisma: db }, reply);
  assert.equal('hourlyRate' in created, false, 'create response rate');
  const updated = await routes['PUT /time-entries/:id']({ user, params: { id: 't1' }, body: { description: 'x' }, prisma: db }, reply);
  assert.equal('hourlyRate' in updated, false, 'update response rate');
  assert.equal(updated.duration, 60);
  const adminUpdated = await routes['PUT /time-entries/:id']({ user: { id: 'a', role: 'ADMIN' }, params: { id: 't1' }, body: { description: 'x' }, prisma: db }, reply);
  assert.equal(adminUpdated.hourlyRate, 150);
});
