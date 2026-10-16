import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import env from '../../config/env.js';
import { prisma as basePrisma } from '../../config/db.js';
import { enterRequestContext, getRequestPrisma } from '../../utils/request-context.js';

const entry = (rate, userRate, minutes = 60, id = 'user-a') => ({ userId: id, duration: minutes, hourlyRate: rate, user: { id, name: id, hourlyRate: userRate } });
async function fixture(t, entries, hourlyBudget = 1) {
  const previous = globalThis.ashbiRawPrisma;
  const previousEnv = { botSecret: env.botSecret, botOrganizationId: env.botOrganizationId };
  const reads = [];
  const project = { id: 'project-a', organizationId: 'org-a', name: 'Synthetic hours project', hourlyBudget, client: { name: 'Synthetic client' }, timeEntries: entries };
  globalThis.ashbiRawPrisma = { project: {
    findMany: async args => { reads.push(args); assert.equal(args.where.organizationId, 'org-a'); assert.equal(args.where.status, 'ACTIVE'); return [project]; },
    findFirst: async args => { reads.push(args); assert.equal(args.where.organizationId, 'org-a'); return args.where.id === project.id ? project : null; },
    findUnique: async args => { reads.push(args); assert.equal(args.where.organizationId, 'org-a'); return args.where.id === project.id ? project : null; },
  } };
  env.botSecret = 'synthetic-bot-hours-secret';env.botOrganizationId = 'org-a';
  const app = Fastify();
  app.decorate('prisma', new Proxy({}, { get(_target, prop) { return getRequestPrisma()[prop]; } }));
  app.addHook('onRequest', async () => { enterRequestContext({ prisma: basePrisma, organizationId: null }); });
  // Each app gets an empty instance of the existing module cache; TTL/policy unchanged.
  const { default: routes } = await import(`../../routes/bot.routes.js?hours-fixture=${randomUUID()}`);
  try { await app.register(routes, { prefix: '/api/bot' });await app.ready(); }
  finally { Object.assign(env, previousEnv); }
  t.after(async () => { await app.close();globalThis.ashbiRawPrisma = previous; });
  const get = async path => {
    const response = await app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer synthetic-bot-hours-secret' } });
    assert.equal(response.statusCode, 200, response.body);return response.json();
  };
  return { app, get, reads };
}

for (const [label, rate, userRate, expected, known] of [
  ['explicit zero overrides user rate', 0, 90, 0, true],
  ['null entry uses known user rate', null, 90, 90, true],
  ['zero user rate is known', null, 0, 0, true],
  ['missing rates stay unknown', null, null, null, false],
  ['negative override does not fall through', -1, 90, null, false],
  ['invalid string override stays unknown', '50', 90, null, false],
  ['infinite override stays unknown', Infinity, 90, null, false],
  ['NaN override stays unknown', NaN, 90, null, false],
  ['invalid user rate stays unknown', null, -30, null, false],
  ['nonnumeric user rate stays unknown', null, '90', null, false],
  ['known amount retains cents rounding', 10.123, 90, 10.12, true],
]) {
  test(`summary and detail: ${label}`, async t => {
    const f = await fixture(t, [entry(rate, userRate)]);
    const summary = (await f.get('/api/bot/projects/hours/summary')).projects[0];
    const detail = await f.get('/api/bot/projects/project-a/hours');
    for (const view of [summary, detail]) {
      assert.equal(view.costToDate, expected);
      assert.deepEqual(view.labor, { knownRateAmount: expected ?? 0, missingRateMinutes: known ? 0 : 60, missingRateEntries: known ? 0 : 1, complete: known, currency: null, currencyVerified: false });
      assert.equal(view.loggedHours, 1);assert.equal(view.percentUsed, 100);assert.equal(view.overBudget, false);
    }
    assert.equal(detail.breakdown[0].cost, expected);
    assert.equal(detail.breakdown[0].complete, known);
    assert.equal(detail.breakdown[0].currencyVerified, false);
    assert.equal(detail.budgetRemaining, 0);
  });
}

test('mixed users and mixed completeness retain known subtotal without inventing total cost', async t => {
  const f = await fixture(t, [entry(60, 100), entry(null, null, 30), entry(0, 100, 30, 'user-b'), entry(null, 80, 60, 'user-c')], 2);
  const summary = (await f.get('/api/bot/projects/hours/summary')).projects[0];
  const detail = await f.get('/api/bot/projects/project-a/hours');
  for (const view of [summary, detail]) {
    assert.equal(view.costToDate, null);assert.equal(view.labor.knownRateAmount, 140);
    assert.equal(view.labor.missingRateEntries, 1);assert.equal(view.labor.missingRateMinutes, 30);
    assert.equal(view.loggedHours, 3);assert.equal(view.percentUsed, 150);assert.equal(view.overBudget, true);
  }
  const groups = Object.fromEntries(detail.breakdown.map(row => [row.userId, row]));
  assert.equal(groups['user-a'].cost, null);assert.equal(groups['user-a'].knownRateAmount, 60);assert.equal(groups['user-a'].hours, 1.5);
  assert.equal(groups['user-b'].cost, 0);assert.equal(groups['user-b'].complete, true);
  assert.equal(groups['user-c'].cost, 80);assert.equal(detail.budgetRemaining, -1);
});

test('empty hours and no hours budget preserve existing progress behavior; summary cache policy remains', async t => {
  const f = await fixture(t, [], null);
  const first = await f.get('/api/bot/projects/hours/summary'), count = f.reads.length;
  assert.deepEqual(await f.get('/api/bot/projects/hours/summary'), first);assert.equal(f.reads.length, count);
  const view = await f.get('/api/bot/projects/project-a/hours');
  assert.equal(view.costToDate, 0);assert.equal(view.labor.complete, true);assert.equal(view.labor.currency, null);
  assert.equal(view.percentUsed, 0);assert.equal(view.estimatedHours, 0);assert.equal(view.budgetRemaining, null);assert.deepEqual(view.breakdown, []);
});

test('hours routes retain bot auth and foreign project denial', async t => {
  const f = await fixture(t, []);
  const anonymous = await f.app.inject('/api/bot/projects/hours/summary');assert.equal(anonymous.statusCode, 401);assert.equal(f.reads.length, 0);
  const foreign = await f.app.inject({ url: '/api/bot/projects/foreign/hours', headers: { authorization: 'Bearer synthetic-bot-hours-secret' } });assert.equal(foreign.statusCode, 404);
});
