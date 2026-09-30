import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  checkAllEscalations,
  checkThreadEscalation,
  currentEscalationLevel,
  runForEachOrganization,
} from '../../jobs/escalation.js';

const SLA = { CRITICAL: 2, HIGH: 12, NORMAL: 24, LOW: 48 };
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-27T00:00:00.000Z');

function matches(row, where) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('lt' in condition) return value < condition.lt;
      throw new Error(`unsupported filter ${key}`);
    }
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    return value === condition;
  });
}

/** Records `to(room).emit(event, payload)` calls in order. */
function fakeEmitter() {
  const emits = [];
  return { emits, to: (room) => ({ emit: (event, payload) => { emits.push({ room, event, payload }); return true; } }) };
}

function fakePrisma(threads) {
  const notifications = [];
  let sequence = 0;
  const rows = threads.map((thread) => ({
    status: 'AWAITING_RESPONSE',
    priority: 'NORMAL',
    slaBreached: false,
    lastEscalationLevel: 0,
    lastEscalatedAt: null,
    assignedToId: 'assignee',
    ...thread,
  }));
  const prisma = {
    notifications,
    rows,
    // Interactive transaction with rollback: restore rows and notifications
    // when the callback throws, like Postgres would.
    $transaction: async (callback) => {
      const rowSnapshot = rows.map((row) => ({ ...row }));
      const notificationCount = notifications.length;
      try {
        return await callback(prisma);
      } catch (error) {
        rows.splice(0, rows.length, ...rowSnapshot);
        notifications.splice(notificationCount);
        throw error;
      }
    },
    thread: {
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      findUnique: async ({ where }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
    },
    user: { findMany: async () => [{ id: 'admin-1' }, { id: 'admin-2' }] },
    notification: {
      createManyAndReturn: async ({ data }) => {
        const created = data.map((row) => ({ id: `n${++sequence}`, createdAt: new Date(T0), read: false, ...row }));
        notifications.push(...created);
        return created.map((row) => ({ ...row }));
      },
    },
  };
  return prisma;
}

const at = (hours) => new Date(T0 + hours * HOUR);

test('each escalation level notifies once per thread across repeated 15-minute sweeps', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  // 4h..8h: the assignee gets exactly one SLA_WARNING over 16 sweeps.
  for (let minutes = 4 * 60; minutes < 8 * 60; minutes += 15) {
    await checkAllEscalations({ prisma, slaDefaults: SLA, now: new Date(T0 + minutes * 60_000) });
  }
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['SLA_WARNING']);

  // 8h..23h: one ESCALATION per admin, not one per sweep.
  for (let minutes = 8 * 60; minutes < 23 * 60; minutes += 15) {
    await checkAllEscalations({ prisma, slaDefaults: SLA, now: new Date(T0 + minutes * 60_000) });
  }
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['SLA_WARNING', 'ESCALATION', 'ESCALATION']);

  // Past the 24h SLA: one breach notification per admin, then the thread leaves the sweep.
  for (let minutes = 24 * 60; minutes < 26 * 60; minutes += 15) {
    await checkAllEscalations({ prisma, slaDefaults: SLA, now: new Date(T0 + minutes * 60_000) });
  }
  assert.equal(prisma.notifications.filter((n) => n.type === 'SLA_BREACH').length, 2);
  assert.equal(prisma.notifications.length, 5);
});

test('the per-thread delayed check and the sweep share the dedupe marker', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(9) });
  await checkAllEscalations({ prisma, slaDefaults: SLA, now: at(9.25) });
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(9.5) });
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['ESCALATION', 'ESCALATION']);
  assert.equal(prisma.rows[0].lastEscalationLevel, 2);
});

test('concurrent checks of the same thread notify once', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  const snapshot = await prisma.thread.findUnique({ where: { id: 't1' } });
  await Promise.all([
    checkThreadEscalation('t1', { prisma, slaDefaults: SLA, existingThread: { ...snapshot }, now: at(5) }),
    checkThreadEscalation('t1', { prisma, slaDefaults: SLA, existingThread: { ...snapshot }, now: at(5) }),
  ]);
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['SLA_WARNING']);
});

