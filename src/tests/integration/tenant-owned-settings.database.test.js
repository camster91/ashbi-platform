// Brand settings and project references stay inside the caller's
// organization, against a real PostgreSQL schema, the real tenant proxy and
// the real routes:
//
// - GET/PUT /api/brand read and write only the caller's organization's brand
//   (an organization without one gets its own, never another's), and the
//   asset library's brand helpers resolve by organization even on the raw
//   client;
// - POST/PUT /api/projects refuse a client or default owner of another
//   organization.
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const { default: brandRoutes } = await import('../../routes/brand.routes.js');
const { default: projectRoutes } = await import('../../routes/project.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { getBrandSettings, updateBrandSettings } = await import('../../services/assetLibrary.service.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const fixturePassword = () => ['fixture', randomUUID()].join(':');

async function buildApp(raw, users) {
  const app = Fastify({ logger: false });
  const authenticate = async (request, reply) => {
    const user = users[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = user;
    request.prisma = createScopedPrisma(raw, user.organizationId);
    return undefined;
  };
  app.decorate('authenticate', authenticate);
  app.decorate('adminOnly', async (request, reply) => {
    await authenticate(request, reply);
    if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    return undefined;
  });
  // A raw fallback: if a handler still used fastify.prisma for these
  // records, the cross-organization assertions below would catch it.
  app.decorate('prisma', raw);
  await app.register(brandRoutes, { prefix: '/api/brand' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.ready();
  return app;
}

test('brand settings and project references are isolated per organization', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgIds = ['a', 'b', 'c'].map((key) => `brand-iso-${key}-${suffix}`);
  const [orgA, orgB, orgC] = orgIds;
  let app;

  try {
    for (const id of orgIds) {
      await raw.organization.create({ data: { id, name: `Brand isolation ${id}`, slug: id } });
    }
    const adminA = await raw.user.create({ data: { organizationId: orgA, email: `brand-a-${suffix}@example.com`, name: 'Admin A', password: fixturePassword(), role: 'ADMIN' } });
    const adminB = await raw.user.create({ data: { organizationId: orgB, email: `brand-b-${suffix}@example.com`, name: 'Admin B', password: fixturePassword(), role: 'ADMIN' } });
    const adminC = await raw.user.create({ data: { organizationId: orgC, email: `brand-c-${suffix}@example.com`, name: 'Admin C', password: fixturePassword(), role: 'ADMIN' } });
    // Org A's brand row is the oldest in the table, which an unscoped
    // findFirst() would have returned to everyone.
    const brandA = await raw.brandSettings.create({ data: { organizationId: orgA, companyName: 'Alpha Studio', primaryColor: '#111111' } });
    const brandB = await raw.brandSettings.create({ data: { organizationId: orgB, companyName: 'Beta Works', primaryColor: '#222222' } });

    const users = {
      a: { id: adminA.id, role: 'ADMIN', organizationId: orgA, name: 'Admin A' },
      b: { id: adminB.id, role: 'ADMIN', organizationId: orgB, name: 'Admin B' },
      c: { id: adminC.id, role: 'ADMIN', organizationId: orgC, name: 'Admin C' },
    };
    app = await buildApp(raw, users);
    const as = (key, method, url, payload) => app.inject({ method, url, payload, headers: { 'x-test-user': key } });

    // ── Brand settings ────────────────────────────────────────────────────
    const readA = await as('a', 'GET', '/api/brand');
    assert.equal(readA.statusCode, 200, readA.body);
    assert.deepEqual([readA.json().id, readA.json().companyName], [brandA.id, 'Alpha Studio']);
    const readB = await as('b', 'GET', '/api/brand');
    assert.deepEqual([readB.json().id, readB.json().companyName], [brandB.id, 'Beta Works']);

    const writeB = await as('b', 'PUT', '/api/brand', { companyName: 'Beta Renamed', primaryColor: '#abcdef' });
    assert.equal(writeB.statusCode, 200, writeB.body);
    assert.equal(writeB.json().id, brandB.id);
    const afterA = await raw.brandSettings.findUnique({ where: { id: brandA.id } });
    assert.deepEqual([afterA.companyName, afterA.primaryColor], ['Alpha Studio', '#111111'], "org B's save left org A's brand alone");
    assert.equal((await raw.brandSettings.findUnique({ where: { id: brandB.id } })).companyName, 'Beta Renamed');

    // An organization without a brand gets its own row, not org A's, and
    // concurrent first reads create exactly one (unique organizationId +
    // upsert).
    const firstReads = await Promise.all(Array.from({ length: 6 }, () => as('c', 'GET', '/api/brand')));
    for (const response of firstReads) assert.equal(response.statusCode, 200, response.body);
    assert.equal(new Set(firstReads.map((response) => response.json().id)).size, 1);
    assert.equal(await raw.brandSettings.count({ where: { organizationId: orgC } }), 1);
    await assert.rejects(
      raw.brandSettings.create({ data: { organizationId: orgC } }),
      (error) => error?.code === 'P2002',
      'the database refuses a second brand row for an organization',
    );
    const readC = await as('c', 'GET', '/api/brand');
    assert.equal(readC.statusCode, 200, readC.body);
    assert.notEqual(readC.json().id, brandA.id);
    assert.equal(readC.json().organizationId, orgC);
    const writeC = await as('c', 'PUT', '/api/brand', { companyName: 'Gamma Co' });
    assert.equal(writeC.json().id, readC.json().id);
    assert.equal((await raw.brandSettings.count({ where: { organizationId: orgC } })), 1);
    assert.equal((await raw.brandSettings.findUnique({ where: { id: brandA.id } })).companyName, 'Alpha Studio');

    // The asset library's helpers resolve by organization even on the raw
    // (unscoped) client used outside a request.
    assert.equal((await getBrandSettings(orgB)).id, brandB.id);
    const viaService = await updateBrandSettings(orgB, { taxId: 'B-TAX' });
    assert.equal(viaService.id, brandB.id);
    assert.equal((await raw.brandSettings.findUnique({ where: { id: brandA.id } })).taxId, null);

    // ── Project references ────────────────────────────────────────────────
    const clientA = await raw.client.create({ data: { organizationId: orgA, name: 'Client A' } });
    const clientB = await raw.client.create({ data: { organizationId: orgB, name: 'Client B' } });

    const crossClient = await as('a', 'POST', '/api/projects', { name: 'Stolen', clientId: clientB.id, defaultOwnerId: null });
    assert.equal(crossClient.statusCode, 404, crossClient.body);
    const crossOwner = await as('a', 'POST', '/api/projects', { name: 'Borrowed owner', clientId: clientA.id, defaultOwnerId: adminB.id });
    assert.equal(crossOwner.statusCode, 400, crossOwner.body);
    assert.equal(await raw.project.count({ where: { clientId: clientB.id } }), 0);
    assert.equal(await raw.project.count({ where: { clientId: clientA.id } }), 0);

    const created = await as('a', 'POST', '/api/projects', { name: 'Own project', clientId: clientA.id, defaultOwnerId: adminA.id });
    assert.equal(created.statusCode, 201, created.body);
    const project = created.json();
    assert.deepEqual([project.organizationId, project.clientId, project.defaultOwnerId], [orgA, clientA.id, adminA.id]);

    const moveToB = await as('a', 'PUT', `/api/projects/${project.id}`, { clientId: clientB.id });
    assert.equal(moveToB.statusCode, 404, moveToB.body);
    const ownerB = await as('a', 'PUT', `/api/projects/${project.id}`, { defaultOwnerId: adminB.id });
    assert.equal(ownerB.statusCode, 400, ownerB.body);
    const stored = await raw.project.findUnique({ where: { id: project.id } });
    assert.deepEqual([stored.clientId, stored.defaultOwnerId], [clientA.id, adminA.id]);
  } finally {
    await app?.close();
    await raw.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.brandSettings.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await raw.organization.deleteMany({ where: { id: { in: orgIds } } });
    await raw.$disconnect();
  }
});
