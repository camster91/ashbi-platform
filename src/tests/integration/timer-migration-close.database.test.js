import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Migration 20260927040000 closes duplicate running timers left by the old
// non-atomic start. A duplicate closed under a full minute records 0 minutes,
// like any timer stopped under a minute (Codex P2 on #480), so it never
// counts as legacy time. The migration's own UPDATE runs on a temporary copy
// of time_sessions (the live table cannot hold two running timers any more).
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

function closeDuplicatesSql(table) {
  const sql = readFileSync(new URL('../../../prisma/migrations/20260927040000_timer_time_entries/migration.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('WITH ranked AS');
  return sql.slice(start, sql.indexOf(';', start)).replaceAll('"time_sessions"', table);
}

test('duplicate running timers closed by the migration record whole minutes only', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "ts_copy" (LIKE "time_sessions" INCLUDING DEFAULTS) ON COMMIT DROP');
      const t0 = Date.UTC(2026, 8, 1, 9, 0, 0);
      const insert = (id, user, offsetSeconds) => tx.$executeRawUnsafe(
        `INSERT INTO "ts_copy" ("id", "userId", "projectId", "startTime", "duration", "billable", "isRunning", "createdAt", "updatedAt")
         VALUES ($1, $2, 'p', $3, 0, true, true, now(), now())`,
        id, user, new Date(t0 + offsetSeconds * 1000),
      );
      // User a: 45 s apart (sub-minute), then 150 s apart (2.5 -> 3 minutes).
      await insert('a1', 'user-a', 0);
      await insert('a2', 'user-a', 45);
      await insert('a3', 'user-a', 195);
      // User b: a single running timer is left alone.
      await insert('b1', 'user-b', 0);
      await tx.$executeRawUnsafe(closeDuplicatesSql('"ts_copy"'));
      return tx.$queryRawUnsafe('SELECT "id", "duration", "isRunning" FROM "ts_copy" ORDER BY "id"');
    });
    assert.deepEqual(rows.map((r) => [r.id, r.duration, r.isRunning]), [
      ['a1', 0, false],
      ['a2', 3, false],
      ['a3', 0, true],
      ['b1', 0, true],
    ]);
  } finally {
    await raw.$disconnect();
  }
});
