// POST /api/auth/forgot-password: the reset link goes to the address stored on
// the account (never the address as typed), and the reply is the same
// `{ success: true }`, returned at the same point, whether or not the account
// exists and whether or not the email could be sent.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
const { default: authRoutes } = await import('../../routes/auth.routes.js');

const STORED = { id: 'user-1', email: 'Robin.Owner@Agency.test' };

function fakeDatabase({ users = [STORED], failLookup = false } = {}) {
  const db = { updates: [], lookups: 0 };
  db.client = {
    user: {
      findFirst: async ({ where }) => {
        db.lookups += 1;
        if (failLookup) throw new Error('database unavailable');
        const wanted = where.email.equals.toLowerCase();
        assert.equal(where.isActive, true, 'only active accounts get a reset link');
        return users.find((row) => row.email.toLowerCase() === wanted && row.isActive !== false) ?? null;
      },
      update: async ({ where, data }) => { db.updates.push({ where, data }); return { id: where.id }; },
    },
  };
  return db;
}

async function buildApp(t, db, { send } = {}) {
  const sent = [];
  const settled = [];
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'unit-test-secret' });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', db.client);
  app.addHook('onRequest', async (request) => { request.prisma = db.client; });
  await app.register(authRoutes, {
    sendPasswordResetEmail: send ?? (async (message) => { sent.push(message); }),
    onPasswordResetSettled: (work) => settled.push(work),
  });
  t.after(() => app.close());
  return { app, sent, settled };
}

const forgot = (app, email) => app.inject({ method: 'POST', url: '/forgot-password', payload: { email } });

test('the reset link is sent to the stored address, not the address as typed', async (t) => {
  const db = fakeDatabase();
  const { app, sent, settled } = await buildApp(t, db);

  const response = await forgot(app, 'ROBIN.owner@agency.TEST');
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { success: true });
  await Promise.all(settled);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, STORED.email);
  assert.match(sent[0].resetLink, /\/reset-password\?token=[0-9a-f]{64}$/);
  // Only the hash of the token is stored.
  assert.equal(db.updates.length, 1);
  const token = new URL(sent[0].resetLink).searchParams.get('token');
  assert.notEqual(db.updates[0].data.resetToken, token);
  assert.match(db.updates[0].data.resetToken, /^[0-9a-f]{64}$/);
});

test('an unknown address gets the same reply and nothing is sent', async (t) => {
  const db = fakeDatabase();
  const { app, sent, settled } = await buildApp(t, db);
  const response = await forgot(app, 'nobody@agency.test');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true });
  assert.equal(settled.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(db.updates.length, 0);
});

test('a mail failure is logged, never surfaced: the reply is still success', async (t) => {
  const db = fakeDatabase();
  const { app, settled } = await buildApp(t, db, { send: async () => { throw new Error('Mailgun refused the message'); } });
  const response = await forgot(app, STORED.email);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { success: true });
  // The background work settles without an unhandled rejection.
  await Promise.all(settled);
});

test('a lookup failure is not surfaced either', async (t) => {
  const db = fakeDatabase({ failLookup: true });
  const { app } = await buildApp(t, db);
  const response = await forgot(app, STORED.email);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true });
});

test('the reply does not wait for the token write or the mail delivery', async (t) => {
  const db = fakeDatabase();
  let releaseMail;
  const mailGate = new Promise((resolve) => { releaseMail = resolve; });
  const { app, settled } = await buildApp(t, db, { send: () => mailGate });

  // Both paths answer after the account lookup alone, while the slow mail
  // delivery for the existing account is still in flight.
  const existing = await forgot(app, STORED.email);
  const missing = await forgot(app, 'nobody@agency.test');
  assert.equal(existing.statusCode, 200);
  assert.equal(existing.body, missing.body);
  assert.equal(db.lookups, 2);
  assert.equal(settled.length, 1, 'the delivery is still pending');
  releaseMail();
  await Promise.all(settled);
});

test('an inactive account is treated as missing', async (t) => {
  const db = fakeDatabase({ users: [{ ...STORED, isActive: false }] });
  const { app, sent, settled } = await buildApp(t, db);
  const response = await forgot(app, STORED.email);
  assert.deepEqual(response.json(), { success: true });
  assert.equal(settled.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(db.updates.length, 0);
});

test('no token work happens before the reply is sent', async (t) => {
  const db = fakeDatabase();
  const { app, settled } = await buildApp(t, db);
  const response = await forgot(app, STORED.email);
  assert.equal(response.statusCode, 200);
  // The token write is deferred past the reply (setImmediate).
  assert.equal(db.updates.length, 0);
  await Promise.all(settled);
  assert.equal(db.updates.length, 1);
});
