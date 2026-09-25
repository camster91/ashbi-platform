import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import auditEventRoutes, {
  AUDIT_MAX_LIMIT,
  decodeAuditCursor,
  encodeAuditCursor,
} from '../../routes/audit-event.routes.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

// 7 events, newest first by (createdAt DESC, id DESC); two share a timestamp
// so the cursor must break ties on id.
const ROWS = [
  { id: 'e7', organizationId: 'org-1', createdAt: new Date('2026-09-07T00:00:00Z'), action: 'invoice.sent', entityType: 'invoice', entityId: 'inv-1', actorUserId: 'admin-1', actorType: 'USER' },
  { id: 'e6', organizationId: 'org-1', createdAt: new Date('2026-09-06T00:00:00Z'), action: 'invoice.paid', entityType: 'invoice', entityId: 'inv-1', actorUserId: null, actorType: 'WEBHOOK' },
  { id: 'e5', organizationId: 'org-1', createdAt: new Date('2026-09-05T00:00:00Z'), action: 'payment.recorded', entityType: 'invoice_payment', entityId: 'pay-1', actorUserId: null, actorType: 'WEBHOOK' },
  { id: 'e4b', organizationId: 'org-1', createdAt: new Date('2026-09-04T00:00:00Z'), action: 'auth.login_failed', entityType: 'user', entityId: 'user-2', actorUserId: null, actorType: 'USER' },
  { id: 'e4a', organizationId: 'org-1', createdAt: new Date('2026-09-04T00:00:00Z'), action: 'user.role_changed', entityType: 'user', entityId: 'user-2', actorUserId: 'admin-1', actorType: 'USER' },
  { id: 'e2', organizationId: 'org-1', createdAt: new Date('2026-09-02T00:00:00Z'), action: 'api_key.created', entityType: 'api_key', entityId: 'key-1', actorUserId: 'ghost', actorType: 'USER' },
  { id: 'e1', organizationId: 'org-1', createdAt: new Date('2026-09-01T00:00:00Z'), action: 'contract.signed', entityType: 'contract', entityId: 'k-1', actorUserId: null, actorType: 'CLIENT' },
  { id: 'x1', organizationId: 'org-2', createdAt: new Date('2026-09-08T00:00:00Z'), action: 'invoice.sent', entityType: 'invoice', entityId: 'inv-foreign', actorUserId: 'other-admin', actorType: 'USER' },
];

// A tiny evaluator for the where shapes the route builds, so pagination and
// filter semantics are exercised rather than just the argument shape.
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every((part) => matches(row, part));
    if (key === 'OR') return condition.some((part) => matches(row, part));
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(value);
      if ('lt' in condition && !(value < condition.lt)) return false;
      if ('gte' in condition && !(value >= condition.gte)) return false;
      if ('lte' in condition && !(value <= condition.lte)) return false;
      return true;
    }
    if (condition instanceof Date) return value?.getTime() === condition.getTime();
    return value === condition;
  });
}

function fakeDatabase() {
  const calls = [];
  const byNewest = (a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : -1);
  return {
    calls,
    auditEvent: {
      findMany: async (args) => {
        calls.push(args);
        return ROWS.filter((row) => matches(row, args.where)).sort(byNewest).slice(0, args.take)
          .map((row) => (args.select
            ? Object.fromEntries(Object.keys(args.select).map((field) => [field, row[field] ?? null]))
            : row));
      },
    },
    user: {
      findMany: async ({ where }) => [{ id: 'admin-1', name: 'Ada Admin', organizationId: 'org-1' }]
        .filter((user) => matches(user, where))
        .map(({ id, name }) => ({ id, name })),
    },
  };
}

async function buildApp(t, user) {
  const database = fakeDatabase();
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => { request.user = user; });
  app.decorate('adminOnly', async (request, reply) => {
    request.user = user;
    if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  // Use the real tenant proxy so org scoping is part of what is tested.
  app.addHook('onRequest', async (request) => { request.prisma = createScopedPrisma(database, user.organizationId); });
  await app.register(auditEventRoutes);
  t.after(() => app.close());
  return { app, database };
}

const ADMIN = { id: 'admin-1', role: 'ADMIN', organizationId: 'org-1' };

test('non-admin staff and client principals are refused', async (t) => {
  for (const role of ['TEAM', 'STAFF', 'CLIENT', 'BOT']) {
    const { app, database } = await buildApp(t, { id: 'u', role, organizationId: 'org-1' });
    for (const url of ['/', '/catalog']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 403, `${role} ${url}`);
    }
    assert.equal(database.calls.length, 0);
  }
});

