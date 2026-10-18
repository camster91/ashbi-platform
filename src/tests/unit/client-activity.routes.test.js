import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import clientRoutes from '../../routes/client.routes.js';
import { CLIENT_ACTIVITY_MAX_LIMIT } from '../../services/client-activity.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

// GET /api/clients/:id/activity, through the real tenant proxy over a small
// in-memory database. Two organizations each have a client; org-1's client
// has a conversation, project feed rows (one of them a note, which must stay
// out), an invoice that was sent and paid by a recorded payment, and an older
// invoice marked paid with no payment rows.

const org1 = { organizationId: 'org-1' };
const org2 = { organizationId: 'org-2' };
const project1 = { id: 'p1', name: 'Holiday page', clientId: 'c1', client: { id: 'c1', ...org1 }, ...org1 };
const project2 = { id: 'p2', name: 'Other studio work', clientId: 'c2', client: { id: 'c2', ...org2 }, ...org2 };
const cam = { id: 'u1', name: 'Cam' };

const DB = {
  client: [
    { id: 'c1', name: 'Northwind', ...org1, deletedAt: null },
    { id: 'c2', name: 'Foreign client', ...org2, deletedAt: null },
  ],
  thread: [
    { id: 't1', subject: 'Banner sizes', status: 'OPEN', lastActivityAt: new Date('2026-10-16T10:00:00Z'), clientId: 'c1', client: { id: 'c1', ...org1 }, project: project1, deletedAt: null },
    { id: 't2', subject: 'Foreign thread', status: 'OPEN', lastActivityAt: new Date('2026-10-16T11:00:00Z'), clientId: 'c2', client: { id: 'c2', ...org2 }, project: project2, deletedAt: null },
  ],
  activity: [
    { id: 'a1', type: 'FILE_UPLOADED', action: 'uploaded', entityType: 'ATTACHMENT', entityId: 'f1', entityName: 'banner.png', metadata: '{}', createdAt: new Date('2026-10-15T09:00:00Z'), user: cam, project: project1 },
    { id: 'a2', type: 'CHAT_MESSAGE', action: 'created', entityType: 'CHAT', entityId: 'm1', entityName: 'secret plans for the launch', metadata: '{}', createdAt: new Date('2026-10-14T09:00:00Z'), user: cam, project: project1 },
    { id: 'a3', type: 'NOTE_CREATED', action: 'created', entityType: 'NOTE', entityId: 'n1', entityName: 'Private note', metadata: '{}', createdAt: new Date('2026-10-13T09:00:00Z'), user: cam, project: project1 },
    { id: 'a4', type: 'CLIENT_FEEDBACK', action: 'commented', entityType: 'PROJECT', entityId: 'p1', entityName: 'Holiday page', metadata: '{"message":"please change the hero"}', createdAt: new Date('2026-10-12T09:00:00Z'), user: cam, project: project1 },
    { id: 'a9', type: 'FILE_UPLOADED', action: 'uploaded', entityType: 'ATTACHMENT', entityId: 'f9', entityName: 'foreign.png', metadata: '{}', createdAt: new Date('2026-10-15T12:00:00Z'), user: cam, project: project2 },
  ],
  invoice: [
    { id: 'i1', invoiceNumber: 'INV-1036', title: 'October care plan', total: 1356, currency: 'CAD', sentAt: new Date('2026-10-01T09:00:00Z'), paidAt: new Date('2026-10-03T09:00:00Z'), paymentMethod: 'STRIPE', clientId: 'c1', client: { id: 'c1', ...org1 }, payments: [{ id: 'pay1' }], ...org1, deletedAt: null },
    { id: 'i0', invoiceNumber: 'INV-1001', title: 'Old work', total: 500, currency: 'CAD', sentAt: null, paidAt: new Date('2026-01-03T09:00:00Z'), paymentMethod: 'BANK', clientId: 'c1', client: { id: 'c1', ...org1 }, payments: [], ...org1, deletedAt: null },
    { id: 'i9', invoiceNumber: 'INV-9', title: 'Foreign', total: 9, currency: 'USD', sentAt: new Date('2026-10-02T09:00:00Z'), paidAt: null, clientId: 'c2', client: { id: 'c2', ...org2 }, payments: [], ...org2, deletedAt: null },
  ],
  invoicePayment: [
    { id: 'pay1', amount: 1356, method: 'STRIPE', paidAt: new Date('2026-10-03T09:00:00Z'), invoice: { id: 'i1', invoiceNumber: 'INV-1036', currency: 'CAD', clientId: 'c1', client: { id: 'c1', ...org1 } } },
  ],
};

