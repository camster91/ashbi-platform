// H1 (security audit at 8687cf9): token-type confusion. Every token signed with
// the session key must carry an explicit type, and only a user session may
// authenticate. OAuth state, magic links, bot tokens, re-authentication and
// MFA challenge tokens, and legacy untyped sessions are refused by every
// session verifier: the /api hook, fastify.authenticate / adminOnly, the
// Socket.IO handshake and the client-portal guard.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { buildApp } from '../../index.js';
import {
  CLIENT_SESSION_TOKEN_TYPE,
  SESSION_TOKEN_TYPE,
  isCurrentUserSession,
  isUserSessionPayload,
  signUserSession,
} from '../../auth/session.js';
import { createSocketAuthMiddleware } from '../../auth/socket-auth.js';
import { signOAuthState, verifyOAuthState } from '../../auth/oauth-state.js';
import { signReauthToken } from '../../auth/reauth.js';
import { createMfaChallenge } from '../../auth/mfa.js';
import { signImpersonationToken } from '../../auth/impersonation.js';
import { magicLinkClaims } from '../../routes/client-portal.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { redactCapabilityUrl } from '../../utils/log-redaction.js';

const SECRET = 'session-token-types-test-secret-0123456789';
process.env.JWT_SECRET ||= SECRET;

const staff = {
  id: 'user-staff', email: 'admin@example.test', name: 'Admin', role: 'ADMIN',
  clientId: null, organizationId: 'org-a', sessionVersion: 4, isActive: true,
};
const portalUser = {
  id: 'user-client', email: 'client@example.test', name: 'Client', role: 'CLIENT',
  clientId: 'client-a', organizationId: 'org-a', sessionVersion: 2, isActive: true,
};
const contact = { id: 'contact-a', email: portalUser.email, name: 'Client', clientId: 'client-a', client: { organizationId: 'org-a' } };

function fakePrisma() {
  const users = new Map([[staff.id, staff], [portalUser.id, portalUser]]);
  return {
    user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
  };
}

async function signer() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.ready();
  return app;
}

/** Every non-session token the codebase signs, as the session key would see it. */
async function nonSessionTokens(app) {
  return {
    // The pre-fix OAuth state shape (same key as sessions, carried an org id).
    legacyGoogleState: app.jwt.sign({ type: 'google_calendar_oauth', organizationId: 'org-a', userId: staff.id }, { expiresIn: '10m' }),
    legacySlackState: app.jwt.sign({ type: 'slack_oauth', organizationId: 'org-a', userId: staff.id }, { expiresIn: '10m' }),
    googleState: signOAuthState('google_calendar_oauth', { organizationId: 'org-a', userId: staff.id }),
    slackState: signOAuthState('slack_oauth', { organizationId: 'org-a', userId: staff.id }),
    magicLink: app.jwt.sign(magicLinkClaims(portalUser, contact), { expiresIn: '1h' }),
    legacyMagicLink: app.jwt.sign({ id: portalUser.id, contactId: contact.id, clientId: 'client-a', organizationId: 'org-a', role: 'CLIENT', sessionVersion: 2 }, { expiresIn: '1h' }),
    botToken: app.jwt.sign({ typ: 'bot_access', id: 'bot', role: 'BOT', email: 'bot@system' }, { expiresIn: '30d' }),
    legacyBotToken: app.jwt.sign({ id: 'bot', role: 'BOT', email: 'bot@system' }, { expiresIn: '30d' }),
    reauth: signReauthToken({ id: staff.id, sessionVersion: staff.sessionVersion, iat: 1 }),
    mfaChallenge: createMfaChallenge(staff),
    // The support-view `imp` cookie token (typ 'impersonation', its own derived key).
    impersonation: signImpersonationToken({
      sessionId: 'view-1', actor: { id: staff.id, organizationId: 'org-a', sessionVersion: staff.sessionVersion, iat: 1 },
      subjectUserId: portalUser.id, expiresAt: new Date(Date.now() + 600_000),
    }),
    // The same claims signed with the session key must still not pass as a session.
    impersonationClaimsOnSessionKey: app.jwt.sign({ typ: 'impersonation', sid: 'view-1', sub: staff.id, org: 'org-a', subj: portalUser.id }, { expiresIn: '10m' }),
    untypedStaffSession: app.jwt.sign({ id: staff.id, role: 'ADMIN', organizationId: 'org-a', sessionVersion: staff.sessionVersion }, { expiresIn: '1h' }),
    clientTypedAsStaff: app.jwt.sign({ ...portalUser, typ: SESSION_TOKEN_TYPE }, { expiresIn: '1h' }),
    staffTypedAsClient: app.jwt.sign({ ...staff, typ: CLIENT_SESSION_TOKEN_TYPE }, { expiresIn: '1h' }),
    noSessionVersion: app.jwt.sign({ id: staff.id, role: 'ADMIN', organizationId: 'org-a', typ: SESSION_TOKEN_TYPE }, { expiresIn: '1h' }),
  };
}

