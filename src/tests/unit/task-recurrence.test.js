import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInZone, recurrenceAfter, firstRecurrenceOnOrAfter } from '../../shared/task-recurrence.js';
import { taskRecurrenceRuleSchema } from '../../validators/schemas.js';
import { processRecurringTasks, saveTaskRecurrence } from '../../services/task-recurrence.service.js';

const rule = { frequency: 'MONTHLY', interval: 1, startDate: '2026-01-31', timeZone: 'America/Toronto' };
const source = () => ({ id: 'source-1', projectId: 'project-1', title: 'Monthly review', status: 'COMPLETED', stageKey: 'done',
  project: { organizationId: 'org-a' }, recurrenceRule: rule, recurrenceNextDate: new Date('2026-01-31T00:00:00Z'), recurrenceRevision: 0, priority: 'HIGH', category: 'UPCOMING', tags: '[]' });
function fixture(tasks = [source()]) {
  const created = [];
  const rows = tasks.map(item => ({ ...item }));
  const db = {
    task: {
      findMany: async ({ where, take }) => rows.filter(row => row.recurrenceNextDate && (!where.id || row.id > where.id.gt)).slice(0, take),
      findFirst: async ({ where }) => rows.find(row => row.id === where.id) ?? null,
      update: async ({ where, data }) => { const row = rows.find(item => item.id === where.id); Object.assign(row, data); row.recurrenceRevision = 1; return row; },
      updateMany: async ({ where, data }) => {
        const row = rows.find(item => item.id === where.id);
        if (row.recurrenceRevision !== where.recurrenceRevision || (where.recurrenceNextDate && +row.recurrenceNextDate !== +where.recurrenceNextDate)) return { count: 0 };
        const revision = row.recurrenceRevision;
        Object.assign(row, data); if (data.recurrenceRevision?.increment) row.recurrenceRevision = revision + data.recurrenceRevision.increment; return { count: 1 };
      },
      create: async ({ data }) => { created.push(data); return { ...data, id: 'generated' }; },
    }, user: { findFirst: async () => null },
    taskCollaborator: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(db); },
  };
  return { db, created, rows };
}

test('monthly recurrence clamps short months without drifting from the original day', () => {
  assert.equal(recurrenceAfter(rule, '2026-01-31'), '2026-02-28');
  assert.equal(recurrenceAfter(rule, '2026-02-28'), '2026-03-31');
  assert.equal(recurrenceAfter({ ...rule, startDate: '2028-01-31' }, '2028-01-31'), '2028-02-29');
  assert.equal(recurrenceAfter({ ...rule, interval: 3 }, '2026-01-31'), '2026-04-30');
});
test('daily/weekly intervals and future anchors select the right calendar day', () => {
  assert.equal(recurrenceAfter({ ...rule, frequency: 'WEEKLY', interval: 2 }, '2026-02-01'), '2026-02-14');
  assert.equal(recurrenceAfter({ ...rule, frequency: 'DAILY', interval: 3 }, '2026-02-01'), '2026-02-03');
  assert.equal(firstRecurrenceOnOrAfter(rule, '2026-01-31'), '2026-01-31');
  assert.equal(firstRecurrenceOnOrAfter(rule, '2025-12-01'), '2026-01-31');
});
test('timezone day boundaries remain correct across daylight-saving changes', () => {
  assert.equal(dateInZone(new Date('2026-03-08T04:59:00Z'), 'America/Toronto'), '2026-03-07');
  assert.equal(dateInZone(new Date('2026-03-09T04:01:00Z'), 'America/Toronto'), '2026-03-09');
  assert.equal(dateInZone(new Date('2026-11-02T04:59:00Z'), 'America/Toronto'), '2026-11-01');
});
test('rules reject impossible dates, unknown timezones and unbounded intervals', () => {
  for (const change of [{ startDate: '2026-02-30' }, { timeZone: 'Not/AZone' }, { interval: 0 }, { interval: 366 }]) {
    assert.equal(taskRecurrenceRuleSchema.safeParse({ ...rule, ...change }).success, false);
  }
});
test('editing uses revisions, stopping preserves history, and an old date cannot be replayed', async () => {
  const { db, rows } = fixture();
  rows[0].recurrenceLastDate = new Date('2026-01-31T00:00:00Z');
  const saved = await saveTaskRecurrence(db, 'source-1', { revision: 0, rule }, new Date('2026-01-31T17:00:00Z'));
  assert.equal(saved.recurrenceNextDate.toISOString().slice(0, 10), '2026-02-28');
  await assert.rejects(saveTaskRecurrence(db, 'source-1', { revision: 0, rule }), { statusCode: 409 });
  const stopped = await saveTaskRecurrence(db, 'source-1', { revision: 1, rule: null });
  assert.equal(stopped.recurrenceNextDate, null);
  assert.equal(stopped.recurrenceLastDate.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(stopped.status, 'COMPLETED');
});
test('worker creates one catch-up task, resets lifecycle and retains source date; retries make no duplicate', async () => {
  const { db, created, rows } = fixture([{ ...source(), fieldValues: { brief: 'Review design', estimate: 0 } }]);
  const now = new Date('2026-04-18T16:00:00Z');
  const result = await processRecurringTasks(db, { now });
  assert.equal(result.generated, 1);
  assert.equal(created[0].status, 'PENDING');
  assert.equal(created[0].recurrenceSourceId, 'source-1');
  assert.equal(created[0].dueDate.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(created[0].stageKey, undefined);
  assert.equal(created[0].recurrenceRule, undefined);
  assert.deepEqual(created[0].fieldValues, { brief: 'Review design', estimate: 0 });
  assert.equal(rows[0].recurrenceNextDate.toISOString().slice(0, 10), '2026-04-30');
  assert.equal((await processRecurringTasks(db, { now })).generated, 0);
  assert.equal(created.length, 1);
});
test('not due in the selected timezone does not generate; one bad source does not block good sources', async () => {
  const { db, created } = fixture();
  assert.equal((await processRecurringTasks(db, { now: new Date('2026-01-31T04:30:00Z') })).generated, 0);
  assert.equal(created.length, 0);
  const mixed = fixture([{ ...source(), id: 'bad', recurrenceRule: {} }, source()]);
  await assert.rejects(processRecurringTasks(mixed.db, { now: new Date('2026-02-01T17:00:00Z') }), /Failed to generate 1/);
  assert.equal(mixed.created.length, 1);
});

test('calendar copies retain active tenant contributors without changing the accountable owner', async () => {
  const { db, created } = fixture([{ ...source(), assigneeId: 'owner' }]);
  db.user.findFirst = async ({ where }) => { assert.equal(where.organizationId, 'org-a'); assert.equal(where.isActive, true); return { id: 'owner' }; };
  db.taskCollaborator.findMany = async ({ where, take }) => {
    assert.deepEqual(where, { taskId: 'source-1', organizationId: 'org-a', user: { organizationId: 'org-a', isActive: true, role: { in: ['ADMIN', 'TEAM'] } } });
    assert.equal(take, 30); return [{ userId: 'helper' }];
  };
  const copies = [];
  db.taskCollaborator.createMany = async ({ data }) => { copies.push(...data); };
  await processRecurringTasks(db, { now: new Date('2026-02-01T17:00:00Z') });
  assert.equal(created[0].assigneeId, 'owner');
  assert.deepEqual(copies, [{ taskId: 'generated', userId: 'helper', organizationId: 'org-a' }]);
  assert.equal((await processRecurringTasks(db, { now: new Date('2026-02-01T17:00:00Z') })).generated, 0);
  assert.equal(copies.length, 1);
});
