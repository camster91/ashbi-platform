import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyBonsaiTaskSnapshot } from '../../services/bonsaiTaskSnapshot.service.js';

function snapshot() {
  return {
    format: 'bonsai-task-snapshot',
    version: 1,
    scope: 'all',
    complete: true,
    capturedAt: '2026-08-28T00:24:36.569Z',
    captureEvidence: {
      connector: 'bonsai',
      operation: 'list_tasks',
      pageSize: 100,
      pagesFetched: 1,
      finalHasMore: false,
      taskCount: 1,
    },
    tasks: [{
      uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3ff',
      title: 'Synthetic task',
      project_id: 123,
      project_title: 'Synthetic project',
      assignee_member_name: 'Synthetic Owner',
      due_date: null,
      start_date: '2026-08-28',
      completed_at: null,
      archived_at: null,
      priority: 'medium',
      task_status: { status: 'To Do', state: 'active' },
    }],
  };
}

test('accepts a complete all-scope connector snapshot with bounded pagination evidence', () => {
  const report = verifyBonsaiTaskSnapshot(snapshot());
  assert.equal(report.valid, true);
  assert.equal(report.migrationReady, true);
  assert.equal(report.taskCount, 1);
  assert.equal(report.pagesFetched, 1);
  assert.deepEqual(report.findings, []);
});

test('rejects incomplete pagination and a task-count mismatch', () => {
  const value = snapshot();
  value.captureEvidence.finalHasMore = true;
  value.captureEvidence.taskCount = 2;
  const report = verifyBonsaiTaskSnapshot(value);
  assert.equal(report.valid, false);
  assert.equal(report.migrationReady, false);
  assert.deepEqual(report.findings, [{ code: 'INVALID_PAGINATION_EVIDENCE' }]);
});

test('separates capture integrity from source records that need migration review', () => {
  const value = snapshot();
  value.tasks[0].title = '';
  value.tasks[0].project_id = null;
  const report = verifyBonsaiTaskSnapshot(value);
  assert.equal(report.valid, true);
  assert.equal(report.migrationReady, false);
  assert.deepEqual(report.findings, [
    {
      code: 'TASK_REQUIRES_SOURCE_REVIEW',
      index: 0,
      taskUuid: '4efb6f56-e0bf-4a31-936c-7a215420f3ff',
      fields: ['title', 'project_id'],
    },
  ]);
});

test('rejects duplicate task UUIDs and malformed material fields', () => {
  const value = snapshot();
  value.tasks.push({ ...value.tasks[0], priority: 'invented' });
  value.captureEvidence.taskCount = 2;
  const report = verifyBonsaiTaskSnapshot(value);
  assert.equal(report.valid, false);
  assert.equal(report.migrationReady, false);
  assert.deepEqual(report.integrityFindings, [
    { code: 'INVALID_TASK_RECORD', index: 1, fields: ['priority'] },
    {
      code: 'DUPLICATE_TASK_UUID',
      uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3ff',
      indexes: [0, 1],
    },
  ]);
});

test('verification command is read-only and reports generic read failures', () => {
  const script = fs.readFileSync('scripts/verify-bonsai-task-snapshot.mjs', 'utf8');
  assert.doesNotMatch(script, /writeFile|appendFile|createWriteStream|prisma|fetch\(/);
  assert.match(script, /SNAPSHOT_READ_FAILED/);
});
