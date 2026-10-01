import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import googleCalendarRoutes from '../../routes/google-calendar.routes.js';
import cookie from '@fastify/cookie';
import { oauthStateCookieName, signOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';

// OAuth state is signed with a key derived from JWT_SECRET (src/auth/oauth-state.js).
process.env.JWT_SECRET ||= 'oauth-state-unit-test-secret';

async function buildApp(prisma, options = {}) {
  const app = Fastify();
  await app.register(cookie);
  await app.register(jwt, { secret: 'test-jwt-secret' });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'MEMBER' };
  });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  // The organization MFA requirement is off unless a test turns it on.
  await app.register(googleCalendarRoutes, { isMfaEnrollmentRequired: async () => false, ...options });
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
  assert.match(String(response.headers['set-cookie']), new RegExp(`^${oauthStateCookieName('google_calendar_oauth')}=[^;]+;.*HttpOnly`, 'i'));
  const url = new URL(response.headers.location);
  assert.equal(response.statusCode, 302);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.throws(() => app.jwt.verify(url.searchParams.get('state')), 'OAuth state must not verify with the session key');
  const state = verifyOAuthState('google_calendar_oauth', url.searchParams.get('state'));
  assert.equal(state.type, 'google_calendar_oauth');
  assert.equal(state.userId, 'user-1');
  assert.equal(state.organizationId, 'org-1');
});

test('exchanges OAuth code, stores an encrypted refresh token, and returns to Settings', async (t) => {
  let stored;
  let ownerWhere;
  const app = await buildApp({
    user: { findFirst: async ({ where }) => { ownerWhere = where; return { id: 'user-1' }; } },
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
  const state = signOAuthState('google_calendar_oauth', { organizationId: 'org-1', userId: 'user-1' });

  const callbackUrl = `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`;
  const nonce = verifyOAuthState('google_calendar_oauth', state).nonce;
  // Without the initiating browser's binding cookie the state is refused.
  const unbound = await app.inject({ method: 'GET', url: callbackUrl });
  assert.equal(unbound.statusCode, 401);
  const response = await app.inject({ method: 'GET', url: callbackUrl, headers: { cookie: `${oauthStateCookieName('google_calendar_oauth')}=${nonce}` } });
  // The binding cookie is cleared on use, so the flow cannot be replayed from this browser.
  assert.match(String(response.headers['set-cookie']), new RegExp(`${oauthStateCookieName('google_calendar_oauth')}=;`));
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/settings?googleCalendar=connected');
  assert.equal(stored.organizationId, 'org-1');
  assert.equal(stored.userId, 'user-1');
  assert.equal(stored.refreshTokenEncrypted, 'encrypted:sensitive-refresh-token');
  assert.deepEqual(JSON.parse(stored.scopes), ['https://www.googleapis.com/auth/calendar.events']);
  // The owner is looked up within the organization the signed state names.
  assert.deepEqual(ownerWhere, { id: 'user-1', organizationId: 'org-1', isActive: true });
});

test('the OAuth callback refuses a state whose user is not an active member of its organization', async (t) => {
  let written = false;
  let exchanged = false;
  const app = await buildApp({
    user: { findFirst: async () => null },
    googleCalendarConnection: {
      findFirst: async () => null,
      create: async () => { written = true; },
      update: async () => { written = true; },
    },
  }, {
    googleClientId: 'client-1', googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://hub.example/api/google-calendar/oauth/callback',
    encryptSecret: (value) => `encrypted:${value}`,
    createOAuthClient: () => ({ getToken: async () => { exchanged = true; return { tokens: { refresh_token: 'sensitive-refresh-token' } }; } }),
  });
  t.after(() => app.close());
  const state = signOAuthState('google_calendar_oauth', { organizationId: 'org-other', userId: 'user-1' });
  const nonce = verifyOAuthState('google_calendar_oauth', state).nonce;
  const response = await app.inject({
    method: 'GET',
    url: `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    headers: { cookie: `${oauthStateCookieName('google_calendar_oauth')}=${nonce}` },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, 'GOOGLE_CALENDAR_OAUTH_STATE_INVALID');
  assert.equal(written, false);
  assert.equal(exchanged, false, 'refused before the authorization code is exchanged');
});

test('the OAuth callback never rebinds a connection that belongs to another organization', async (t) => {
  let written = false;
  let exchanged = false;
  const app = await buildApp({
    user: { findFirst: async () => ({ id: 'user-1' }) },
    googleCalendarConnection: {
      findFirst: async () => ({ id: 'connection-1', userId: 'user-1', organizationId: 'org-2' }),
      create: async () => { written = true; },
      update: async () => { written = true; },
    },
  }, {
    googleClientId: 'client-1', googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://hub.example/api/google-calendar/oauth/callback',
    encryptSecret: (value) => `encrypted:${value}`,
    createOAuthClient: () => ({ getToken: async () => { exchanged = true; return { tokens: { refresh_token: 'sensitive-refresh-token' } }; } }),
  });
  t.after(() => app.close());
  const state = signOAuthState('google_calendar_oauth', { organizationId: 'org-1', userId: 'user-1' });
  const nonce = verifyOAuthState('google_calendar_oauth', state).nonce;
  const response = await app.inject({
    method: 'GET',
    url: `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    headers: { cookie: `${oauthStateCookieName('google_calendar_oauth')}=${nonce}` },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(written, false);
  assert.equal(exchanged, false, 'refused before the authorization code is exchanged');
});

test('the OAuth callback enforces the organization MFA requirement before the token exchange', async (t) => {
  let written = false;
  let exchanged = false;
  let checkedUser;
  const app = await buildApp({
    user: { findFirst: async () => ({ id: 'user-1' }) },
    googleCalendarConnection: {
      findFirst: async () => null,
      create: async () => { written = true; },
      update: async () => { written = true; },
    },
  }, {
    googleClientId: 'client-1', googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://hub.example/api/google-calendar/oauth/callback',
    encryptSecret: (value) => `encrypted:${value}`,
    isMfaEnrollmentRequired: async (userId) => { checkedUser = userId; return true; },
    createOAuthClient: () => ({ getToken: async () => { exchanged = true; return { tokens: { refresh_token: 'sensitive-refresh-token' } }; } }),
  });
  t.after(() => app.close());
  const state = signOAuthState('google_calendar_oauth', { organizationId: 'org-1', userId: 'user-1' });
  const nonce = verifyOAuthState('google_calendar_oauth', state).nonce;
  const response = await app.inject({
    method: 'GET',
    url: `/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    headers: { cookie: `${oauthStateCookieName('google_calendar_oauth')}=${nonce}` },
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/settings?googleCalendar=error&code=MFA_ENROLLMENT_REQUIRED');
  assert.equal(checkedUser, 'user-1');
  assert.equal(exchanged, false);
  assert.equal(written, false);
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
