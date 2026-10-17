import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSchedulerMigration } from '../../jobs/scheduler-migration.js';

function queue(entries, modern = []) {
  const observed = [];
  return { name: 'synthetic-health', observed, getBackend: () => ({
    getJobSchedulersRange: async (...args) => { observed.push(args); return entries; },
    isJobScheduler: async key => modern.includes(key),
  }) };
}
test('v6 preflight permits fresh Redis and registered scheduler IDs without changing them', async () => {
  const empty = queue([]);
  const current = queue(['project-health-hourly', '100', 'name:id:::cron', '200'], ['project-health-hourly', 'name:id:::cron']);
  await assertSchedulerMigration([empty, current]);
  assert.deepEqual(current.observed, [[0, 200, true]]);
});
test('v6 preflight rejects both hashed and colon legacy IDs, irrespective of shared job names', async () => {
  for (const key of ['abcdef1234567890', 'update-all-health:recurring-health-check:::3600000']) {
    await assert.rejects(assertSchedulerMigration([queue([key, '100'])]), /migrate with BullMQ v5/);
  }
});
test('v6 preflight fails closed on incomplete or excessive scheduler evidence', async () => {
  for (const entries of [['odd'], Array.from({ length: 402 }, () => 'x')]) {
    await assert.rejects(assertSchedulerMigration([queue(entries)]), /exceeded its bound/);
  }
});
