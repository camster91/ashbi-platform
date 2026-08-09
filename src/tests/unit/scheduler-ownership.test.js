import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  escalationQueue,
  healthQueue,
  scheduledQueue,
  setupRecurringJobs,
  weeklyDigestQueue,
} from '../../jobs/queue.js';

test('scheduler bootstrap uses stable IDs and timezone-aware business schedules', async () => {
  const calls = [];
  const queues = [healthQueue, escalationQueue, weeklyDigestQueue, scheduledQueue];
  for (const queue of queues) {
    queue.upsertJobScheduler = async (id, repeat, template) => {
      calls.push({ queue: queue.name, id, repeat, template });
    };
  }

  await setupRecurringJobs();
  await setupRecurringJobs();

  assert.equal(calls.length, 16);
  const firstPass = calls.slice(0, 8);
  const secondPass = calls.slice(8);
  assert.deepEqual(secondPass, firstPass);
  assert.equal(new Set(firstPass.map(({ queue, id }) => `${queue}:${id}`)).size, 8);

  const names = firstPass.map(({ template }) => template.name);
  assert.deepEqual(names, [
    'update-all-health',
    'check-all-escalations',
    'generate-weekly-digest',
    'recurring-invoices',
    'overdue-invoices',
    'trash-purge',
    'fleet-digest',
    'scheduled-workflows',
  ]);
  for (const call of firstPass) {
    assert.equal(call.template.opts.attempts, 3);
    assert.equal(call.template.opts.removeOnFail, 500);
  }
  for (const name of ['generate-weekly-digest', 'trash-purge', 'fleet-digest']) {
    assert.equal(firstPass.find((call) => call.template.name === name).repeat.tz, 'America/Toronto');
  }
});

test('API startup and route registration own no business schedule timers', () => {
  const index = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const wpBridge = fs.readFileSync(new URL('../../routes/wp-bridge.routes.js', import.meta.url), 'utf8');
  for (const source of [index, wpBridge]) {
    assert.doesNotMatch(source, /setupRecurringJobs|startRecurringInvoicesJob|startOverdueChecker|startTrashPurgeJob|startFleetDigestCron/);
    assert.doesNotMatch(source, /setInterval\(|setTimeout\(/);
  }
});
