import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import googleCalendarRoutes from '../../routes/google-calendar.routes.js';

async function buildApp(prisma, options = {}) {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-jwt-secret' });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'MEMBER' };
  });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(googleCalendarRoutes, options);
  return app;
}

test('starts user-scoped Google OAuth with calendar-events scope and signed state', async (t) => {
  const app = await buildApp({}, {
    googleClientId: 'client-1', googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://hub.example/api/google-calendar/oauth/callback',
    createOAuthClient: () => ({ generateAuthUrl: ({ scope, state, access_type: accessType, prompt }) => {
      const url = new URL('https://accounts.example/o/oauth2/v2/auth');
      url.searchParams.set('scope', scope.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('access_type', accessType);
      url.searchParams.set('prompt', prompt);
      return url.toString();
    } }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/oauth/start' });
  const url = new URL(response.headers.location);
  assert.equal(response.statusCode, 302);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  const state = app.jwt.verify(url.searchParams.get('state'));
  assert.equal(state.type, 'google_calendar_oauth');
  assert.equal(state.userId, 'user-1');
  assert.equal(state.organizationId, 'org-1');
});

test('exchanges OAuth code and stores an encrypted refresh token for the connecting user', async (t) => {
  let stored;
  const app = await buildApp({
    googleCalendarConnection: {
      findFirst: async () => null,
      create: async ({ data }) => { stored = data; return { id: 'connection-1', ...data }; },
    },
  }, {
    googleClientId: 'client-1', googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://hub.example/api/google-calendar/oauth/callback',
    encryptSecret: (value) => `encrypted:${value}`,
    createOAuthClient: () => ({ getToken: async () => ({ tokens: { refresh_token: 'sensitive-refresh-token', scope: 'https://www.googleapis.com/auth/calendar.events' } }) }),
  });
  t.after(() => app.close());
  const state = app.jwt.sign({ type: 'google_calendar_oauth', organizationId: 'org-1', userId: 'user-1' }, { expiresIn: '10m' });

  const response = await app.inject({ method: 'GET', url: `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}` });
  assert.equal(response.statusCode, 200);
  assert.equal(stored.organizationId, 'org-1');
  assert.equal(stored.userId, 'user-1');
  assert.equal(stored.refreshTokenEncrypted, 'encrypted:sensitive-refresh-token');
  assert.deepEqual(JSON.parse(stored.scopes), ['https://www.googleapis.com/auth/calendar.events']);
  assert.equal(response.json().connection.refreshTokenEncrypted, undefined);
});

test('returns the current user connection without its provider token', async (t) => {
  const app = await buildApp({
    googleCalendarConnection: { findFirst: async () => ({ id: 'connection-1', userId: 'user-1', refreshTokenEncrypted: 'ciphertext', status: 'ACTIVE' }) },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/connection' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().connection.id, 'connection-1');
  assert.equal(response.json().connection.refreshTokenEncrypted, undefined);
});

test('explicitly syncs an event to the creator Google calendar and records the external link', async (t) => {
  let eventUpdate;
  let providerInput;
  const app = await buildApp({
    googleCalendarConnection: {
      findFirst: async () => ({ id: 'connection-1', userId: 'user-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext', status: 'ACTIVE' }),
      update: async () => ({ id: 'connection-1' }),
    },
    calendarEvent: {
      findFirst: async () => ({ id: 'event-1', createdById: 'user-1', title: 'Kickoff', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { eventUpdate = data; return { id: 'event-1', ...data }; },
    },
  }, {
    decryptSecret: () => 'refresh-token',
    createCalendarClient: ({ refreshToken }) => {
      providerInput = refreshToken;
      return { events: { insert: async () => ({ data: { id: 'google-event-1', htmlLink: 'https://calendar.example/events/1' } }) } };
    },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/events/event-1/sync' });
  assert.equal(response.statusCode, 200);
  assert.equal(providerInput, 'refresh-token');
  assert.deepEqual({ ...eventUpdate, googleSyncedAt: undefined }, {
    googleEventId: 'google-event-1', googleEventUrl: 'https://calendar.example/events/1',
    googleSyncStatus: 'SYNCED', googleSyncError: null, googleSyncedAt: undefined,
  });
  assert.ok(eventUpdate.googleSyncedAt instanceof Date);
  assert.equal(response.json().event.googleEventId, 'google-event-1');
});

test('refuses a second Google sync while the event is already being synchronized', async (t) => {
  let providerCalled = false;
  const app = await buildApp({
    googleCalendarConnection: {
      findFirst: async () => ({ id: 'connection-1', userId: 'user-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext', status: 'ACTIVE' }),
    },
    calendarEvent: {
      findFirst: async () => ({ id: 'event-1', createdById: 'user-1', googleSyncStatus: 'SYNCING' }),
      updateMany: async () => ({ count: 0 }),
    },
  }, {
    decryptSecret: () => 'refresh-token',
    createCalendarClient: () => ({ events: { insert: async () => { providerCalled = true; return { data: { id: 'google-event-1' } }; } } }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/events/event-1/sync' });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'GOOGLE_CALENDAR_SYNC_IN_PROGRESS');
  assert.equal(providerCalled, false);
});

test('allows the event creator to explicitly retry a failed Google update with a known external event ID', async (t) => {
  let connectionLookup;
  let providerCalled = false;
  const app = await buildApp({
    googleCalendarConnection: {
      findFirst: async ({ where }) => {
        connectionLookup = where;
        return { id: 'connection-1', userId: 'user-1', calendarId: 'primary', refreshTokenEncrypted: 'ciphertext', status: 'ERROR' };
      },
      update: async () => ({ id: 'connection-1' }),
    },
    calendarEvent: {
      findFirst: async () => ({ id: 'event-1', createdById: 'user-1', title: 'Kickoff', startTime: new Date('2026-08-13T14:00:00.000Z'), endTime: new Date('2026-08-13T15:00:00.000Z'), isAllDay: false, googleEventId: 'google-event-1', googleSyncStatus: 'ERROR' }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => ({ id: 'event-1', ...data }),
    },
  }, {
    decryptSecret: () => 'refresh-token',
    createCalendarClient: () => ({ events: { update: async () => { providerCalled = true; return { data: { id: 'google-event-1', htmlLink: 'https://calendar.example/events/1' } }; } } }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/events/event-1/sync' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(connectionLookup, { userId: 'user-1', status: { in: ['ACTIVE', 'ERROR'] } });
  assert.equal(providerCalled, true);
});
