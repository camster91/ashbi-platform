// Rate cards are scoped to an organization only through their client
// (prisma-tenant-proxy: ratecard -> client). Against a real PostgreSQL schema,
// the real tenant proxy and the real routes:
//
// - POST without a client is a clean 400 (nothing is created);
// - POST and PUT refuse another organization's client;
// - PUT cannot orphan a card by clearing its client (null is a 400), and
//   omitting clientId keeps it, so the card stays reachable.
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const { default: rateCardRoutes } = await import('../../routes/rate-card.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const fixturePassword = () => ['fixture', randomUUID()].join(':');

async function buildApp(raw, users) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request, reply) => {
    const user = users[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = user;
    request.prisma = createScopedPrisma(raw, user.organizationId);
    return undefined;
  });
  app.decorate('prisma', raw);
  await app.register(rateCardRoutes, { prefix: '/api/rate-cards' });
  await app.ready();
  return app;
}

test('a rate card always keeps a client of its own organization', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgIds = ['a', 'b'].map((key) => `ratecard-${key}-${suffix}`);
  const [orgA, orgB] = orgIds;
  let app;

  try {
    for (const id of orgIds) {
      await raw.organization.create({ data: { id, name: `Rate card ${id}`, slug: id } });
    }
    const adminA = await raw.user.create({ data: { organizationId: orgA, email: `rc-a-${suffix}@example.com`, name: 'Admin A', password: fixturePassword(), role: 'ADMIN' } });
    const adminB = await raw.user.create({ data: { organizationId: orgB, email: `rc-b-${suffix}@example.com`, name: 'Admin B', password: fixturePassword(), role: 'ADMIN' } });
    const clientA = await raw.client.create({ data: { organizationId: orgA, name: 'Alpha client' } });
    const clientA2 = await raw.client.create({ data: { organizationId: orgA, name: 'Alpha second client' } });
    const clientB = await raw.client.create({ data: { organizationId: orgB, name: 'Beta client' } });

    const users = {
      a: { id: adminA.id, role: 'ADMIN', organizationId: orgA },
      b: { id: adminB.id, role: 'ADMIN', organizationId: orgB },
    };
    app = await buildApp(raw, users);
    const as = (key, method, url, payload) => app.inject({ method, url, payload, headers: { 'x-test-user': key } });
    const rates = [{ serviceName: 'Design', unit: 'hour', rate: 120, description: '' }];
    const cardCount = () => raw.rateCard.count({ where: { client: { organizationId: { in: orgIds } } } });
    const orphanCount = () => raw.rateCard.count({ where: { name: { contains: suffix }, clientId: null } });

    // POST without a client: a validation 400, not a tenancy error.
    for (const payload of [{ name: `No client ${suffix}`, rates }, { name: `Null client ${suffix}`, clientId: null, rates }]) {
      const res = await as('a', 'POST', '/api/rate-cards', payload);
      assert.equal(res.statusCode, 400, res.body);
      assert.match(res.json().error, /clientId/);
    }
    assert.equal(await orphanCount(), 0);

    // POST for another organization's client is refused.
    const foreign = await as('a', 'POST', '/api/rate-cards', { name: `Foreign ${suffix}`, clientId: clientB.id, rates });
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(await cardCount(), 0);

    const created = await as('a', 'POST', '/api/rate-cards', { name: `Alpha rates ${suffix}`, clientId: clientA.id, rates });
    assert.equal(created.statusCode, 201, created.body);
    const cardId = created.json().id;
    assert.equal(created.json().clientId, clientA.id);

    // PUT cannot orphan the card.
    const cleared = await as('a', 'PUT', `/api/rate-cards/${cardId}`, { name: `Cleared ${suffix}`, clientId: null });
    assert.equal(cleared.statusCode, 400, cleared.body);
    assert.equal((await raw.rateCard.findUnique({ where: { id: cardId } })).clientId, clientA.id);

    // Omitting clientId keeps it; the card stays visible to its organization.
    const renamed = await as('a', 'PUT', `/api/rate-cards/${cardId}`, { name: `Renamed ${suffix}` });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(renamed.json().clientId, clientA.id);
    const list = await as('a', 'GET', '/api/rate-cards');
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(list.json().rateCards.some((card) => card.id === cardId), `the renamed card is still listed: ${list.body}`);

    const forClient = await as('a', 'GET', `/api/rate-cards?clientId=${clientA.id}`);
    assert.deepEqual(forClient.json().rateCards.map((card) => card.id), [cardId]);
    assert.deepEqual((await as('a', 'GET', `/api/rate-cards?clientId=${clientA2.id}`)).json().rateCards, []);

    // Moving to another client of the same organization works; to another
    // organization's client does not.
    const moved = await as('a', 'PUT', `/api/rate-cards/${cardId}`, { clientId: clientA2.id });
    assert.equal(moved.statusCode, 200, moved.body);
    const stolen = await as('a', 'PUT', `/api/rate-cards/${cardId}`, { clientId: clientB.id });
    assert.equal(stolen.statusCode, 404, stolen.body);
    assert.equal((await raw.rateCard.findUnique({ where: { id: cardId } })).clientId, clientA2.id);

    // The other organization cannot see or edit it.
    assert.equal((await as('b', 'GET', `/api/rate-cards/${cardId}`)).statusCode, 404);
    assert.equal((await as('b', 'PUT', `/api/rate-cards/${cardId}`, { name: 'Hijack' })).statusCode, 404);
    assert.equal(await orphanCount(), 0);
  } finally {
    await app?.close();
    await raw.rateCard.deleteMany({ where: { client: { organizationId: { in: orgIds } } } });
    await raw.rateCard.deleteMany({ where: { name: { contains: suffix } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.organization.deleteMany({ where: { id: { in: orgIds } } });
    await raw.$disconnect();
  }
});
