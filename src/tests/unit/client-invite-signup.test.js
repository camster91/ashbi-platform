import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { default: authRoutes } = await import('../../routes/auth.routes.js');

const future = () => new Date(Date.now() + 86_400_000);

async function buildApp(t, { invitation, contacts = [], existingUser = null }) {
  const created = { users: [], contacts: [], usedInvites: [] };
  const prisma = {
    clientInvitation: {
      findUnique: async ({ where, include }) => {
        if (!invitation || where.token !== invitation.token) return null;
        assert.ok(include?.client, 'signup must load the invited client to derive its organization');
        return invitation;
      },
      update: async ({ where, data }) => { created.usedInvites.push({ id: where.id, ...data }); return {}; },
    },
    user: {
      findUnique: async () => existingUser,
      create: async ({ data }) => {
        const user = { id: `user-${created.users.length + 1}`, sessionVersion: 0, ...data };
        created.users.push(user);
        return user;
      },
    },
    contact: {
      findFirst: async ({ where }) => contacts.find((c) => c.clientId === where.clientId
        && c.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
      create: async ({ data }) => {
        const contact = { id: `contact-${created.contacts.length + 1}`, ...data };
        created.contacts.push(contact);
        return contact;
      },
    },
  };
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(rateLimit, { global: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET });
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async () => {});
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(authRoutes);
  t.after(() => app.close());
  return { app, created };
}

const invite = (overrides = {}) => ({
  id: 'invite-1',
  token: 'invite-token',
  email: 'Olivia@Northwind.example',
  clientId: 'client-1',
  client: { id: 'client-1', name: 'Northwind', organizationId: 'org-1' },
  expiresAt: future(),
  usedAt: null,
  ...overrides,
});

const signup = (app, payload) => app.inject({
  method: 'POST',
  url: '/client/signup',
  payload: { token: 'invite-token', email: 'olivia@northwind.example', password: 'Str0ng!Passphrase', ...payload },
});

describe('client invitation signup', () => {
  it('creates the client user in the invited client\'s organization and signs a portal session', async (t) => {
    const { app, created } = await buildApp(t, {
      invitation: invite(),
      contacts: [{ id: 'contact-olivia', clientId: 'client-1', email: 'olivia@northwind.example' }],
    });
    const res = await signup(app, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(created.users[0].organizationId, 'org-1');
    assert.equal(created.users[0].clientId, 'client-1');
    assert.equal(created.users[0].role, 'CLIENT');
    assert.equal(created.contacts.length, 0, 'existing contact is reused');
    assert.equal(created.usedInvites[0].id, 'invite-1');
    const cookie = res.cookies.find((c) => c.name === 'token');
    const claims = app.jwt.decode(cookie.value);
    assert.equal(claims.contactId, 'contact-olivia');
    assert.equal(claims.organizationId, 'org-1');
  });

  it('adds the invited address as a contact when the client has none for it', async (t) => {
    const { app, created } = await buildApp(t, { invitation: invite() });
    const res = await signup(app, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(
      { email: created.contacts[0].email, clientId: created.contacts[0].clientId },
      { email: 'olivia@northwind.example', clientId: 'client-1' },
    );
  });

  it('rejects unknown, used, expired and mismatched invitations without creating users', async (t) => {
    const cases = [
      [null, {}, 404],
      [invite({ usedAt: new Date() }), {}, 400],
      [invite({ expiresAt: new Date(Date.now() - 1000) }), {}, 400],
      [invite(), { email: 'someone-else@example.com' }, 400],
    ];
    for (const [invitation, payload, status] of cases) {
      const { app, created } = await buildApp(t, { invitation });
      const res = await signup(app, payload);
      assert.equal(res.statusCode, status, res.body);
      assert.equal(created.users.length, 0);
    }
  });
});
