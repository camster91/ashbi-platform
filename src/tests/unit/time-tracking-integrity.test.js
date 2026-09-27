import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { requestStorage } from '../../utils/request-context.js';
import { startTimer, stopTimer, deleteTimeEntry, TimerError } from '../../services/timeTracking.service.js';
import timeRoutes, { timeEntryLock } from '../../routes/time.routes.js';

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
        update: async (args) => { writes.push(args); return {}; },
        delete: async (args) => { writes.push(args); return {}; },
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
