import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NOTION_OPERATING_SOURCE } from '../../services/notionOperatingSnapshot.service.js';
import { prepareNotionBonsaiTaskReview } from '../../services/notionBonsaiTaskReview.service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sources() {
  const projectUrl = 'https://app.notion.com/11111111111111111111111111111111';
  const otherProjectUrl = 'https://app.notion.com/11111111111111111111111111111112';
  const notion = {
    format: 'ashbi-notion-project-task-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T00:33:38.418Z',
    workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: { databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl, hasMore: false, rows: 2 },
      tasks: { databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl, hasMore: false, rows: 3 },
    },
    archivedSources: {
      projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl,
      tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl,
    },
    projects: [
      { url: projectUrl, createdTime: '2026-08-27T12:00:00Z', Project: 'Client Website', Status: 'Active' },
      { url: otherProjectUrl, createdTime: '2026-08-27T12:00:01Z', Project: 'Other Project', Status: 'Active' },
    ],
    tasks: [
      { url: 'https://app.notion.com/22222222222222222222222222222221', createdTime: '2026-08-27T13:00:00Z', Task: 'Review homepage', Status: 'Review', Project: JSON.stringify([projectUrl]) },
      { url: 'https://app.notion.com/22222222222222222222222222222222', createdTime: '2026-08-27T13:00:01Z', Task: 'Verify and complete the security update', Status: 'To do', Project: JSON.stringify([projectUrl]) },
      { url: 'https://app.notion.com/22222222222222222222222222222223', createdTime: '2026-08-27T13:00:02Z', Task: 'Notion only', Status: 'To do', Project: JSON.stringify([otherProjectUrl]) },
    ],
  };
  const bonsai = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T00:24:36.569Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_tasks', pageSize: 100, pagesFetched: 1, finalHasMore: false, taskCount: 4 },
    tasks: [
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f1', title: 'Review homepage', project_id: 123, project_title: 'Client Website Retainer', assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f2', title: 'Verify and complete security update', project_id: 124, project_title: 'Security', assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f3', title: 'Bonsai only', project_id: 125, project_title: 'Legacy', assignee_member_name: null, due_date: null, start_date: null, completed_at: null, archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' } },
      { uuid: '4efb6f56-e0bf-4a31-936c-7a215420f3f4', title: '', project_id: 126, project_title: 'Legacy', assignee_member_name: 'Bianca', due_date: null, start_date: null, completed_at: '2026-08-27T14:00:00Z', archived_at: null, priority: null, task_status: { status: 'Completed', state: 'complete' } },
    ],
  };
  return { notion, bonsai };
}

function input() {
  const { notion, bonsai } = sources();
  return { notionSnapshot: notion, bonsaiSnapshot: bonsai, notionSnapshotSha256: HASH_A, bonsaiSnapshotSha256: HASH_B, preparedAt: '2026-08-28T01:00:00Z' };
}

test('separates exact links, project aliases, near-title candidates, source-only tasks, and owner evidence', () => {
  const review = prepareNotionBonsaiTaskReview(input());
  assert.equal(review.complete, false);
  assert.deepEqual(review.summary, {
    notionTasks: 3, bonsaiTasks: 4, exactTaskLinks: 1, exactTaskLinksReadyForApproval: 0,
    projectAliasCandidates: 1, nearTitleCandidates: 1, notionOnly: 1, bonsaiOnly: 1,
    bonsaiSourceReview: 1, reviewItems: 5,
  });
  assert.equal(review.nearTitleCandidates[0].decisionState, 'REVIEW_REQUIRED');
  assert.deepEqual(review.ownerEvidence.byOwner, [
    { ownerName: 'Bianca', taskCount: 1 },
    { ownerName: 'Cameron', taskCount: 2 },
  ]);
  assert.equal(review.ownerEvidence.unassigned, 1);
  assert.deepEqual(review.safeguards, {
    externalWritesPerformed: false, exactLinksApplied: false, projectAliasesApplied: false,
    ownerAssignmentsApplied: false, fuzzyMatchesApplied: false,
  });
});

test('rejects a preparation time before source capture', () => {
  const value = input();
  value.preparedAt = '2026-08-27T00:00:00Z';
  assert.throws(() => prepareNotionBonsaiTaskReview(value), /must not predate/);
});

test('CLI creates an owner-only review and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-bonsai-review-'));
  try {
    const { notion, bonsai } = sources();
    const notionPath = path.join(temp, 'notion.json');
    const bonsaiPath = path.join(temp, 'bonsai.json');
    const outputPath = path.join(temp, 'review.json');
    fs.writeFileSync(notionPath, JSON.stringify(notion));
    fs.writeFileSync(bonsaiPath, JSON.stringify(bonsai));
    const args = ['scripts/prepare-notion-bonsai-task-review.mjs', '--notion', notionPath, '--bonsai', bonsaiPath, '--prepared-at', '2026-08-28T01:00:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).format, 'ashbi-notion-bonsai-task-review');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).reasonCode, 'HUMAN_RECONCILIATION_REQUIRED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