test('an admin sees only their organization, newest first, with actor names resolved in-tenant', async (t) => {
  const { app } = await buildApp(t, ADMIN);
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.events.map((event) => event.id), ['e7', 'e6', 'e5', 'e4b', 'e4a', 'e2', 'e1']);
  assert.equal(body.nextCursor, null);
  assert.equal(body.events[0].actorName, 'Ada Admin');
  assert.equal(body.events[5].actorName, null, 'an unknown actor id stays unresolved');
  assert.equal(body.events.some((event) => event.organizationId), false, 'organizationId is not echoed');
});

test('cursor pagination walks every event exactly once, including timestamp ties', async (t) => {
  const { app } = await buildApp(t, ADMIN);
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const url = `/?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.ok(body.events.length <= 2);
    seen.push(...body.events.map((event) => event.id));
    cursor = body.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.deepEqual(seen, ['e7', 'e6', 'e5', 'e4b', 'e4a', 'e2', 'e1']);
  assert.equal(pages, 4);
});

test('filters map onto the query and compose', async (t) => {
  const { app, database } = await buildApp(t, ADMIN);
  const byEntity = await app.inject({ method: 'GET', url: '/?entityType=invoice&entityId=inv-1' });
  assert.deepEqual(byEntity.json().events.map((event) => event.id), ['e7', 'e6']);
  const byAction = await app.inject({ method: 'GET', url: '/?action=user.role_changed' });
  assert.deepEqual(byAction.json().events.map((event) => event.id), ['e4a']);
  const byActor = await app.inject({ method: 'GET', url: '/?actorUserId=admin-1' });
  assert.deepEqual(byActor.json().events.map((event) => event.id), ['e7', 'e4a']);
  const byActorType = await app.inject({ method: 'GET', url: '/?actorType=WEBHOOK' });
  assert.deepEqual(byActorType.json().events.map((event) => event.id), ['e6', 'e5']);
  const byRange = await app.inject({ method: 'GET', url: '/?from=2026-09-02T00:00:00Z&to=2026-09-05T00:00:00Z' });
  assert.deepEqual(byRange.json().events.map((event) => event.id), ['e5', 'e4b', 'e4a', 'e2']);
  // Every query carried the tenant filter injected by the proxy.
  for (const call of database.calls) assert.equal(call.where.organizationId, 'org-1');
  // A forged organization filter in the query string is rejected outright.
  const forged = await app.inject({ method: 'GET', url: '/?organizationId=org-2' });
  assert.equal(forged.statusCode, 400);
});

test('limits are clamped and malformed input is rejected', async (t) => {
  const { app, database } = await buildApp(t, ADMIN);
  await app.inject({ method: 'GET', url: '/?limit=100000' });
  assert.equal(database.calls.at(-1).take, AUDIT_MAX_LIMIT + 1);
  await app.inject({ method: 'GET', url: '/?limit=-5' });
  assert.equal(database.calls.at(-1).take, 51);
  for (const url of [
    '/?cursor=not-a-cursor',
    '/?action=invoice.hacked',
    '/?entityType=secrets',
    '/?actorType=ROOT',
    '/?from=yesterday',
    '/?from=2026-09-05T00:00:00Z&to=2026-09-01T00:00:00Z',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
  }
});

test('the catalog lists the server vocabulary for the UI filters', async (t) => {
  const { app } = await buildApp(t, ADMIN);
  const body = (await app.inject({ method: 'GET', url: '/catalog' })).json();
  assert.ok(body.actions.includes('invoice.paid'));
  assert.ok(body.entityTypes.includes('invoice_payment'));
  assert.deepEqual(body.actorTypes, ['USER', 'CLIENT', 'SYSTEM', 'WEBHOOK', 'BOT']);
});

test('cursors round-trip and reject tampering', () => {
  const cursor = encodeAuditCursor({ id: 'e4a', createdAt: new Date('2026-09-04T00:00:00Z') });
  assert.deepEqual(decodeAuditCursor(cursor), { id: 'e4a', createdAt: new Date('2026-09-04T00:00:00Z') });
  assert.equal(decodeAuditCursor(Buffer.from('nope|x|y').toString('base64url')), null);
  assert.equal(decodeAuditCursor(Buffer.from('garbage|id').toString('base64url')), null);
});