const isObject = (value) => value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value);

// Evaluates the where shapes the route and the tenant proxy build:
// AND/OR, nested relation filters, in/lt/not/none.
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'AND') return condition.every((part) => matches(row, part));
    if (key === 'OR') return condition.some((part) => matches(row, part));
    const value = row?.[key];
    if (Array.isArray(value) && isObject(condition) && 'none' in condition) {
      return !value.some((item) => matches(item, condition.none));
    }
    if (isObject(condition)) {
      const operators = ['in', 'lt', 'not', 'gte', 'lte', 'gt', 'none'];
      if (Object.keys(condition).some((op) => operators.includes(op))) {
        if ('in' in condition && !condition.in.includes(value)) return false;
        if ('lt' in condition && !(value != null && value < condition.lt)) return false;
        if ('lte' in condition && !(value != null && value <= condition.lte)) return false;
        if ('gt' in condition && !(value != null && value > condition.gt)) return false;
        if ('not' in condition && (condition.not === null ? value == null : value === condition.not)) return false;
        return true;
      }
      return isObject(value) && matches(value, condition);
    }
    if (condition === null) return value == null;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    return value === condition;
  });
}

function pick(row, select) {
  if (!select) return row;
  return Object.fromEntries(Object.entries(select).map(([field, spec]) => {
    const value = row[field] ?? null;
    if (isObject(spec) && spec.select && isObject(value)) return [field, pick(value, spec.select)];
    return [field, value];
  }));
}

function fakeDatabase() {
  const calls = {};
  const delegate = (name) => {
    const findMany = async (args = {}) => {
      (calls[name] ??= []).push(args);
      // orderBy is { field: 'desc' } or [{ field: 'desc' }, { id: 'asc' }].
      const order = (Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])
        .map((part) => Object.entries(part)[0]);
      const compare = (a, b) => {
        for (const [field, direction] of order) {
          const x = a[field] ?? 0;
          const y = b[field] ?? 0;
          if (x < y) return direction === 'desc' ? 1 : -1;
          if (x > y) return direction === 'desc' ? -1 : 1;
        }
        return 0;
      };
      return DB[name]
        .filter((row) => matches(row, args.where))
        .sort(compare)
        .slice(0, args.take ?? Infinity)
        .map((row) => pick(row, args.select));
    };
    return {
      findMany,
      findFirst: async (args) => (await findMany({ ...args, take: 1 }))[0] ?? null,
      findUnique: async (args) => (await findMany({ ...args, take: 1 }))[0] ?? null,
    };
  };
  return { calls, client: delegate('client'), thread: delegate('thread'), activity: delegate('activity'), invoice: delegate('invoice'), invoicePayment: delegate('invoicePayment') };
}

async function buildApp(t, user) {
  const database = fakeDatabase();
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => { request.user = user; });
  app.decorate('adminOnly', async () => {});
  app.addHook('onRequest', async (request) => { request.prisma = createScopedPrisma(database, user.organizationId); });
  await app.register(clientRoutes);
  t.after(() => app.close());
  return { app, database };
}

const admin = { id: 'u1', role: 'ADMIN', organizationId: 'org-1' };
const team = { id: 'u2', role: 'TEAM', organizationId: 'org-1' };

