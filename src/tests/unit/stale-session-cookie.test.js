// B1 (review of the security batch): after the typed-session release, a
// browser still holding an old (untyped) `token` cookie must not be locked
// out. A token that is not a current session makes the request anonymous,
// public routes answer as for any anonymous caller, and every such response
// clears the stale cookie.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// No database: routes that reach it fail with a 500, which is still "not a
// 401 caused by the cookie". tests/integration/stale-session-cookie covers the
// same routes against a real database.
process.env.DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/unreachable?connect_timeout=1';
process.env.WEBHOOK_SECRET ||= 'stale-cookie-webhook-secret';

const { buildApp } = await import('../../index.js');

const SECRET = 'stale-session-cookie-test-secret-0123456789';

function clearsSessionCookie(response) {
  const header = [].concat(response.headers['set-cookie'] ?? []);
  return header.some((cookie) => /^token=;/.test(cookie) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(cookie));
}

describe('a stale session cookie never blocks public routes and is cleared', () => {
  let app;
  let cookies;
  before(async () => {
    app = await buildApp({ initializeRuntime: false, jwtSecret: SECRET });
    await app.ready();
    cookies = {
      // Issued before session types existed (still correctly signed).
      untypedStaff: app.jwt.sign({ id: 'user-staff', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0 }, { expiresIn: '7d' }),
      untypedClient: app.jwt.sign({ id: 'user-client', role: 'CLIENT', clientId: 'client-a', contactId: 'contact-a', organizationId: 'org-a', sessionVersion: 0 }, { expiresIn: '7d' }),
      badSignature: `${app.jwt.sign({ id: 'x' })}tampered`,
    };
  });
  after(async () => app?.close());

  const publicRoutes = [
    ['POST', '/api/client-portal/request-access', { email: 'client@example.test' }],
    ['POST', '/api/client-portal/verify-token', 'MAGIC_LINK'],
    ['GET', '/api/estimates/view/some-token'],
    ['POST', '/api/estimates/view/some-token/approve', { action: 'approve' }],
    ['POST', '/api/webhooks/email', { from: 'a@example.test' }],
    ['GET', '/api/portal/review/some-share-token'],
    ['GET', '/api/portal/invoice/some-view-token'],
    ['GET', '/api/proposals/client/some-view-token'],
    ['GET', '/api/invoices/client/some-view-token'],
  ];

  for (const [method, url, payload] of publicRoutes) {
    it(`${method} ${url}`, async () => {
      for (const [name, token] of Object.entries(cookies)) {
        // A well-formed magic link, so a refusal could only come from the cookie.
        const body = payload === 'MAGIC_LINK'
          ? { token: app.jwt.sign({ typ: 'client_magic_link', jti: `jti-${name}`, id: 'user-client', contactId: 'contact-a', clientId: 'client-a', organizationId: 'org-a', role: 'CLIENT', sessionVersion: 0 }, { expiresIn: '1h' }) }
          : payload;
        const response = await app.inject({ method, url, payload: body, headers: { cookie: `token=${token}` } });
        if (url === '/api/webhooks/email') {
          // Refused for its missing signature, not because of the cookie.
          assert.match(response.json().error, /signature|timestamp|configured/i, `${name}: ${response.body}`);
        } else {
          assert.notEqual(response.statusCode, 401, `${name} on ${url}: ${response.body}`);
        }
        if (!url.startsWith('/api/portal/')) {
          // /api/portal is outside the session hook entirely (it never reads the cookie).
          assert.ok(clearsSessionCookie(response), `${name} on ${url} clears the stale cookie`);
        }
      }
    });
  }

  it('guarded staff and portal routes answer 401 and clear the stale cookie', async () => {
    for (const [method, url] of [
      ['GET', '/api/auth/me'], ['GET', '/api/clients'], ['GET', '/api/slack'],
      ['GET', '/api/client-portal/me'], ['POST', '/api/client-portal/logout'],
    ]) {
      for (const [name, token] of Object.entries(cookies)) {
        const response = await app.inject({ method, url, headers: { cookie: `token=${token}` } });
        assert.ok([401, 403].includes(response.statusCode), `${name} on ${url}: ${response.statusCode}`);
        assert.ok(clearsSessionCookie(response), `${name} on ${url} clears the stale cookie`);
      }
    }
  });

  it('a stale bearer header does not clear an unrelated cookie', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: { authorization: `Bearer ${cookies.untypedStaff}`, cookie: 'token=whatever' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(clearsSessionCookie(response), false);
  });
});

describe('the support-view hook never restores a stale session', () => {
  it('leaves request.user empty when the admin session behind an imp cookie is not current', async () => {
    const { createImpersonationHook, IMPERSONATION_COOKIE } = await import('../../auth/impersonation.js');
    const hook = createImpersonationHook({ prisma: {}, isCurrentUserSession: async () => false });
    const cleared = [];
    const request = {
      url: '/api/clients',
      cookies: { [IMPERSONATION_COOKIE]: 'x', token: 'stale' },
      user: null,
      async jwtVerify() { this.user = { id: 'someone', organizationId: 'org-a', role: 'ADMIN' }; },
    };
    const reply = { clearCookie: (name) => { cleared.push(name); return reply; } };
    await hook(request, reply);
    assert.equal(request.user, null);
    assert.deepEqual(cleared, [IMPERSONATION_COOKIE]);
  });
});
