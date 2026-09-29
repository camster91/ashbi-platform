import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { requestStorage } from '../../utils/request-context.js';
import { startTimer, stopTimer, deleteTimeEntry, createManualEntry, TimerError } from '../../services/timeTracking.service.js';
import { MAX_TIME_ENTRY_MINUTES, timeEntryCreateSchema, timeEntryUpdateSchema } from '../../validators/schemas.js';
import timeRoutes, { timeEntryLock, unlockedTimeEntryWhere } from '../../routes/time.routes.js';

// C2/H7/H6 without a database (the race itself is proven against PostgreSQL
// in src/tests/integration/time-tracking.database.test.js).

function fakeDb({ sessions = [], failCreateWith } = {}) {
  const entries = [];
  const db = {
    entries,
    sessions,
    timeSession: {
      findFirst: async ({ where }) => sessions.find((s) => s.id === where.id && s.userId === where.userId) ?? null,
      findMany: async ({ where }) => sessions.filter((s) => s.userId === where.userId && s.isRunning === where.isRunning),
      updateMany: async ({ where, data }) => {
        const hit = sessions.filter((s) => s.id === where.id && s.userId === where.userId
          && (where.isRunning === undefined || s.isRunning === where.isRunning));
        for (const s of hit) Object.assign(s, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i -= 1) {
          if (sessions[i].id === where.id && sessions[i].userId === where.userId && !sessions[i].isRunning) sessions.splice(i, 1);
        }
        return { count: before - sessions.length };
      },
      create: async ({ data }) => {
        if (failCreateWith) throw failCreateWith;
        const row = { id: `s${sessions.length + 1}`, ...data };
        sessions.push(row);
        return row;
      },
    },
    timeEntry: {
      create: async ({ data }) => { const row = { id: `e${entries.length + 1}`, ...data }; entries.push(row); return row; },
    },
  };
  db.$transaction = async (fn) => fn(db);
  return db;
}

const run = (db, fn) => requestStorage.run({ prisma: db, organizationId: 'org-a' }, fn);

test('stopping a timer creates a TIMER time entry linked to the session', async () => {
  const db = fakeDb({ sessions: [{ id: 's1', userId: 'u1', projectId: 'p1', taskId: null, description: 'Work', billable: true, isRunning: true, startTime: new Date(Date.now() - 30 * 60_000) }] });
  const stopped = await run(db, () => stopTimer('s1', 'u1'));
  assert.equal(stopped.isRunning, false);
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].source, 'TIMER');
  assert.equal(db.entries[0].timeSessionId, 's1');
  assert.equal(db.entries[0].duration, 30);
});

test('a timer left running for days records at most a 1440-minute entry', async () => {
  const db = fakeDb({ sessions: [{ id: 's1', userId: 'u1', projectId: 'p1', isRunning: true, startTime: new Date(Date.now() - 3 * 24 * 60 * 60_000) }] });
  const stopped = await run(db, () => stopTimer('s1', 'u1'));
  assert.equal(db.entries[0].duration, MAX_TIME_ENTRY_MINUTES);
  assert.ok(stopped.duration >= 3 * 24 * 60 - 1, 'the session keeps its real span');
});

test('time entry durations are minutes, capped at one day', () => {
  assert.equal(MAX_TIME_ENTRY_MINUTES, 1440);
  assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration: 1440 }).success, true);
  assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration: 1441 }).success, false);
  assert.equal(timeEntryUpdateSchema.safeParse({ duration: 86_400 }).success, false);
});

test('a manual entry is recorded as a MANUAL TimeEntry', async () => {
  const created = [];
  const db = { timeEntry: { create: async ({ data }) => { created.push(data); return { id: 'e1', ...data }; } } };
  const entry = await run(db, () => createManualEntry('u1', 'p1', { duration: 90, description: 'Call' }));
  assert.equal(entry.source, 'MANUAL');
  assert.equal(created[0].duration, 90);
  assert.equal(created[0].userId, 'u1');
});

test('only the owner can stop or delete a timer; others get 404', async () => {
  const db = fakeDb({ sessions: [{ id: 's1', userId: 'u1', projectId: 'p1', isRunning: true, startTime: new Date() }] });
  await assert.rejects(run(db, () => stopTimer('s1', 'intruder')), (err) => err instanceof TimerError && err.statusCode === 404);
  await assert.rejects(run(db, () => deleteTimeEntry('s1', 'intruder')), (err) => err instanceof TimerError && err.statusCode === 404);
  assert.equal(db.sessions[0].isRunning, true);
});

test('a lost start race answers 409 instead of 500', async () => {
  const db = fakeDb({ failCreateWith: Object.assign(new Error('Unique constraint failed on the fields: (`userId`)'), { code: 'P2002' }) });
  await assert.rejects(run(db, () => startTimer('u1', 'p1')), (err) => err instanceof TimerError && err.statusCode === 409 && err.code === 'TIMER_ALREADY_RUNNING');
});

