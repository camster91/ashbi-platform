import test from 'node:test';
import assert from 'node:assert/strict';
import { completionRepeatDate } from '../../shared/task-recurrence.js';
import { processCompletionRepeats, saveTaskRecurrence } from '../../services/task-recurrence.service.js';

const rule = { trigger: 'AFTER_COMPLETION', frequency: 'MONTHLY', interval: 1, startDate: '2026-01-01', timeZone: 'America/Toronto' };
function fixture() {
  const root = { id: 'root', projectId: 'project', project: { organizationId: 'org-a' }, title: 'Review', status: 'COMPLETED', recurrenceFirstCompletedAt: new Date('2026-01-31T17:00:00Z'), recurrenceCompletionProcessedAt: null, recurrenceRule: rule, recurrenceRevision: 0, assigneeId: 'owner', fieldValues: { score: 0, approved: false } };
  const rows = [root], copied = [], queries = [];
  const match = (row, where) => (!where.id || typeof where.id === 'string' ? !where.id || row.id === where.id : row.id > where.id.gt)
    && (!where.OR || where.OR.some(branch => match(row, branch)))
    && (!where.recurrenceSourceId || row.recurrenceSourceId === where.recurrenceSourceId)
    && (!where.status || row.status === where.status)
    && (!Object.hasOwn(where, 'recurrenceCompletionProcessedAt') || row.recurrenceCompletionProcessedAt == null)
    && (!where.recurrenceFirstCompletedAt || row.recurrenceFirstCompletedAt != null)
    && (!where.recurrenceRule || row.recurrenceRule?.trigger === 'AFTER_COMPLETION');
  const prisma = {
    task: {
      findMany: async ({ where, take }) => { queries.push(where); assert.equal(take, 100); return rows.filter(row => match(row, where)).slice(0, take); },
      findFirst: async ({ where }) => rows.find(row => match(row, where)) ?? null,
      updateMany: async ({ where, data }) => { const matched = rows.filter(row => match(row, where)); matched.forEach(row => { const revision = row.recurrenceRevision; Object.assign(row, data); if (data.recurrenceRevision?.increment) row.recurrenceRevision = revision + data.recurrenceRevision.increment; }); return { count: matched.length }; },
      update: async ({ where, data }) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data); row.recurrenceRevision = 1; return row; },
      create: async ({ data }) => { const row = { ...data, id: `copy-${rows.length}`, project: root.project, recurrenceCompletionProcessedAt: null }; rows.push(row); copied.push(row); return row; },
    },
    user: { findFirst: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return { id: where.id }; } },
    taskCollaborator: { findMany: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return [{ userId: 'helper' }]; }, createMany: async () => ({ count: 1 }) },
  };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, root, rows, copied, queries };
}
test('completion intervals anchor to completion day in the selected timezone', () => {
  assert.equal(completionRepeatDate(rule, new Date('2026-01-31T17:00:00Z')), '2026-02-28');
  assert.equal(completionRepeatDate({ ...rule, frequency: 'DAILY' }, new Date('2026-03-08T04:59:00Z')), '2026-03-08');
  assert.equal(completionRepeatDate({ ...rule, frequency: 'WEEKLY', interval: 2 }, new Date('2026-01-31T17:00:00Z')), '2026-02-14');
});
test('first completion copies fields, owner and contributors once, even after reopening', async () => {
  const { prisma, root, copied, queries } = fixture();
  assert.equal((await processCompletionRepeats(prisma)).generated, 1);
  assert.equal(copied[0].dueDate.toISOString().slice(0, 10), '2026-02-28');
  assert.equal(copied[0].assigneeId, 'owner'); assert.deepEqual(copied[0].fieldValues, { score: 0, approved: false });
  assert.equal(copied[0].recurrenceCompletionSourceId, 'root'); assert.equal(copied[0].recurrenceSourceId, 'root');
  assert.equal(copied[0].status, 'PENDING'); assert.equal(copied[0].recurrenceScheduledDate, undefined);
  assert.equal((await processCompletionRepeats(prisma)).generated, 0);
  root.status = 'PENDING'; await processCompletionRepeats(prisma); root.status = 'COMPLETED';
  assert.equal((await processCompletionRepeats(prisma)).generated, 0);
  copied[0].status = 'COMPLETED'; copied[0].recurrenceFirstCompletedAt = new Date('2026-01-31T18:00:00Z');
  assert.equal((await processCompletionRepeats(prisma)).generated, 1);
  assert.equal(copied[1].recurrenceCompletionSourceId, 'copy-1');
  assert.equal(copied[1].dueDate.toISOString().slice(0, 10), '2026-02-28', 'early completion may share a due date without colliding with calendar uniqueness');
  assert.deepEqual(queries[0].recurrenceRule, { path: ['trigger'], equals: 'AFTER_COMPLETION' });
});
test('enabling consumes completed history and stopping the original prevents later copies', async () => {
  const { prisma, root, copied } = fixture();
  root.recurrenceRule = { ...rule, trigger: 'CALENDAR' };
  await saveTaskRecurrence(prisma, root.id, { revision: 0, rule });
  assert.equal(root.recurrenceNextDate, null);
  assert.ok(root.recurrenceCompletionProcessedAt);
  assert.equal((await processCompletionRepeats(prisma)).generated, 0);
  root.recurrenceCompletionProcessedAt = null; root.recurrenceRule = {};
  assert.equal((await processCompletionRepeats(prisma)).generated, 0); assert.equal(copied.length, 0);
});
