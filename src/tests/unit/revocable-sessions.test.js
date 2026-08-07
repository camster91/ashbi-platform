import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { isCurrentUserSession, revokeUserSessions, sessionCookieMaxAge, signUserSession } from '../../auth/session.js';

function fakePrisma(user) {
  return {
    user: {
      findUnique: async ({ where }) => where.id === user.id ? user : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, user.id);
        user.sessionVersion += data.sessionVersion.increment;
        return user;
      },
    },
  };
}

describe('revocable user sessions', () => {
  it('keeps cookie and JWT duration configuration aligned', () => {
    assert.equal(sessionCookieMaxAge('7d'), 604800);
    assert.equal(sessionCookieMaxAge('12h'), 43200);
    assert.throws(() => sessionCookieMaxAge('forever'), /JWT_EXPIRES_IN/);
  });

  it('issues bounded tokens carrying the current session version', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-at-least-32-characters' });
    const user = {
      id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN',
      clientId: null, organizationId: 'org-1', sessionVersion: 3,
    };

    const token = signUserSession(app.jwt, user);
    const payload = app.jwt.verify(token);
    assert.equal(payload.sessionVersion, 3);
    assert.ok(payload.exp > payload.iat);
    await app.close();
  });

  it('rejects legacy, revoked, inactive, and expired sessions', async () => {
    const user = { id: 'user-1', isActive: true, sessionVersion: 1 };
    const prisma = fakePrisma(user);

    assert.equal(await isCurrentUserSession(prisma, { id: user.id }), false);
    assert.equal(await isCurrentUserSession(prisma, { id: user.id, sessionVersion: 1 }), true);
    await revokeUserSessions(prisma, user.id);
    assert.equal(await isCurrentUserSession(prisma, { id: user.id, sessionVersion: 1 }), false);
    user.isActive = false;
    assert.equal(await isCurrentUserSession(prisma, { id: user.id, sessionVersion: 2 }), false);

    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-at-least-32-characters' });
    const expired = app.jwt.sign({ id: user.id, sessionVersion: 2 }, { expiresIn: -1 });
    assert.throws(() => app.jwt.verify(expired));
    await app.close();
  });

  it('leaves separately bounded capability and bot tokens outside user revocation', async () => {
    const prisma = fakePrisma({ id: 'user-1', isActive: true, sessionVersion: 0 });
    assert.equal(await isCurrentUserSession(prisma, { contactId: 'contact-1', role: 'CLIENT' }), true);
    assert.equal(await isCurrentUserSession(prisma, { id: 'bot-1', role: 'BOT' }), true);
  });
});
