// S1: the estimate token rotation in the 20260927050500 migration must not
// strand SENT estimates. Runs the migration's UPDATE against fixture rows in
// a transaction that is rolled back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const ROLLBACK = new Error('rollback');

test('rotation gives SENT estimates a fresh token and access window, drafts none', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const migration = readFileSync(new URL('../../../prisma/migrations/20260927050500_estimate_public_access/migration.sql', import.meta.url), 'utf8');
  // Only the UPDATE: the file's own BEGIN/COMMIT must not end this test's
  // transaction (which is rolled back).
  const start = migration.indexOf('UPDATE "estimates"');
  const update = migration.slice(start, migration.indexOf(';', start) + 1);
  assert.doesNotMatch(update, /COMMIT|BEGIN/);
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 8);
  const orgId = `rotation-org-${suffix}`;
  const DAY = 86_400_000;
  try {
    await raw.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: orgId, name: 'Rotation', slug: `rotation-${suffix}` } });
      const client = await tx.client.create({ data: { name: 'Rotation client', organizationId: orgId } });
      const future = new Date(Date.now() + 10 * DAY);
      const rows = {
        sentFuture: { status: 'SENT', validUntil: future },
        sentPast: { status: 'SENT', validUntil: new Date(Date.now() - DAY) },
        sentOpen: { status: 'SENT', validUntil: null },
        draft: { status: 'DRAFT', validUntil: future },
        approved: { status: 'APPROVED', validUntil: future },
      };
      const before = {};
      for (const [name, data] of Object.entries(rows)) {
        const created = await tx.estimate.create({ data: { clientId: client.id, title: name, ...data } });
        before[name] = created;
      }
      await tx.$executeRawUnsafe(update);
      const after = Object.fromEntries(await Promise.all(Object.entries(before).map(async ([name, row]) => [name, await tx.estimate.findUnique({ where: { id: row.id } })])));

      for (const [name, row] of Object.entries(after)) {
        assert.notEqual(row.viewToken, before[name].viewToken, `${name} token rotated`);
        assert.match(row.viewToken, /^[0-9a-f]{64}$/, name);
      }
      assert.equal(after.sentFuture.publicAccessExpiresAt.getTime(), future.getTime());
      for (const name of ['sentPast', 'sentOpen']) {
        const window = after[name].publicAccessExpiresAt.getTime() - Date.now();
        assert.ok(window > 29 * DAY && window <= 30 * DAY + 60_000, `${name} gets a 30-day window`);
      }
      assert.equal(after.draft.publicAccessExpiresAt, null);
      assert.equal(after.approved.publicAccessExpiresAt, null);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  } finally {
    await raw.$disconnect();
  }
});