test('new activity (a response) starts a fresh escalation cycle', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  await checkAllEscalations({ prisma, slaDefaults: SLA, now: at(5) });
  assert.equal(prisma.notifications.length, 1);

  // Client writes again at 6h: the clock restarts and so does the level.
  prisma.rows[0].lastActivityAt = at(6);
  assert.equal(currentEscalationLevel(prisma.rows[0]), 0);
  await checkAllEscalations({ prisma, slaDefaults: SLA, now: at(10.5) });
  await checkAllEscalations({ prisma, slaDefaults: SLA, now: at(10.75) });
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['SLA_WARNING', 'SLA_WARNING']);
});

test('one failing thread does not stop the sweep for the others', async () => {
  const prisma = fakePrisma([
    { id: 'bad', subject: 'Bad', lastActivityAt: at(0) },
    { id: 'good', subject: 'Good', lastActivityAt: at(0) },
  ]);
  const updateMany = prisma.thread.updateMany;
  prisma.thread.updateMany = async (args) => {
    if (args.where.id === 'bad') throw new Error('row lock timeout');
    return updateMany(args);
  };
  const errors = [];
  const result = await checkAllEscalations({
    prisma,
    slaDefaults: SLA,
    now: at(5),
    logger: { error: (meta) => errors.push(meta.threadId) },
  });
  assert.deepEqual(result, { checked: 2, escalated: 1, failed: 1 });
  assert.deepEqual(errors, ['bad']);
});

test('one failing organization does not abort the others; the job still fails for retry', async () => {
  const seen = [];
  const reported = [];
  await assert.rejects(
    runForEachOrganization(['org-a', 'org-b', 'org-c'], async (organizationId) => {
      seen.push(organizationId);
      if (organizationId === 'org-b') throw new Error('tenant database error');
      return { checked: 1 };
    }, { logger: { error() {} }, onError: (_error, organizationId) => reported.push(organizationId) }),
    (error) => {
      assert.deepEqual(error.failedOrganizationIds, ['org-b']);
      assert.deepEqual(error.organizations.map((entry) => entry.organizationId), ['org-a', 'org-c']);
      return true;
    },
  );
  assert.deepEqual(seen, ['org-a', 'org-b', 'org-c']);
  assert.deepEqual(reported, ['org-b']);

  const ok = await runForEachOrganization(['org-a'], async () => ({ checked: 0 }));
  assert.deepEqual(ok, { organizations: [{ organizationId: 'org-a', checked: 0 }] });
});

test('schema, migration and response route carry the escalation marker', () => {
  const schema = fs.readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /lastEscalationLevel\s+Int\s+@default\(0\)/);
  assert.match(schema, /lastEscalatedAt\s+DateTime\?/);
  const migration = fs.readFileSync(
    new URL('../../../prisma/migrations/20260927045000_thread_escalation_dedupe/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN "lastEscalationLevel"/);
  const responses = fs.readFileSync(new URL('../../routes/response.routes.js', import.meta.url), 'utf8');
  assert.match(responses, /lastEscalationLevel: 0/);
  const worker = fs.readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /runForEachOrganization\(/);
});

test('a claim from a stale snapshot loses when the marker moved since it was read', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0), lastEscalationLevel: 1, lastEscalatedAt: at(5) }]);
  const stale = await prisma.thread.findUnique({ where: { id: 't1' } });
  // After this snapshot the client wrote again (new cycle) and another check
  // already sent that cycle's warning; the stale ESCALATION must not fire.
  prisma.rows[0].lastActivityAt = at(6);
  prisma.rows[0].lastEscalationLevel = 1;
  prisma.rows[0].lastEscalatedAt = at(8.5);
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, existingThread: stale, now: at(9) });
  assert.deepEqual(prisma.notifications, []);
  assert.equal(prisma.rows[0].lastEscalatedAt.getTime(), at(8.5).getTime());
});

