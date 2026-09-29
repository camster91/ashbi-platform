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

function linkEntriesSql(sessions, entries) {
  const sql = readFileSync(new URL('../../../prisma/migrations/20260927040000_timer_time_entries/migration.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('WITH stopped AS');
  return sql.slice(start, sql.indexOf(';', start))
    .replaceAll('"time_sessions"', sessions)
    .replaceAll('"time_entries"', entries);
}

test('the migration links pre-existing TIMER entries to their sessions one to one', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const links = await raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "ts_link" (LIKE "time_sessions" INCLUDING DEFAULTS) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "te_link" (LIKE "time_entries" INCLUDING DEFAULTS) ON COMMIT DROP');
      const start = new Date(Date.UTC(2026, 7, 1, 9));
      const session = (id, task, duration) => tx.$executeRawUnsafe(
        `INSERT INTO "ts_link" ("id", "userId", "projectId", "taskId", "startTime", "duration", "billable", "isRunning", "createdAt", "updatedAt")
         VALUES ($1, 'u', 'p', $2, $3, $4, true, false, now(), now())`, id, task, start, duration);
      const entry = (id, task, duration, source = 'TIMER') => tx.$executeRawUnsafe(
        `INSERT INTO "te_link" ("id", "userId", "projectId", "taskId", "date", "duration", "billable", "source", "createdAt", "updatedAt")
         VALUES ($1, 'u', 'p', $2, $3, $4, true, $5, now(), now())`, id, task, start, duration, source);
      // Two identical 30-minute timers (no task) and their two entries: paired 1:1.
      await session('s1', null, 30); await session('s2', null, 30);
      await entry('e1', null, 30); await entry('e2', null, 30);
      // A timer with a task and its entry.
      await session('s3', 't', 45); await entry('e3', 't', 45);
      // A manual entry with the same shape is never linked; a session without an entry stays legacy.
      await entry('m1', 't', 45, 'MANUAL');
      await session('s4', null, 10);
      await tx.$executeRawUnsafe(linkEntriesSql('"ts_link"', '"te_link"'));
      return tx.$queryRawUnsafe('SELECT "id", "timeSessionId" FROM "te_link" ORDER BY "id"');
    });
    assert.deepEqual(links.map((r) => [r.id, r.timeSessionId]), [
      ['e1', 's1'], ['e2', 's2'], ['e3', 's3'], ['m1', null],
    ]);
  } finally {
    await raw.$disconnect();
  }
});

function normaliseSql(table) {
  const sql = readFileSync(new URL('../../../prisma/migrations/20260927040000_timer_time_entries/migration.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('UPDATE "time_sessions"\nSET "isRunning" = false, "updatedAt" = CURRENT_TIMESTAMP');
  assert.ok(start > 0, 'normalisation statement present');
  return sql.slice(start, sql.indexOf(';', start)).replaceAll('"time_sessions"', table);
}

test('ended timers still flagged running are stopped before duplicates are closed', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "ts_stale" (LIKE "time_sessions" INCLUDING DEFAULTS) ON COMMIT DROP');
      const t0 = Date.UTC(2026, 8, 1, 9);
      const insert = (id, offsetMinutes, endMinutes) => tx.$executeRawUnsafe(
        `INSERT INTO "ts_stale" ("id", "userId", "projectId", "startTime", "endTime", "duration", "billable", "isRunning", "createdAt", "updatedAt")
         VALUES ($1, 'u', 'p', $2, $3, $4, true, true, now(), now())`,
        id, new Date(t0 + offsetMinutes * 60_000), endMinutes === null ? null : new Date(t0 + endMinutes * 60_000), endMinutes === null ? 0 : endMinutes - offsetMinutes,
      );
      // Two ended timers left flagged running by the retired routes, then the real running one.
      await insert('old-1', 0, 20);
      await insert('old-2', 30, 50);
      await insert('live', 60, null);
      await tx.$executeRawUnsafe(normaliseSql('"ts_stale"'));
      await tx.$executeRawUnsafe(closeDuplicatesSql('"ts_stale"'));
      return tx.$queryRawUnsafe('SELECT "id", "isRunning", "duration" FROM "ts_stale" ORDER BY "id"');
    });
    assert.deepEqual(rows.map((r) => [r.id, r.isRunning, r.duration]), [
      ['live', true, 0],
      ['old-1', false, 20],
      ['old-2', false, 20],
    ], 'ended timers keep their recorded duration and the real timer stays the only running one');
  } finally {
    await raw.$disconnect();
  }
});
