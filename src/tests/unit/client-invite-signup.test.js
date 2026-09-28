import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { default: authRoutes } = await import('../../routes/auth.routes.js');

const future = () => new Date(Date.now() + 86_400_000);

/**
 * In-memory Prisma double. `$transaction` snapshots the stores and restores
 * them if the callback throws, like a database rollback; `updateMany` is an
 * atomic check-and-set on the invitation.
 */
async function buildApp(t, { invitation, contacts = [], existingUser = null, failContactCreate = false }) {
  const db = {
    invitation: invitation ? { ...invitation } : null,
    users: [],
    contacts: contacts.map((c) => ({ ...c })),
  };
  const snapshot = () => ({ invitation: db.invitation && { ...db.invitation }, users: [...db.users], contacts: [...db.contacts] });
  const restore = (state) => Object.assign(db, state);

  const models = {
    clientInvitation: {
      findUnique: async ({ where, include }) => {
        if (!db.invitation || where.token !== db.invitation.token) return null;
        assert.ok(include?.client, 'signup must load the invited client to derive its organization');
        return { ...db.invitation };
      },
      updateMany: async ({ where, data }) => {
        if (!db.invitation || db.invitation.id !== where.id || db.invitation.usedAt !== where.usedAt) return { count: 0 };
        Object.assign(db.invitation, data);
        return { count: 1 };
      },
    },
    user: {
      findUnique: async () => existingUser,
      findFirst: async ({ where }) => db.users.find((u) => u.email === where.email && u.role === where.role) ?? null,
      create: async ({ data }) => {
        await new Promise((resolve) => setImmediate(resolve));
        const user = { id: `user-${db.users.length + 1}`, sessionVersion: 0, ...data };
        db.users.push(user);
        return user;
      },
    },
    contact: {
      findFirst: async ({ where }) => db.contacts.find((c) => c.clientId === where.clientId
        && c.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
      create: async ({ data }) => {
        if (failContactCreate) throw new Error('contact insert failed');
        const contact = { id: `contact-${db.contacts.length + 1}`, ...data };
        db.contacts.push(contact);
        return contact;
      },
    },
  };
  const prisma = {
    ...models,
    $transaction: async (callback) => {
      const before = snapshot();
      try {
        return await callback(models);
      } catch (error) {
        restore(before);
        throw error;
      }
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
  return { app, db };
}

const invite = (overrides = {}) => ({
  id: 'invite-1',
  token: 'invite-token',
  email: 'Olivia@Northwind.example',
  clientId: 'client-1',
  client: { id: 'client-1', name: 'Northwind', organizationId: 'org-1', status: 'ACTIVE', deletedAt: null },
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
    const { app, db } = await buildApp(t, {
      invitation: invite(),
      contacts: [{ id: 'contact-olivia', clientId: 'client-1', email: 'olivia@northwind.example' }],
    });
    const res = await signup(app, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(db.users[0].organizationId, 'org-1');
    assert.equal(db.users[0].clientId, 'client-1');
    assert.equal(db.users[0].role, 'CLIENT');
    assert.equal(db.contacts.length, 1, 'existing contact is reused');
    assert.ok(db.invitation.usedAt instanceof Date);
    const cookie = res.cookies.find((c) => c.name === 'token');
    const claims = app.jwt.decode(cookie.value);
    assert.equal(claims.contactId, 'contact-olivia');
    assert.equal(claims.organizationId, 'org-1');
  });

  it('adds the invited address as a contact when the client has none for it', async (t) => {
    const { app, db } = await buildApp(t, { invitation: invite() });
    const res = await signup(app, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(
      { email: db.contacts[0].email, clientId: db.contacts[0].clientId },
      { email: 'olivia@northwind.example', clientId: 'client-1' },
    );
  });

  it('a concurrent double submit creates exactly one user; the loser gets 409', async (t) => {
    const { app, db } = await buildApp(t, { invitation: invite() });
    const [first, second] = await Promise.all([signup(app, {}), signup(app, {})]);
    const statuses = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    assert.match(loser.json().error, /already used/i);
    assert.equal(db.users.length, 1);
  });

  it('rolls everything back when the contact cannot be saved, leaving the invitation usable', async (t) => {
    const { app, db } = await buildApp(t, { invitation: invite(), failContactCreate: true });
    const res = await signup(app, {});
    assert.equal(res.statusCode, 500);
    assert.equal(db.users.length, 0);
    assert.equal(db.contacts.length, 0);
    assert.equal(db.invitation.usedAt, null);
  });

  it('rejects unknown, used, expired, mismatched and inactive-client invitations without creating users', async (t) => {
    const cases = [
      [null, {}, 404],
      [invite({ usedAt: new Date() }), {}, 409],
      [invite({ expiresAt: new Date(Date.now() - 1000) }), {}, 400],
      [invite(), { email: 'someone-else@example.com' }, 400],
      [invite({ client: { id: 'client-1', organizationId: 'org-1', status: 'INACTIVE', deletedAt: null } }), {}, 400],
      [invite({ client: { id: 'client-1', organizationId: 'org-1', status: 'ACTIVE', deletedAt: new Date() } }), {}, 400],
    ];
    for (const [invitation, payload, status] of cases) {
      const { app, db } = await buildApp(t, { invitation });
      const res = await signup(app, payload);
      assert.equal(res.statusCode, status, res.body);
      assert.equal(db.users.length, 0);
    }
  });

  it('client login matches a mixed-case invited address to the stored lower-case account', async (t) => {
    const { app } = await buildApp(t, { invitation: invite() });
    assert.equal((await signup(app, { email: 'Olivia@Northwind.Example' })).statusCode, 200);
    const res = await app.inject({
      method: 'POST',
      url: '/client/login',
      payload: { email: 'OLIVIA@northwind.EXAMPLE', password: 'Str0ng!Passphrase' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().user.email, 'olivia@northwind.example');
  });
});
