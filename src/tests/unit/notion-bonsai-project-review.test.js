import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NOTION_OPERATING_SOURCE } from '../../services/notionOperatingSnapshot.service.js';
import { prepareNotionBonsaiProjectReview } from '../../services/notionBonsaiProjectReview.service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sources() {
  const exactUrl = 'https://app.notion.com/11111111111111111111111111111111';
  const aliasUrl = 'https://app.notion.com/11111111111111111111111111111112';
  const unmatchedUrl = 'https://app.notion.com/11111111111111111111111111111113';
  const notion = {
    format: 'ashbi-notion-project-task-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T00:33:38.418Z',
    workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: { databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl, hasMore: false, rows: 3 },
      tasks: { databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl, hasMore: false, rows: 2 },
    },
    archivedSources: {
      projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl,
      tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl,
    },
    projects: [
      { url: exactUrl, createdTime: '2026-08-27T12:00:00Z', Project: 'Exact Project', Status: 'Active' },
      { url: aliasUrl, createdTime: '2026-08-27T12:00:01Z', Project: 'Client Website', Status: 'Active' },
      { url: unmatchedUrl, createdTime: '2026-08-27T12:00:02Z', Project: 'Notion Only', Status: 'Planning' },
    ],
    tasks: [
      { url: 'https://app.notion.com/22222222222222222222222222222221', createdTime: '2026-08-27T13:00:00Z', Task: 'Exact work', Status: 'Review', Project: JSON.stringify([exactUrl]) },
      { url: 'https://app.notion.com/22222222222222222222222222222222', createdTime: '2026-08-27T13:00:01Z', Task: 'Review homepage', Status: 'To do', Project: JSON.stringify([aliasUrl]) },
    ],
  };
  const bonsai = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T00:24:36.569Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_tasks', pageSize: 100, pagesFetched: 1, finalHasMore: false, taskCount: 4 },
    tasks: [
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f1', title: 'Exact work', project_id: 123, project_title: 'Exact Project', assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f2', title: 'Review homepage', project_id: 124, project_title: 'Client Website Retainer', assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f3', title: 'Legacy task', project_id: 125, project_title: 'Legacy Project', assignee_member_name: null, due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f4', title: 'Projectless', project_id: null, project_title: null, assignee_member_name: 'Bianca', due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
    ],
  };
  return { notion, bonsai };
}

function input() {
  const { notion, bonsai } = sources();
  return { notionSnapshot: notion, bonsaiSnapshot: bonsai, notionSnapshotSha256: HASH_A, bonsaiSnapshotSha256: HASH_B, preparedAt: '2026-08-28T01:00:00Z' };
}

test('separates complete Notion inventory from task-referenced Bonsai project evidence', () => {
  const review = prepareNotionBonsaiProjectReview(input());
  assert.equal(review.complete, false);
  assert.equal(review.reasonCode, 'NATIVE_BONSAI_PROJECT_EXPORT_REQUIRED');
  assert.deepEqual(review.coverage, {
    notionProjectInventoryComplete: true,
    bonsaiProjectInventoryComplete: false,
    bonsaiEvidenceScope: 'DISTINCT_PROJECT_TITLES_REFERENCED_BY_COMPLETE_TASK_SNAPSHOT',
    limitation: 'A native complete Bonsai projects export is required to prove project inventory parity.',
  });
  assert.deepEqual(review.summary, {
    notionProjects: 3, bonsaiTaskReferencedProjectTitles: 3, bonsaiProjectlessTasks: 1,
    exactProjectLinks: 1, taskEvidencedProjectAliases: 1, nearTitleTaskProjectCandidates: 0,
    unmatchedNotionProjects: 1, unmatchedBonsaiTaskReferencedProjects: 1, possibleTitlePairs: 0,
  });
  assert.equal(review.taskEvidencedProjectAliases[0].exactSharedTaskCount, 1);
  assert.equal(review.safeguards.inventoryParityClaimed, false);
});

test('rejects a preparation time before source capture', () => {
  const value = input();
  value.preparedAt = '2026-08-27T00:00:00Z';
  assert.throws(() => prepareNotionBonsaiProjectReview(value), /must not predate/);
});

test('CLI creates an owner-only project review and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-bonsai-project-review-'));
  try {
    const { notion, bonsai } = sources();
    const notionPath = path.join(temp, 'notion.json');
    const bonsaiPath = path.join(temp, 'bonsai.json');
    const outputPath = path.join(temp, 'review.json');
    fs.writeFileSync(notionPath, JSON.stringify(notion));
    fs.writeFileSync(bonsaiPath, JSON.stringify(bonsai));
    const args = ['scripts/prepare-notion-bonsai-project-review.mjs', '--notion', notionPath, '--bonsai', bonsaiPath, '--prepared-at', '2026-08-28T01:00:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).format, 'ashbi-notion-bonsai-project-review');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).reasonCode, 'NATIVE_BONSAI_PROJECT_EXPORT_REQUIRED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
