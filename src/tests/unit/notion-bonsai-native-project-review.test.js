import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NOTION_OPERATING_SOURCE } from '../../services/notionOperatingSnapshot.service.js';
import { prepareNotionBonsaiNativeProjectReview } from '../../services/notionBonsaiNativeProjectReview.service.js';

const NOTION_HASH = 'a'.repeat(64);
const BONSAI_HASH = 'b'.repeat(64);
const REVIEW_HASH = 'c'.repeat(64);

function sources() {
  const titles = [
    ['Exact Project', 'Active'], ['Alias Project', 'Waiting'], ['Near Project', 'Active'], ['Notion Similar', 'Planning'],
  ];
  const projects = titles.map(([Project, Status], index) => ({
    url: `https://app.notion.com/${String(index + 1).padStart(32, '1')}`,
    createdTime: `2026-08-27T12:00:0${index}Z`, Project, Status,
  }));
  const notion = {
    format: 'ashbi-notion-project-task-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T00:33:38.418Z', workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: { databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl, hasMore: false, rows: 4 },
      tasks: { databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl, hasMore: false, rows: 0 },
    },
    archivedSources: { projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl, tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl },
    projects, tasks: [],
  };
  const rows = [
    [1, 'Exact Project', 'active'], [2, 'Alias Project Retainer', 'active'], [3, 'Near Website', 'completed'],
    [4, 'Notion Similar Service', 'active'], [5, 'Old Work', 'archived'],
  ];
  const bonsai = {
    format: 'bonsai-project-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:12:42.150Z',
    captureEvidence: {
      connector: 'bonsai', operation: 'list_projects', pageSize: 100, allStatusPagesFetched: 1,
      allStatusFinalHasMore: false, projectCount: 5, lifecyclePartitionComplete: true,
      lifecycleQueries: [
        { status: 'active', pagesFetched: 1, finalHasMore: false, projectCount: 3 },
        { status: 'completed', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'archived', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
      ],
    },
    projects: rows.map(([id, title, status]) => ({ id, title, status, public_url_token: `token${id}`, number: `N-${id}`, board_group_id: null, company_name: `Client ${id}`, url: `https://app.hellobonsai.com/projects/token${id}` })),
  };
  const taskReview = {
    format: 'ashbi-notion-bonsai-task-review', version: 1,
    projectAliasCandidates: [{ notionProject: 'Alias Project', bonsaiProject: 'Alias Project Retainer', exactSharedTaskCount: 2, evidence: [{ taskTitle: 'Shared task' }] }],
    nearTitleCandidates: [{ notionProject: 'Near Project', bonsaiProject: 'Near Website', notionSourceId: 'notion-task', bonsaiSourceId: 'bonsai-task', notionTitle: 'Verify all security updates', bonsaiTitle: 'Verify security updates', tokenDiceSimilarity: 0.9 }],
    sourceEvidence: { notionSnapshotSha256: NOTION_HASH },
  };
  return { notion, bonsai, taskReview };
}

function input() {
  const { notion, bonsai, taskReview } = sources();
  return { notionSnapshot: notion, bonsaiProjectSnapshot: bonsai, taskReview, notionSnapshotSha256: NOTION_HASH, bonsaiProjectSnapshotSha256: BONSAI_HASH, taskReviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T02:00:00Z' };
}

test('reconciles the complete native project inventory while preserving decisions and history', () => {
  const review = prepareNotionBonsaiNativeProjectReview(input());
  assert.deepEqual(review.coverage, {
    notionProjectInventoryComplete: true, bonsaiProjectInventoryComplete: true,
    bonsaiLifecyclePartitionComplete: true, taskEvidenceBound: true,
  });
  assert.deepEqual(review.summary, {
    notionProjects: 4, bonsaiProjects: 5, bonsaiByStatus: { active: 3, completed: 1, archived: 1 },
    exactProjectLinks: 1, taskEvidencedProjectCandidates: 2, lifecycleDifferences: 1,
    unmatchedNotionProjects: 1, unmatchedBonsaiProjects: 2,
    unmatchedBonsaiByStatus: { active: 1, completed: 0, archived: 1 },
    possibleTitlePairs: 1, duplicateBonsaiTitles: 0, taskEvidenceFindings: 0,
  });
  assert.equal(review.taskEvidencedProjectCandidates[0].decisionState, 'REVIEW_REQUIRED');
  assert.equal(review.possibleTitlePairs[0].evidence, 'PROJECT_TITLE_SIMILARITY_ONLY');
  assert.equal(review.safeguards.externalWritesPerformed, false);
});

test('rejects task evidence bound to a different Notion source', () => {
  const value = input();
  value.taskReview.sourceEvidence.notionSnapshotSha256 = 'd'.repeat(64);
  assert.throws(() => prepareNotionBonsaiNativeProjectReview(value), /exact Notion snapshot/);
});

test('CLI creates an immutable review and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-project-review-'));
  try {
    const { notion, bonsai, taskReview } = sources();
    const notionPath = path.join(temp, 'notion.json');
    const bonsaiPath = path.join(temp, 'bonsai.json');
    const taskReviewPath = path.join(temp, 'task-review.json');
    const outputPath = path.join(temp, 'review.json');
    fs.writeFileSync(notionPath, JSON.stringify(notion));
    fs.writeFileSync(bonsaiPath, JSON.stringify(bonsai));
    taskReview.sourceEvidence.notionSnapshotSha256 = crypto.createHash('sha256').update(fs.readFileSync(notionPath)).digest('hex');
    fs.writeFileSync(taskReviewPath, JSON.stringify(taskReview));
    const args = ['scripts/prepare-notion-bonsai-native-project-review.mjs', '--notion', notionPath, '--bonsai-projects', bonsaiPath, '--task-review', taskReviewPath, '--prepared-at', '2026-08-28T02:00:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).format, 'ashbi-notion-bonsai-native-project-review');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).reasonCode, 'HUMAN_PROJECT_RECONCILIATION_REQUIRED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
