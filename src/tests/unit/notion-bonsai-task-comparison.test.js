import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NOTION_OPERATING_SOURCE } from '../../services/notionOperatingSnapshot.service.js';
import { compareNotionBonsaiTasks } from '../../services/notionBonsaiTaskComparison.service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sources() {
  const projectUrl = 'https://app.notion.com/11111111111111111111111111111111';
  const notion = {
    format: 'ashbi-notion-project-task-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T00:33:38.418Z',
    workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: { databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl, hasMore: false, rows: 1 },
      tasks: { databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl, hasMore: false, rows: 1 },
    },
    archivedSources: {
      projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl,
      tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl,
    },
    projects: [{ url: projectUrl, createdTime: '2026-08-27T12:00:00Z', Project: 'Client Website', Status: 'Active' }],
    tasks: [{ url: 'https://app.notion.com/22222222222222222222222222222222', createdTime: '2026-08-27T13:00:00Z', Task: 'Review homepage', Status: 'Review', Project: JSON.stringify([projectUrl]) }],
  };
  const bonsai = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T00:24:36.569Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_tasks', pageSize: 100, pagesFetched: 1, finalHasMore: false, taskCount: 1 },
    tasks: [{
      uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3ff', title: 'Review homepage',
      project_id: 123, project_title: 'Client Website', assignee_member_name: 'Cameron',
      due_date: null, start_date: null, completed_at: null, archived_at: null,
      priority: null, task_status: { status: 'To Do', state: 'active' },
    }],
  };
  return { notion, bonsai };
}

function input() {
  const { notion, bonsai } = sources();
  return { notionSnapshot: notion, bonsaiSnapshot: bonsai, notionSnapshotSha256: HASH_A, bonsaiSnapshotSha256: HASH_B, completedAt: '2026-08-28T01:00:00Z' };
}

test('passes one exact task, project, and lifecycle identity without guessing', () => {
  const report = compareNotionBonsaiTasks(input());
  assert.equal(report.complete, true);
  assert.deepEqual(report.summary, {
    notionTasks: 1, bonsaiTasks: 1, exactTitleMatches: 1, exactProjectTitleMatches: 1,
    lifecycleMatches: 1, notionOnlyTasks: 0, bonsaiOnlyTasks: 0, unresolvedFindings: 0,
  });
});
test('preserves project, lifecycle, source-review, and source-only differences', () => {
  const value = input();
  value.notionSnapshot.tasks[0].Status = 'Done';
  value.bonsaiSnapshot.tasks[0].project_id = null;
  value.bonsaiSnapshot.tasks[0].project_title = null;
  value.bonsaiSnapshot.tasks.push({ ...value.bonsaiSnapshot.tasks[0], uuid: '1d71f5a9-10c0-42b3-aace-8e723924af94', title: 'Bonsai only' });
  value.bonsaiSnapshot.captureEvidence.taskCount = 2;
  const report = compareNotionBonsaiTasks(value);
  assert.equal(report.complete, false);
  assert.deepEqual(report.findings.map(finding => finding.code), [
    'BONSAI_SOURCE_REVIEW_REQUIRED', 'BONSAI_SOURCE_REVIEW_REQUIRED',
    'TASK_PROJECT_TITLE_MISMATCH', 'TASK_LIFECYCLE_MISMATCH', 'BONSAI_TASK_MISSING_IN_NOTION',
  ]);
});

test('reports one source-only finding on each side', () => {
  const value = input();
  value.bonsaiSnapshot.tasks[0].title = 'Different task';
  const report = compareNotionBonsaiTasks(value);
  assert.equal(report.summary.exactTitleMatches, 0);
  assert.equal(report.summary.notionOnlyTasks, 1);
  assert.equal(report.summary.bonsaiOnlyTasks, 1);
});

test('CLI creates one owner-only report and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-bonsai-compare-'));
  try {
    const { notion, bonsai } = sources();
    const notionPath = path.join(temp, 'notion.json');
    const bonsaiPath = path.join(temp, 'bonsai.json');
    const outputPath = path.join(temp, 'report.json');
    fs.writeFileSync(notionPath, JSON.stringify(notion));
    fs.writeFileSync(bonsaiPath, JSON.stringify(bonsai));
    const args = ['scripts/compare-notion-bonsai-tasks.mjs', '--notion', notionPath, '--bonsai', bonsaiPath, '--completed-at', '2026-08-28T01:00:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).complete, true);
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).complete, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