describe('session token types', () => {
  it('session signer labels staff and client sessions, and no claim can relabel them', async () => {
    const app = await signer();
    const staffPayload = app.jwt.verify(signUserSession(app.jwt, staff));
    const clientPayload = app.jwt.verify(signUserSession(app.jwt, portalUser, { contactId: 'contact-a', typ: 'session' }));
    assert.equal(staffPayload.typ, SESSION_TOKEN_TYPE);
    assert.equal(clientPayload.typ, CLIENT_SESSION_TOKEN_TYPE);
    assert.equal(isUserSessionPayload(staffPayload), true);
    assert.equal(isUserSessionPayload(clientPayload), true);
    await app.close();
  });

  it('a normal staff or client session is still current; revocation still applies', async () => {
    const app = await signer();
    const prisma = fakePrisma();
    assert.equal(await isCurrentUserSession(prisma, app.jwt.verify(signUserSession(app.jwt, staff))), true);
    assert.equal(await isCurrentUserSession(prisma, app.jwt.verify(signUserSession(app.jwt, portalUser))), true);
    const stale = app.jwt.verify(signUserSession(app.jwt, { ...staff, sessionVersion: 3 }));
    assert.equal(await isCurrentUserSession(prisma, stale), false);
    await app.close();
  });

  it('every other signed token type is refused by the session check', async () => {
    const app = await signer();
    const prisma = fakePrisma();
    for (const [name, token] of Object.entries(await nonSessionTokens(app))) {
      let payload = null;
      try { payload = app.jwt.verify(token); } catch { payload = null; }
      if (payload === null) continue; // not even a valid session-key signature
      assert.equal(isUserSessionPayload(payload), false, name);
      assert.equal(await isCurrentUserSession(prisma, payload), false, name);
    }
    await app.close();
  });

  it('OAuth state is signed with a derived key and verified only for its own purpose', async () => {
    const app = await signer();
    const state = signOAuthState('google_calendar_oauth', { organizationId: 'org-a', userId: staff.id });
    assert.throws(() => app.jwt.verify(state), 'state must not verify with the session key');
    assert.equal(verifyOAuthState('google_calendar_oauth', state).organizationId, 'org-a');
    assert.equal(verifyOAuthState('slack_oauth', state), null);
    const legacy = app.jwt.sign({ type: 'google_calendar_oauth', organizationId: 'org-a', userId: staff.id });
    assert.equal(verifyOAuthState('google_calendar_oauth', legacy), null);
    assert.equal(verifyOAuthState('google_calendar_oauth', signUserSession(app.jwt, staff)), null);
    const expired = signOAuthState('slack_oauth', { organizationId: 'org-a', userId: staff.id }, { nowMs: Date.now() - 3_600_000 });
    assert.equal(verifyOAuthState('slack_oauth', expired), null);
    await app.close();
  });

  it('the Socket.IO handshake accepts sessions only', async () => {
    const app = await signer();
    const middleware = createSocketAuthMiddleware({
      verifyToken: (token) => app.jwt.verify(token),
      parseCookie: () => ({}),
      prisma: fakePrisma(),
    });
    const connect = (token) => new Promise((resolve) => {
      const socket = { handshake: { headers: {}, auth: { token } } };
      middleware(socket, (err) => resolve({ err, socket }));
    });
    for (const [name, token] of Object.entries(await nonSessionTokens(app))) {
      const { err, socket } = await connect(token);
      assert.ok(err, `${name} must not open a socket`);
      assert.equal(socket.userId, undefined, name);
    }
    const ok = await connect(signUserSession(app.jwt, staff));
    assert.equal(ok.err, undefined);
    assert.equal(ok.socket.userId, staff.id);
    await app.close();
  });
});