test('approved and invoiced time entries are locked against edit and delete', async () => {
  assert.equal(timeEntryLock({ reviewStatus: 'PENDING', invoiced: false }), null);
  assert.equal(timeEntryLock({ reviewStatus: 'REJECTED' }), null);
  assert.equal(timeEntryLock({ reviewStatus: 'APPROVED' }).code, 'TIME_ENTRY_APPROVED');
  assert.equal(timeEntryLock({ reviewStatus: 'PENDING', invoiced: true }).code, 'TIME_ENTRY_INVOICED');
  assert.equal(timeEntryLock({ reviewStatus: 'PENDING', invoiceId: 'inv-1' }).code, 'TIME_ENTRY_INVOICED');

  const writes = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'TEAM' }; });
  app.addHook('onRequest', async (request) => {
    request.prisma = {
      timeEntry: {
        findUnique: async ({ where }) => ({ id: where.id, userId: 'u1', reviewStatus: 'APPROVED', invoiced: false }),
        updateMany: async (args) => { writes.push(args); return { count: 1 }; },
        deleteMany: async (args) => { writes.push(args); return { count: 1 }; },
      },
    };
  });
  await app.register(timeRoutes, { prefix: '/api' });
  try {
    const edit = await app.inject({ method: 'PUT', url: '/api/time-entries/e1', payload: { description: 'x' } });
    assert.equal(edit.statusCode, 409);
    assert.equal(edit.json().code, 'TIME_ENTRY_APPROVED');
    const remove = await app.inject({ method: 'DELETE', url: '/api/time-entries/e1' });
    assert.equal(remove.statusCode, 409);
    assert.equal(writes.length, 0);
  } finally {
    await app.close();
  }
});

test('a timer stopped before a full minute records no entry, even when it rounds to 1', async () => {
  for (const seconds of [10, 30, 45, 59]) {
    const db = fakeDb({ sessions: [{ id: 's1', userId: 'u1', projectId: 'p1', isRunning: true, startTime: new Date(Date.now() - seconds * 1000) }] });
    await run(db, () => stopTimer('s1', 'u1'));
    assert.equal(db.entries.length, 0, `${seconds}s`);
    assert.equal(db.sessions[0].duration, 0, `${seconds}s session keeps 0 minutes, so summaries never count it`);
  }
  const db = fakeDb({ sessions: [{ id: 's1', userId: 'u1', projectId: 'p1', isRunning: true, startTime: new Date(Date.now() - 61 * 1000) }] });
  await run(db, () => stopTimer('s1', 'u1'));
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].duration, 1);
});

test('manual durations that round to zero minutes are refused', () => {
  for (const duration of [0, 0.2, 0.49, -5]) {
    assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration }).success, false, `create ${duration}`);
    assert.equal(timeEntryUpdateSchema.safeParse({ duration }).success, false, `update ${duration}`);
  }
  assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration: 0.5 }).success, true, 'rounds to 1');
  assert.equal(timeEntryCreateSchema.safeParse({ projectId: 'p1', duration: 90 }).success, true);
});

test('every time-entry write stores the same rounded minutes (never a truncated 0)', async () => {
  const created = [];
  const updated = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'TEAM' }; });
  app.addHook('onRequest', async (request) => {
    request.prisma = {
      timeEntry: {
        create: async ({ data }) => { created.push(data); return { id: 'e1', ...data }; },
        findUnique: async ({ where }) => ({ id: where.id, userId: 'u1', reviewStatus: 'PENDING', invoiced: false }),
        updateMany: async ({ data }) => { updated.push(data); return { count: 1 }; },
      },
      activity: { create: async () => ({}) },
    };
  });
  await app.register(timeRoutes, { prefix: '/api' });
  try {
    const projectId = 'cjld2cjxh0000qzrmn831i7rn';
    const tooSmall = await app.inject({ method: 'POST', url: '/api/time-entries', payload: { projectId, duration: 0.4 } });
    assert.equal(tooSmall.statusCode, 400);
    const half = await app.inject({ method: 'POST', url: '/api/time-entries', payload: { projectId, duration: 0.6 } });
    assert.equal(half.statusCode, 201, half.body);
    const edit = await app.inject({ method: 'PUT', url: '/api/time-entries/e1', payload: { duration: 29.6 } });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.deepEqual(created.map((data) => data.duration), [1], 'parseInt would have stored 0');
    assert.deepEqual(updated.map((data) => data.duration), [30]);
  } finally {
    await app.close();
  }
});

test('edits and deletes are conditional on the entry still being unlocked', async () => {
  const where = unlockedTimeEntryWhere('e1');
  assert.deepEqual(where, { id: 'e1', deletedAt: null, invoiced: false, invoiceId: null, reviewStatus: { not: 'APPROVED' } });

  // The lock check passes on a stale read, then the approval lands: the
  // conditional write matches nothing and the route answers 409.
  let reads = 0;
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'TEAM' }; });
  app.addHook('onRequest', async (request) => {
    request.prisma = {
      timeEntry: {
        findUnique: async ({ where: byId }) => ({ id: byId.id, userId: 'u1', invoiced: false, reviewStatus: reads++ === 0 ? 'PENDING' : 'APPROVED' }),
        updateMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
      },
    };
  });
  await app.register(timeRoutes, { prefix: '/api' });
  try {
    const edit = await app.inject({ method: 'PUT', url: '/api/time-entries/e1', payload: { description: 'x' } });
    assert.equal(edit.statusCode, 409, edit.body);
    assert.equal(edit.json().code, 'TIME_ENTRY_APPROVED');
    reads = 0;
    const remove = await app.inject({ method: 'DELETE', url: '/api/time-entries/e1' });
    assert.equal(remove.statusCode, 409, remove.body);
  } finally {
    await app.close();
  }
});