test('a failed notification fan-out rolls the claim back so a retry still sends', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  const createMany = prisma.notification.createManyAndReturn;
  prisma.notification.createManyAndReturn = async () => { throw new Error('connection reset'); };
  const emitter = fakeEmitter();

  await assert.rejects(checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25), emitter }), /connection reset/);
  assert.equal(prisma.rows[0].lastEscalationLevel, 0, 'ESCALATION level not claimed');
  assert.equal(prisma.rows[0].lastEscalatedAt, null);
  assert.equal(prisma.rows[0].slaBreached, false, 'SLA breach marker not claimed');
  assert.deepEqual(prisma.notifications, []);
  assert.deepEqual(emitter.emits, [], 'a rolled-back fan-out is never announced');

  prisma.notification.createManyAndReturn = createMany;
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25.25) });
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['ESCALATION', 'ESCALATION', 'SLA_BREACH', 'SLA_BREACH']);
  assert.equal(prisma.rows[0].lastEscalationLevel, 2);
  assert.equal(prisma.rows[0].slaBreached, true);
});

test('with no active admin the admin levels stay unclaimed until one is active', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  const findAdmins = prisma.user.findMany;
  prisma.user.findMany = async () => [];

  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25) });
  assert.equal(prisma.rows[0].lastEscalationLevel, 0, 'ESCALATION not claimed with no recipient');
  assert.equal(prisma.rows[0].slaBreached, false, 'SLA breach not claimed with no recipient');
  assert.deepEqual(prisma.notifications, []);

  prisma.user.findMany = findAdmins;
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25.25) });
  assert.deepEqual(prisma.notifications.map((n) => n.type), ['ESCALATION', 'ESCALATION', 'SLA_BREACH', 'SLA_BREACH']);
});

test('escalation notifications are emitted live to each recipient, only after the transaction commits', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  const emitter = fakeEmitter();
  const transaction = prisma.$transaction;
  let committed = false;
  prisma.$transaction = async (callback) => {
    const result = await transaction(async (tx) => {
      const rows = await callback(tx);
      assert.deepEqual(emitter.emits, [], 'nothing is emitted inside the transaction');
      return rows;
    });
    committed = true;
    return result;
  };
  const originalTo = emitter.to;
  emitter.to = (room) => { assert.ok(committed, 'emitted before commit'); return originalTo(room); };

  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25), emitter });

  assert.equal(prisma.notifications.length, 4);
  const expected = prisma.notifications.flatMap((n) => [
    {
      room: `user:${n.userId}`,
      event: 'notification:new',
      payload: { id: n.id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt },
    },
    { room: `user:${n.userId}`, event: 'notification', payload: { id: n.id, type: n.type, data: n.data } },
  ]);
  assert.deepEqual(emitter.emits, expected);
  assert.deepEqual([...new Set(emitter.emits.map((e) => e.room))], ['user:admin-1', 'user:admin-2']);
  assert.deepEqual(
    emitter.emits.filter((e) => e.event === 'notification:new').map((e) => e.payload.type),
    ['ESCALATION', 'ESCALATION', 'SLA_BREACH', 'SLA_BREACH'],
  );

  // A repeat sweep claims nothing new, so nothing is re-announced.
  emitter.emits.length = 0;
  await checkThreadEscalation('t1', { prisma, slaDefaults: SLA, now: at(25.25), emitter });
  assert.deepEqual(emitter.emits, []);
});

test('the sweep delivers the SLA warning live to the assignee', async () => {
  const prisma = fakePrisma([{ id: 't1', subject: 'Late', lastActivityAt: at(0) }]);
  const emitter = fakeEmitter();
  await checkAllEscalations({ prisma, slaDefaults: SLA, now: at(5), emitter });
  assert.deepEqual(emitter.emits.map((e) => [e.room, e.event, e.payload.type]), [
    ['user:assignee', 'notification:new', 'SLA_WARNING'],
    ['user:assignee', 'notification', 'SLA_WARNING'],
  ]);
  assert.equal(emitter.emits[0].payload.id, prisma.notifications[0].id);
  assert.deepEqual(emitter.emits[0].payload.data, { threadId: 't1' });
});
