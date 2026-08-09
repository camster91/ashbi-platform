import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';

describe('client portal cookie session flow', () => {
  let app;
  let sessionVersion = 2;
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true,
  };
  const contact = { id: 'contact-a', email: user.email, name: user.name, clientId: 'client-a' };
  const client = { id: 'client-a', organizationId: 'org-a', name: 'Example Client' };

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'portal-session-test-secret', cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: {
        findUnique: async ({ where }) => (where.id === user.id ? { ...user, sessionVersion } : null),
        update: async () => ({ ...user, sessionVersion: ++sessionVersion }),
      },
      contact: {
        findFirst: async ({ where }) => (where.id === contact.id && where.clientId === client.id ? contact : null),
        findUnique: async ({ where }) => (where.id === contact.id ? contact : null),
      },
      client: {
        findFirst: async ({ where }) => (where.id === client.id ? client : null),
        findUnique: async ({ where }) => (where.id === client.id ? client : null),
      },
    };
    app.decorate('prisma', prisma);
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    app.addHook('preHandler', async request => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });

  after(async () => app.close());

  it('registers the public API at the frontend path without a duplicated prefix', async () => {
    const correct = await app.inject({ method: 'POST', url: '/api/client-portal/verify-token', payload: { token: 'invalid' } });
    const doubled = await app.inject({ method: 'POST', url: '/api/client-portal/client-portal/verify-token', payload: { token: 'invalid' } });
    assert.equal(correct.statusCode, 401);
    assert.equal(doubled.statusCode, 404);
  });

  it('exchanges a bounded magic token for an httpOnly session and revokes it on logout', async () => {
    const magicToken = app.jwt.sign({
      ...user,
      contactId: contact.id,
      sessionVersion,
    }, { expiresIn: '1h' });
    const verified = await app.inject({
      method: 'POST',
      url: '/api/client-portal/verify-token',
      payload: { token: magicToken },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(Object.hasOwn(verified.json(), 'token'), false);
    const setCookie = verified.headers['set-cookie'];
    assert.match(setCookie, /HttpOnly/i);
    const sessionCookie = setCookie.split(';', 1)[0];

    const me = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { cookie: sessionCookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().client.name, client.name);

    const logout = await app.inject({ method: 'POST', url: '/api/client-portal/logout', headers: { cookie: sessionCookie } });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers['set-cookie'], /Max-Age=0|Expires=/i);

    const revoked = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { cookie: sessionCookie } });
    assert.equal(revoked.statusCode, 401);
  });
});