test('admins get one newest-first timeline with money, conversations and project work', async (t) => {
  const { app } = await buildApp(t, admin);
  const response = await app.inject({ method: 'GET', url: '/c1/activity' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.items.map((item) => item.id), [
    'thread:t1',
    'activity:a1',
    'activity:a2',
    'activity:a4',
    'payment:pay1',
    'invoice-sent:i1',
    'invoice-paid:i0',
  ]);
  assert.equal(body.nextBefore, null);
  const payment = body.items.find((item) => item.kind === 'payment');
  assert.deepEqual({ amount: payment.amount, currency: payment.currency, method: payment.method, title: payment.title }, { amount: 1356, currency: 'CAD', method: 'STRIPE', title: 'INV-1036' });
  // The invoice paid through a recorded payment is not listed twice.
  assert.equal(body.items.filter((item) => item.kind === 'invoice_paid').length, 1);
});

test('the feed never carries chat text, notes or project feed metadata', async (t) => {
  const { app } = await buildApp(t, admin);
  const raw = (await app.inject({ method: 'GET', url: '/c1/activity' })).body;
  assert.doesNotMatch(raw, /secret plans/);
  assert.doesNotMatch(raw, /Private note/);
  assert.doesNotMatch(raw, /please change the hero/);
  assert.doesNotMatch(raw, /metadata/);
});

test('team members get no invoices or payments, and the money tables are never read', async (t) => {
  const { app, database } = await buildApp(t, team);
  const response = await app.inject({ method: 'GET', url: '/c1/activity' });
  assert.equal(response.statusCode, 200);
  const kinds = response.json().items.map((item) => item.kind);
  assert.ok(kinds.includes('conversation'));
  assert.ok(kinds.includes('file'));
  assert.equal(kinds.some((kind) => ['payment', 'invoice_sent', 'invoice_paid'].includes(kind)), false);
  assert.doesNotMatch(response.body, /INV-|1356|amount/);
  assert.equal(database.calls.invoice, undefined);
  assert.equal(database.calls.invoicePayment, undefined);
});

test('another organization\'s client is a 404 and nothing of it is read', async (t) => {
  const { app, database } = await buildApp(t, admin);
  const response = await app.inject({ method: 'GET', url: '/c2/activity' });
  assert.equal(response.statusCode, 404);
  assert.equal(database.calls.thread, undefined);
  assert.equal(database.calls.activity, undefined);
  assert.equal(database.calls.invoice, undefined);
});

test('client portal and unknown roles are refused before any read', async (t) => {
  for (const role of ['CLIENT', 'BOT']) {
    const { app, database } = await buildApp(t, { id: 'x', role, organizationId: 'org-1' });
    const response = await app.inject({ method: 'GET', url: '/c1/activity' });
    assert.equal(response.statusCode, 403, role);
    assert.deepEqual(database.calls, {}, role);
  }
});

test('pages with a limit and a before date, capped at the maximum', async (t) => {
  const { app, database } = await buildApp(t, admin);
  const first = (await app.inject({ method: 'GET', url: '/c1/activity?limit=3' })).json();
  assert.deepEqual(first.items.map((item) => item.id), ['thread:t1', 'activity:a1', 'activity:a2']);
  assert.equal(first.nextBefore, '2026-10-14T09:00:00.000Z');

  const second = (await app.inject({ method: 'GET', url: `/c1/activity?limit=3&before=${encodeURIComponent(first.nextBefore)}` })).json();
  assert.deepEqual(second.items.map((item) => item.id), ['activity:a4', 'payment:pay1', 'invoice-sent:i1']);

  await app.inject({ method: 'GET', url: '/c1/activity?limit=999' });
  assert.equal(database.calls.thread.at(-1).take, CLIENT_ACTIVITY_MAX_LIMIT + 1);
});

test('items sharing the page-boundary time are not skipped', async (t) => {
  const tied = new Date('2026-10-11T09:00:00Z');
  const extra = ['a5', 'a6', 'a7'].map((id) => ({ id, type: 'FILE_UPLOADED', action: 'uploaded', entityType: 'ATTACHMENT', entityId: `f-${id}`, entityName: `${id}.png`, metadata: '{}', createdAt: tied, user: cam, project: project1 }));
  DB.activity.push(...extra);
  t.after(() => { DB.activity.splice(DB.activity.length - extra.length, extra.length); });
  const { app } = await buildApp(t, admin);

  const first = (await app.inject({ method: 'GET', url: '/c1/activity?limit=5' })).json();
  assert.deepEqual(first.items.map((item) => item.id), ['thread:t1', 'activity:a1', 'activity:a2', 'activity:a4', 'activity:a5']);
  assert.equal(first.nextBefore, tied.toISOString());
  assert.equal(first.nextBeforeId, 'activity:a5');

  const second = (await app.inject({
    method: 'GET',
    url: `/c1/activity?limit=5&before=${encodeURIComponent(first.nextBefore)}&beforeId=${encodeURIComponent(first.nextBeforeId)}`,
  })).json();
  assert.deepEqual(second.items.map((item) => item.id), ['activity:a6', 'activity:a7', 'payment:pay1', 'invoice-sent:i1', 'invoice-paid:i0']);
  assert.equal(second.nextBefore, null);
});

test('rejects a malformed limit, before date or unknown query field', async (t) => {
  const { app } = await buildApp(t, admin);
  for (const query of ['limit=-1', 'limit=abc', 'before=yesterday', 'clientId=c2', 'before=2026-10-01T00:00:00Z&beforeId=bogus', 'before=2026-10-01T00:00:00Z&beforeId=thread:t1;drop']) {
    const response = await app.inject({ method: 'GET', url: `/c1/activity?${query}` });
    assert.equal(response.statusCode, 400, query);
  }
});
