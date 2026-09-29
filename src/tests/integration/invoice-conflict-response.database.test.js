// A unique-constraint violation inside a real invoice route must reach the
// client as a generic 409 with no Prisma internals (C4). Built with the real
// application (buildApp), so it proves the global error handler actually
// covers the route plugins — not a handler set up by the test.
//
// A test-only trigger, scoped to one sentinel title, rewrites the new
// invoice's number to one that already exists in the organization, so the
// real POST /api/invoices insert raises P2002 after the allocator ran.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database (DATABASE_URL must point at the same database, as
// in CI, because the app uses its own client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildApp } from '../../index.js';
import { signUserSession } from '../../auth/session.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('a unique violation in POST /api/invoices returns a generic 409', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().replace(/-/g, '');
  const org = `conflict-org-${suffix}`;
  const user = `conflict-user-${suffix}`;
  const client = `conflict-client-${suffix}`;
  const sentinel = `p2002-sentinel-${suffix}`;
  const trigger = `test_force_p2002_${suffix}`;
  let app;

  try {
    await raw.organization.create({ data: { id: org, name: 'Conflict', slug: `conflict-${suffix}` } });
    await raw.user.create({ data: { id: user, email: `conflict-${suffix}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: org } });
    await raw.client.create({ data: { id: client, name: 'Client', organizationId: org } });
    await raw.invoice.create({ data: { invoiceNumber: `TAKEN-${suffix}`, clientId: client, createdById: user } });
    await raw.$executeRawUnsafe(`
      CREATE FUNCTION ${trigger}() RETURNS trigger AS $$
      BEGIN NEW."invoiceNumber" := 'TAKEN-${suffix}'; RETURN NEW; END;
      $$ LANGUAGE plpgsql`);
    await raw.$executeRawUnsafe(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON "invoices"
      FOR EACH ROW WHEN (NEW."title" = '${sentinel}') EXECUTE FUNCTION ${trigger}()`);

    app = await buildApp({ initializeRuntime: false, jwtSecret: 'conflict-test-secret' });
    const stored = await raw.user.findUnique({ where: { id: user } });
    // A real, typed staff session exactly as login issues it.
    const token = signUserSession(app.jwt, stored);
    const response = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { authorization: `Bearer ${token}` },
      payload: { clientId: client, title: sentinel, lineItems: [{ description: 'Work', quantity: 1, unitPrice: 10 }] },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.doesNotMatch(response.body, /prisma|invoiceNumber|Unique constraint|invocation/i);
  } finally {
    await app?.close();
    await raw.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "invoices"`).catch(() => null);
    await raw.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`).catch(() => null);
    await raw.invoiceLineItem.deleteMany({ where: { invoice: { clientId: client } } });
    await raw.invoice.deleteMany({ where: { clientId: client } });
    await raw.$executeRawUnsafe('DELETE FROM "document_number_sequences" WHERE "organizationId" = $1', org).catch(() => null);
    await raw.client.deleteMany({ where: { id: client } });
    await raw.user.deleteMany({ where: { id: user } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
});
