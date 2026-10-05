// #530: an async route handler that calls reply.send() without returning the
// reply resolves with undefined while async onSend hooks (the credential
// throttle, the Redis-backed rate limiter) are still running. Fastify then
// sees an unsent reply and sends again: ERR_HTTP_HEADERS_SENT, logged as a
// 500 "Reply was already sent". Handlers must `return reply.send(...)`, and
// callers of helpers that already answered must `return reply`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import authRoutes from '../../routes/auth.routes.js';
import { LocalAuthProvider } from '../../auth/providers/local.provider.js';

const PASSWORD = 'Correct-Horse-9';
const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../routes');

function fakeDb(users) {
  return {
    user: {
      findUnique: async ({ where }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      findFirst: async ({ where }) => users.find((u) => u.email === where.email) ?? null,
      findMany: async () => [],
      update: async ({ where, data }) => Object.assign(users.find((u) => u.id === where.id), data),
    },
    organization: { findUnique: async () => ({ id: 'org-a', mfaRequired: false }) },
    pushSubscription: { deleteMany: async () => ({ count: 0 }) },
    auditEvent: { create: async ({ data }) => data, findFirst: async () => null },
  };
}

async function buildApp(t, db) {
  const app = Fastify({ logger: false });
  const handlerErrors = [];
  app.setErrorHandler((error, _request, reply) => {
    handlerErrors.push(error.code || error.message);
    return reply.status(500).send({ error: 'Internal error' });
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  await app.register(jwt, { secret: 'reply-returned-secret-0123456789abcdef', cookie: { cookieName: 'token', signed: false } });
  // A slow async onSend, like a rate-limit store round trip.
  app.addHook('onSend', async (_request, _reply, payload) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return payload;
  });
  app.decorate('authenticate', async () => {});
  app.decorate('auth', new LocalAuthProvider(db, app.jwt));
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(authRoutes, { prefix: '/api/auth' });
  t.after(() => app.close());
  return { app, handlerErrors };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

test('staff login answers once even when onSend hooks are slow', async (t) => {
  const user = {
    id: 'user-a', email: 'staff@example.test', name: 'Staff', role: 'ADMIN', organizationId: 'org-a',
    isActive: true, sessionVersion: 0, mfaEnabled: false, password: await bcrypt.hash(PASSWORD, 4),
  };
  const { app, handlerErrors } = await buildApp(t, fakeDb([user]));

  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: PASSWORD } });
  await settle();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().user.email, user.email);
  assert.match(String(response.headers['set-cookie']), /token=/);
  assert.deepEqual(handlerErrors, []);
});

test('logout answers once even when onSend hooks are slow', async (t) => {
  const { app, handlerErrors } = await buildApp(t, fakeDb([]));
  const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  await settle();
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { success: true });
  assert.deepEqual(handlerErrors, []);
});

// Source checks for the two shapes that caused #530.
function routeSources() {
  return fs.readdirSync(routesDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, lines: fs.readFileSync(path.join(routesDir, name), 'utf8').split('\n') }));
}

test('route handlers return the reply after sending', () => {
  const offenders = [];
  for (const { name, lines } of routeSources()) {
    lines.forEach((line, index) => {
      if (!/^\s*reply\b/.test(line)) return;
      // Gather the statement, then look at what follows it.
      let end = index;
      let statement = line;
      while (!statement.trimEnd().endsWith(';') && end + 1 < lines.length && end - index < 20) {
        end += 1;
        statement += `\n${lines[end]}`;
      }
      if (!statement.includes('.send(')) return;
      const next = lines.slice(end + 1).find((l) => l.trim() !== '')?.trim() ?? '';
      // A helper that answered must hand control back with a return; a
      // handler must not end on an unreturned send.
      if (!next.startsWith('return')) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'send without return (use `return reply.send(...)`)');
});

test('callers of helpers that already answered return the reply', () => {
  const offenders = [];
  for (const { name, lines } of routeSources()) {
    lines.forEach((line, index) => {
      if (/\(request, reply[^)]*\)\)\s*return;/.test(line)) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'use `return reply;` after a helper that sent the response');
});
