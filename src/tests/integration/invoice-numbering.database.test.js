// Real-database proof for per-organization invoice numbering (C4):
// numbers are unique per organization (two organizations both get
// INV-<year>-0001), concurrent creates in one organization receive distinct,
// gap-free sequential numbers from the atomic counter, numbering keeps its
// order past 9999, and a duplicate never surfaces a raw Prisma error.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import invoiceRoutes from '../../routes/invoice.routes.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext, getRequestPrisma } from '../../utils/request-context.js';
import { toClientErrorBody, statusCodeForError } from '../../utils/http-errors.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const CONCURRENT_CREATES = 12;

async function buildApp(raw) {
  const app = Fastify({ logger: false });
  // Production resolves fastify.prisma to the request's scoped client.
  app.decorate('prisma', new Proxy({}, {
    get(_target, prop) {
      const client = getRequestPrisma();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }));
  app.decorate('authenticate', async (request) => {
    request.user = { id: request.headers['x-user'], organizationId: request.headers['x-org'], role: 'ADMIN' };
  });
  app.decorate('adminOnly', app.authenticate);
  app.addHook('preHandler', async (request) => {
    if (!request.user?.organizationId) return;
    const scoped = createScopedPrisma(raw, request.user.organizationId);
    request.prisma = scoped;
    enterRequestContext({ prisma: scoped, organizationId: request.user.organizationId });
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.status(statusCodeForError(error)).send(toClientErrorBody(error));
  });
  await app.register(invoiceRoutes);
  return app;
}

test('invoice numbers are per organization, atomic under concurrency and ordered past 9999', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `numbering-org-a-${suffix}`;
  const orgB = `numbering-org-b-${suffix}`;
  const year = new Date().getUTCFullYear();
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Numbering A', slug: `numbering-a-${suffix}` },
      { id: orgB, name: 'Numbering B', slug: `numbering-b-${suffix}` },
    ] });
    await raw.user.createMany({ data: [
      { id: `user-a-${suffix}`, email: `a-${suffix}@example.test`, name: 'A', password: 'x', role: 'ADMIN', organizationId: orgA },
      { id: `user-b-${suffix}`, email: `b-${suffix}@example.test`, name: 'B', password: 'x', role: 'ADMIN', organizationId: orgB },
    ] });
    await raw.client.createMany({ data: [
      { id: `client-a-${suffix}`, name: 'Client A', organizationId: orgA },
      { id: `client-b-${suffix}`, name: 'Client B', organizationId: orgB },
    ] });
    app = await buildApp(raw);

    const create = (org, client, user) => app.inject({
      method: 'POST',
      url: '/',
      headers: { 'x-org': org, 'x-user': user },
      payload: { clientId: client, dueDate: '2030-01-31', lineItems: [{ description: 'Work', quantity: 1, unitPrice: 100 }] },
    });

    // Organization A's first invoice, then organization B's first invoice:
    // both are number 0001 in their own organization.
    const firstA = await create(orgA, `client-a-${suffix}`, `user-a-${suffix}`);
    assert.equal(firstA.statusCode, 200, firstA.body);
    const firstB = await create(orgB, `client-b-${suffix}`, `user-b-${suffix}`);
    assert.equal(firstB.statusCode, 200, firstB.body);
    assert.equal(firstA.json().invoiceNumber, `INV-${year}-0001`);
    assert.equal(firstB.json().invoiceNumber, `INV-${year}-0001`);
    const storedB = await raw.invoice.findUnique({ where: { id: firstB.json().id } });
    assert.equal(storedB.organizationId, orgB, 'the invoice records its organization');

    // N concurrent creates in organization A: all succeed with distinct,
    // consecutive numbers.
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_CREATES }, () => create(orgA, `client-a-${suffix}`, `user-a-${suffix}`)),
    );
    for (const response of responses) assert.equal(response.statusCode, 200, response.body);
    const numbers = responses.map((response) => response.json().invoiceNumber).sort();
    assert.equal(new Set(numbers).size, CONCURRENT_CREATES, 'no duplicate numbers');
    const sequence = numbers.map((number) => Number(number.split('-').pop())).sort((a, b) => a - b);
    assert.deepEqual(sequence, Array.from({ length: CONCURRENT_CREATES }, (_, index) => index + 2));

    // Past 9999 the numeric counter keeps counting (no lexical max()).
    await raw.$executeRawUnsafe(
      'UPDATE "document_number_sequences" SET "lastValue" = 9998 WHERE "organizationId" = $1 AND "kind" = $2 AND "period" = $3',
      orgA, 'INVOICE', year,
    );
    const n9999 = await create(orgA, `client-a-${suffix}`, `user-a-${suffix}`);
    const n10000 = await create(orgA, `client-a-${suffix}`, `user-a-${suffix}`);
    const n10001 = await create(orgA, `client-a-${suffix}`, `user-a-${suffix}`);
    assert.deepEqual([n9999, n10000, n10001].map((response) => response.json().invoiceNumber), [
      `INV-${year}-9999`, `INV-${year}-10000`, `INV-${year}-10001`,
    ]);

    // A number already taken (e.g. an imported invoice) is skipped rather
    // than failing the create.
    await raw.invoice.create({ data: {
      invoiceNumber: `INV-${year}-10002`, clientId: `client-a-${suffix}`, organizationId: orgA, createdById: `user-a-${suffix}`,
    } });
    const skipped = await create(orgA, `client-a-${suffix}`, `user-a-${suffix}`);
    assert.equal(skipped.statusCode, 200, skipped.body);
    assert.equal(skipped.json().invoiceNumber, `INV-${year}-10003`);

    // The database still forbids a duplicate within one organization, and a
    // raw unique violation maps to a generic 409 without Prisma internals.
    const duplicate = await raw.invoice.create({ data: {
      invoiceNumber: `INV-${year}-0001`, clientId: `client-a-${suffix}`, organizationId: orgA, createdById: `user-a-${suffix}`,
    } }).catch((error) => error);
    assert.equal(duplicate?.code, 'P2002');
    assert.equal(statusCodeForError(duplicate), 409);
    const body = toClientErrorBody(duplicate);
    assert.equal(body.statusCode, 409);
    assert.doesNotMatch(JSON.stringify(body), /prisma|invoiceNumber|Unique constraint|invocation/i);

    // The organization is derived from the client even when a writer omits
    // it (database trigger), so per-organization uniqueness cannot be dodged.
    const legacy = await raw.invoice.create({ data: {
      invoiceNumber: `LEGACY-${suffix}`, clientId: `client-b-${suffix}`, createdById: `user-b-${suffix}`,
    } });
    assert.equal(legacy.organizationId, orgB);
  } finally {
    await app?.close();
    const orgs = [orgA, orgB];
    await raw.invoiceLineItem.deleteMany({ where: { invoice: { client: { organizationId: { in: orgs } } } } });
    await raw.invoice.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
    await raw.$executeRawUnsafe('DELETE FROM "document_number_sequences" WHERE "organizationId" = ANY($1::text[])', orgs).catch(() => null);
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
