// Migration 20261001160000_estimate_tax_rate_brand_unique merges duplicate
// brand_settings rows per organization before making organizationId unique.
// Runs the migration's merge and delete statements against fixture rows in a
// transaction that is rolled back (the unique index is dropped inside it so
// duplicates can be inserted first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const ROLLBACK = new Error('rollback');

test('duplicate brand rows merge into the oldest, keeping the newest set values', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const migration = readFileSync(new URL('../../../prisma/migrations/20261001160000_estimate_tax_rate_brand_unique/migration.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT)\s*;/m, 'no explicit transaction control');
  const start = migration.indexOf('WITH merged AS');
  const end = migration.indexOf('DROP INDEX');
  const statements = migration.slice(start, end).split(/;\s*\n/).map((sql) => sql.trim()).filter(Boolean);
  assert.equal(statements.length, 2, 'the merge UPDATE and the DELETE');

  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 8);
  const orgs = { dup: `brand-dedupe-${suffix}`, solo: `brand-solo-${suffix}` };
  try {
    await raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('DROP INDEX "brand_settings_organizationId_key"');
      for (const id of Object.values(orgs)) {
        await tx.organization.create({ data: { id, name: id, slug: id } });
      }
      // ids sort by age, as cuids do: a = oldest.
      const rows = [
        { id: `${suffix}-a`, organizationId: orgs.dup, companyName: 'Ashbi Design', phone: '111', primaryColor: '#123456' },
        { id: `${suffix}-b`, organizationId: orgs.dup, companyName: 'Edited Co', logoUrl: '/uploads/brand/logo-b.png' },
        { id: `${suffix}-c`, organizationId: orgs.dup, companyName: 'Ashbi Design', phone: '333' },
        { id: `${suffix}-s`, organizationId: orgs.solo, companyName: 'Solo', taxId: 'S-1' },
      ];
      for (const data of rows) await tx.brandSettings.create({ data });

      for (const sql of statements) await tx.$executeRawUnsafe(sql);

      const dup = await tx.brandSettings.findMany({ where: { organizationId: orgs.dup } });
      assert.equal(dup.length, 1);
      assert.equal(dup[0].id, `${suffix}-a`, 'the oldest row is kept');
      assert.equal(dup[0].companyName, 'Edited Co', 'a non-default value beats the default');
      assert.equal(dup[0].logoUrl, '/uploads/brand/logo-b.png');
      assert.equal(dup[0].phone, '333', 'the newest set value wins');
      assert.equal(dup[0].primaryColor, '#123456', 'a non-default color is kept over later defaults');
      const solo = await tx.brandSettings.findMany({ where: { organizationId: orgs.solo } });
      assert.deepEqual(solo.map((row) => [row.id, row.companyName, row.taxId]), [[`${suffix}-s`, 'Solo', 'S-1']]);
      throw ROLLBACK;
    }).catch((error) => { if (error !== ROLLBACK) throw error; });
  } finally {
    await raw.$disconnect();
  }
});
