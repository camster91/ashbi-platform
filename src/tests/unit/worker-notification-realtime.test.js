// Notifications written by the BullMQ worker used to be persisted only, so
// users saw them after the web app's 30-second poll. Every worker write path
// now emits the same `notification:new` + `notification` pair as
// fastify.notify, through the realtime emitter, after the row is committed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { processNotificationJob } from '../../jobs/notification-job.js';
import { createAdminNotification } from '../../services/automation.service.js';
import { createNotifier, emitNotification } from '../../services/notification.service.js';

function fakeEmitter() {
  const emits = [];
  return { emits, to: (room) => ({ emit: (event, payload) => { emits.push({ room, event, payload }); return true; } }) };
}

function fakeNotificationDb({ fail = false } = {}) {
  const rows = [];
  return {
    rows,
    user: { findFirst: async ({ where }) => (where.role === 'ADMIN' ? { id: 'admin-1' } : null) },
    notification: {
      create: async ({ data }) => {
        if (fail) throw new Error('insert failed');
        const row = { id: `n${rows.length + 1}`, createdAt: new Date('2026-09-30T12:00:00Z'), read: false, ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

function expectedEmits(row) {
  return [
    {
      room: `user:${row.userId}`,
      event: 'notification:new',
      payload: { id: row.id, type: row.type, title: row.title, message: row.message, data: row.data, createdAt: row.createdAt },
    },
    { room: `user:${row.userId}`, event: 'notification', payload: { id: row.id, type: row.type, data: row.data } },
  ];
}

test('emitNotification is the payload createNotifier emits', async () => {
  const row = { id: 'n1', userId: 'u1', type: 'TASK_ASSIGNED', title: 'Task', message: 'Hi', data: { taskId: 't1' }, createdAt: new Date() };
  const direct = fakeEmitter();
  emitNotification(direct, 'u1', row);
  const viaNotifier = fakeEmitter();
  createNotifier(viaNotifier).emit('u1', row);
  assert.deepEqual(direct.emits, expectedEmits(row));
  assert.deepEqual(viaNotifier.emits, direct.emits);
});

test('the notification queue job persists in the tenant, then emits to the user room', async () => {
  const db = fakeNotificationDb();
  const emitter = fakeEmitter();
  const tenantRuns = [];
  const runTenantJob = async (prisma, organizationId, callback, scoping) => {
    tenantRuns.push({ prisma, organizationId, scoping });
    assert.deepEqual(emitter.emits, [], 'nothing is emitted before the write');
    return callback(db);
  };
  const job = { data: { organizationId: 'org-1', userId: 'u1', type: 'INVOICE_PAID', title: 'Paid', message: 'INV-1 paid', data: { invoiceId: 'i1' } } };

  const result = await processNotificationJob(job, { prisma: 'raw', backgroundPrisma: 'background', emitter, runTenantJob });

  assert.deepEqual(result, { delivered: true });
  assert.deepEqual(tenantRuns, [{ prisma: 'raw', organizationId: 'org-1', scoping: 'background' }]);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].userId, 'u1');
  assert.deepEqual(emitter.emits, expectedEmits(db.rows[0]));
});

test('a failed notification job write emits nothing', async () => {
  const emitter = fakeEmitter();
  const db = fakeNotificationDb({ fail: true });
  const job = { data: { organizationId: 'org-1', userId: 'u1', type: 'X', title: 'X', message: 'X' } };
  await assert.rejects(
    processNotificationJob(job, { prisma: 'raw', emitter, runTenantJob: async (_p, _o, callback) => callback(db) }),
    /insert failed/,
  );
  assert.deepEqual(emitter.emits, []);
});

test('the worker routes notification jobs through processNotificationJob', () => {
  const worker = fs.readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
  const section = worker.slice(worker.indexOf('QUEUES.NOTIFICATIONS'), worker.indexOf('// Weekly Digest Worker'));
  assert.match(section, /processNotificationJob\(job, \{ prisma, backgroundPrisma \}\)/);
  assert.doesNotMatch(section, /notification\.create/, 'no second write path that skips the emit');
});

test('automation admin notifications are emitted to the admin room after the write', async () => {
  const db = fakeNotificationDb();
  const emitter = fakeEmitter();

  const row = await createAdminNotification('INVOICE_OVERDUE', 'Invoice Overdue', 'INV-1 is overdue', { invoiceId: 'i1' }, 'org-1', { db, emitter });

  assert.equal(row.userId, 'admin-1');
  assert.deepEqual(emitter.emits, expectedEmits(db.rows[0]));
});

test('an automation notification with no admin or a failed write emits nothing', async () => {
  const emitter = fakeEmitter();
  const noAdmin = { ...fakeNotificationDb(), user: { findFirst: async () => null } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await createAdminNotification('X', 'X', 'X', null, 'org-1', { db: noAdmin, emitter }), null);
  } finally {
    console.warn = warn;
  }
  await assert.rejects(createAdminNotification('X', 'X', 'X', null, 'org-1', { db: fakeNotificationDb({ fail: true }), emitter }), /insert failed/);
  assert.deepEqual(emitter.emits, []);
});

test('worker shutdown closes the realtime emitter after the workers drain', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
  const workers = source.indexOf("['workers',");
  const realtime = source.indexOf("['realtime', () => closeRealtimeEmitter()]");
  assert.ok(workers > 0 && realtime > workers, 'realtime step after workers');
});
