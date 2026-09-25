import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import googleCalendarRoutes from '../../routes/google-calendar.routes.js';
import calendarRoutes from '../../routes/calendar.routes.js';

async function buildApp(routes, prisma, options = {}) {
  const logs = [];
  const stream = new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } });
  const app = Fastify({ logger: { level: 'warn', stream } });
  await app.register(jwt, { secret: 'test-jwt-secret' });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'MEMBER' };
  });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(routes, options);
  return { app, logs };
}

const activeConnection = { id: 'connection-1', userId: 'user-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext', status: 'ACTIVE' };

test('disconnect revokes the Google refresh token before clearing it', async (t) => {
  let update;
  let revoked;
  const { app } = await buildApp(googleCalendarRoutes, {
    googleCalendarConnection: { findFirst: async () => activeConnection, update: async ({ data }) => { update = data; return {}; } },
  }, {
    decryptSecret: () => 'refresh-secret',
    revokeGoogleToken: async ({ token }) => { revoked = token; return { revoked: true }; },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/connection/disconnect' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, tokenRevoked: true });
  assert.equal(revoked, 'refresh-secret');
  assert.equal(update.status, 'DISCONNECTED');
  assert.equal(update.refreshTokenEncrypted, '');
});

test('disconnect still completes when Google revocation fails and never logs the token', async (t) => {
  let update;
  const { app, logs } = await buildApp(googleCalendarRoutes, {
    googleCalendarConnection: { findFirst: async () => activeConnection, update: async ({ data }) => { update = data; return {}; } },
  }, {
    decryptSecret: () => 'refresh-secret',
    revokeGoogleToken: async ({ token }) => { throw new Error(`revoke failed for token=${token}`); },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/connection/disconnect' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, tokenRevoked: false });
  assert.equal(update.status, 'DISCONNECTED');
  assert.ok(logs.some((line) => line.includes('Google token revocation failed')));
  assert.ok(logs.every((line) => !line.includes('refresh-secret')));
});

test('a sync can take over a SYNCING claim older than the stale-lock bound', async (t) => {
  let claimWhere;
  const now = new Date('2026-09-25T12:00:00.000Z');
  const { app } = await buildApp(googleCalendarRoutes, {
    googleCalendarConnection: { findFirst: async () => activeConnection, update: async () => ({}) },
    calendarEvent: {
      findFirst: async () => ({ id: 'event-1', createdById: 'user-1', title: 'Kickoff', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false, googleSyncStatus: 'SYNCING' }),
      updateMany: async ({ where }) => { claimWhere = where; return { count: 1 }; },
      update: async ({ data }) => ({ id: 'event-1', ...data }),
    },
  }, {
    now: () => now,
    decryptSecret: () => 'refresh-token',
    createCalendarClient: () => ({ events: { insert: async () => ({ data: { id: 'google-1' } }) } }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/events/event-1/sync' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(claimWhere.OR, [
    { googleSyncStatus: { not: 'SYNCING' } },
    { googleSyncStatus: 'SYNCING', updatedAt: { lt: new Date('2026-09-25T11:45:00.000Z') } },
  ]);
});

test('a failed sync records and logs a scrubbed reason instead of swallowing it', async (t) => {
  let eventUpdate;
  let connectionUpdate;
  const { app, logs } = await buildApp(googleCalendarRoutes, {
    googleCalendarConnection: { findFirst: async () => activeConnection, update: async ({ data }) => { connectionUpdate = data; return {}; } },
    calendarEvent: {
      findFirst: async () => ({ id: 'event-1', createdById: 'user-1', title: 'Kickoff', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { eventUpdate = data; return {}; },
    },
  }, {
    decryptSecret: () => 'refresh-token',
    createCalendarClient: () => ({
      events: {
        insert: async () => {
          throw Object.assign(new Error('invalid_grant'), {
            response: { status: 400, data: { error: 'invalid_grant' } },
            config: { headers: { Authorization: 'Bearer ya29.leaked-access' }, data: 'refresh_token=refresh-token' },
          });
        },
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/events/event-1/sync' });

  assert.equal(response.statusCode, 502);
  assert.equal(eventUpdate.googleSyncStatus, 'ERROR');
  assert.equal(eventUpdate.googleSyncError, 'Google Calendar sync failed (400): invalid_grant');
  assert.equal(connectionUpdate.status, 'ERROR');
  assert.equal(connectionUpdate.lastError, eventUpdate.googleSyncError);
  const warning = logs.find((line) => line.includes('Google Calendar sync failed'));
  assert.ok(warning);
  assert.ok(!warning.includes('ya29.leaked-access') && !warning.includes('refresh-token'));
});

test('deleting a synced Hub event propagates the delete to Google after the local delete', async (t) => {
  const order = [];
  let propagated;
  const existing = { id: 'event-1', createdById: 'user-1', googleEventId: 'google-1' };
  const { app } = await buildApp(calendarRoutes, {
    calendarEvent: {
      findUnique: async () => existing,
      delete: async () => { order.push('hub-delete'); return existing; },
    },
  }, {
    propagateGoogleDeletion: async (input) => { order.push('google-delete'); propagated = input.event; return { propagated: true }; },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/calendar/event-1' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, googleDeleted: true });
  assert.deepEqual(order, ['hub-delete', 'google-delete']);
  assert.equal(propagated.googleEventId, 'google-1');
});

test('a Google failure never blocks deleting the Hub event', async (t) => {
  let deleted = false;
  const { app } = await buildApp(calendarRoutes, {
    calendarEvent: {
      findUnique: async () => ({ id: 'event-1', createdById: 'user-1', googleEventId: 'google-1' }),
      delete: async () => { deleted = true; return {}; },
    },
  }, { propagateGoogleDeletion: async () => { throw new Error('unexpected'); } });
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/calendar/event-1' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true, googleDeleted: false });
  assert.equal(deleted, true);
});

test('deleting an unsynced Hub event does not contact Google', async (t) => {
  let called = false;
  const { app } = await buildApp(calendarRoutes, {
    calendarEvent: {
      findUnique: async () => ({ id: 'event-1', createdById: 'user-1', googleEventId: null }),
      delete: async () => ({}),
    },
  }, { propagateGoogleDeletion: async () => { called = true; } });
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/calendar/event-1' });

  assert.deepEqual(response.json(), { success: true });
  assert.equal(called, false);
});