describe('session verifiers in the assembled API refuse non-session tokens', () => {
  let app;
  let tokens;
  before(async () => {
    app = await buildApp({ initializeRuntime: false, jwtSecret: process.env.JWT_SECRET });
    await app.ready();
    tokens = await nonSessionTokens(app);
  });
  after(async () => app?.close());

  for (const [label, url] of [
    ['fastify.authenticate', '/api/auth/me'],
    ['the /api hook and tenancy', '/api/clients'],
    ['fastify.adminOnly', '/api/slack'],
  ]) {
    it(`${label} (${url})`, async () => {
      for (const [name, token] of Object.entries(tokens)) {
        for (const headers of [{ authorization: `Bearer ${token}` }, { cookie: `token=${token}` }]) {
          const response = await app.inject({ method: 'GET', url, headers });
          assert.equal(response.statusCode, 401, `${name} via ${Object.keys(headers)[0]} on ${url}: ${response.body}`);
        }
      }
    });
  }
});

describe('the client-portal guard accepts client sessions only', () => {
  let app;
  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: SECRET, cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: { findUnique: async ({ where }) => (where.id === portalUser.id ? portalUser : where.id === staff.id ? staff : null) },
      contact: {
        findFirst: async ({ where }) => (where.id === contact.id ? contact : null),
        findUnique: async ({ where }) => (where.id === contact.id ? contact : null),
      },
      client: {
        findFirst: async ({ where }) => (where.id === 'client-a' ? { id: 'client-a', organizationId: 'org-a', name: 'A' } : null),
        findUnique: async ({ where }) => (where.id === 'client-a' ? { id: 'client-a', organizationId: 'org-a', name: 'A' } : null),
      },
    };
    app.decorate('prisma', prisma);
    app.addHook('preHandler', async (request) => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });
  after(async () => app?.close());

  it('refuses magic links, staff sessions and other tokens as portal bearers', async () => {
    const tokens = await nonSessionTokens(app);
    tokens.staffSession = signUserSession(app.jwt, staff, { contactId: contact.id, clientId: 'client-a' });
    for (const [name, token] of Object.entries(tokens)) {
      const response = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 401, name);
    }
    const session = signUserSession(app.jwt, portalUser, { contactId: contact.id });
    const ok = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { authorization: `Bearer ${session}` } });
    assert.equal(ok.statusCode, 200, ok.body);
  });
});

describe('request logs redact OAuth callback state and code', () => {
  it('masks state and code query parameters', () => {
    const url = '/api/google-calendar/oauth/callback?code=4/0AbCdEf&scope=calendar&state=eyJhbGci.eyJ0eXAi.sig';
    const redacted = redactCapabilityUrl(url);
    assert.doesNotMatch(redacted, /4\/0AbCdEf|eyJhbGci/);
    assert.match(redacted, /code=\[Redacted\]/);
    assert.match(redacted, /state=\[Redacted\]/);
    assert.match(redacted, /scope=calendar/);
    assert.equal(
      redactCapabilityUrl('/api/slack/oauth/callback?state=abc&code=xyz'),
      '/api/slack/oauth/callback?state=[Redacted]&code=[Redacted]',
    );
  });
});
