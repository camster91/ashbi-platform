import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareBonsaiActiveProjectTriage } from '../../services/bonsaiActiveProjectTriage.service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const GROUP_ID = 'fa6948cd-4ef5-4b0e-8e6f-844c6529dc1d';

function sources() {
  const projects = [1, 2, 3, 4, 5, 6].map(id => ({
    id, title: `Project ${id}`, public_url_token: `token${id}`, number: `P-${id}`,
    board_group_id: GROUP_ID, company_name: `Client ${id}`,
    url: `https://app.hellobonsai.com/projects/token${id}`,
    status: id === 6 ? 'completed' : 'active',
  }));
  const projectSnapshot = {
    format: 'bonsai-project-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:12:42.150Z', projects,
    captureEvidence: {
      connector: 'bonsai', operation: 'list_projects', pageSize: 100, allStatusPagesFetched: 1,
      allStatusFinalHasMore: false, projectCount: 6, lifecyclePartitionComplete: true,
      lifecycleQueries: [
        { status: 'active', pagesFetched: 1, finalHasMore: false, projectCount: 5 },
        { status: 'completed', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'archived', pagesFetched: 1, finalHasMore: false, projectCount: 0 },
      ],
    },
  };
  const task = (uuid, projectId) => ({
    uuid, title: `Task ${projectId}`, project_id: projectId, project_title: `Project ${projectId}`,
    assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null,
    archived_at: null, priority: null, task_status: { status: 'To Do', state: 'active' },
  });
  const taskSnapshot = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:24:53.215Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_tasks', pageSize: 100, pagesFetched: 1, finalHasMore: false, taskCount: 2 },
    tasks: [task('4efb6f56-e0bf-4a31-936c-7a215420f3f4', 4), task('4efb6f56-e0bf-4a31-936c-7a215420f3f6', 6)],
  };
  const groupSnapshot = {
    format: 'bonsai-project-group-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T01:24:53.215Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_board_groups', resourceType: 'Project', pageSize: 100, pagesFetched: 1, finalHasMore: false, groupCount: 1 },
    groups: [{ id: GROUP_ID, name: 'In Progress', color: '#000000', position: 1, state: 'active', deal_probability: '100.0', resource_type: 'Project' }],
  };
  const link = (id, evidence, decisionState = 'REVIEW_REQUIRED') => ({
    bonsaiProjectId: id, notionSourceId: `notion-${id}`, notionProject: `Notion ${id}`,
    notionStatus: 'Active', evidence, decisionState,
  });
  const nativeReview = {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1,
    preparedAt: '2026-08-28T01:25:00Z',
    exactProjectLinks: [link(1, 'EXACT_UNIQUE_PROJECT_TITLE', 'EXACT_LINK_CANDIDATE')],
    taskEvidencedProjectCandidates: [link(2, 'EXACT_SHARED_TASKS')],
    possibleTitlePairs: [{ ...link(3, 'PROJECT_TITLE_SIMILARITY_ONLY'), reviewScore: 0.8 }],
    duplicateBonsaiTitles: [{ title: 'Project 5', projects: [{ id: 5 }] }],
    sourceEvidence: { bonsaiProjectSnapshotSha256: HASH_A },
  };
  return { projectSnapshot, taskSnapshot, groupSnapshot, nativeReview };
}

function input() {
  const { projectSnapshot, taskSnapshot, groupSnapshot, nativeReview } = sources();
  return {
    bonsaiProjectSnapshot: projectSnapshot, bonsaiTaskSnapshot: taskSnapshot,
    projectGroupSnapshot: groupSnapshot, nativeProjectReview: nativeReview,
    bonsaiProjectSnapshotSha256: HASH_A, bonsaiTaskSnapshotSha256: HASH_B,
    projectGroupSnapshotSha256: HASH_C, nativeProjectReviewSha256: HASH_D,
    preparedAt: '2026-08-28T01:30:00Z',
  };
}

test('classifies every active project without authorizing closure or migration', () => {
  const triage = prepareBonsaiActiveProjectTriage(input());
  assert.deepEqual(triage.summary, {
    activeProjects: 5,
    byBucket: {
      PROVEN_EXACT_LINK_REVIEW: 1, TASK_EVIDENCED_LINK_REVIEW: 1,
      SUGGESTED_LINK_REVIEW: 1, ACTIVE_WITH_TASKS_NO_NOTION_LINK: 1,
      ACTIVE_WITHOUT_TASKS_NO_NOTION_LINK: 1,
    },
    byProjectGroup: { 'In Progress': 5 },
    projectsWithCurrentTaskEvidence: 1, projectsWithoutCurrentTaskEvidence: 4,
    tasksAttachedToActiveProjects: 1, sourceTasksOutsideActiveProjects: 1,
    activeDuplicateTitleRecords: 1,
  });
  assert.equal(triage.records.every(record => record.financialSafety.closureAuthorized === false), true);
  assert.equal(triage.safeguards.projectsArchivedOrCompleted, false);
  assert.equal(triage.complete, false);
});

test('rejects a project review bound to a different project snapshot', () => {
  const value = input();
  value.nativeProjectReview.sourceEvidence.bonsaiProjectSnapshotSha256 = 'e'.repeat(64);
  assert.throws(() => prepareBonsaiActiveProjectTriage(value), /exact Bonsai project snapshot/);
});

test('CLI creates an immutable triage packet and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-active-triage-'));
  try {
    const { projectSnapshot, taskSnapshot, groupSnapshot, nativeReview } = sources();
    const projectPath = path.join(temp, 'projects.json');
    const taskPath = path.join(temp, 'tasks.json');
    const groupPath = path.join(temp, 'groups.json');
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'triage.json');
    fs.writeFileSync(projectPath, JSON.stringify(projectSnapshot));
    fs.writeFileSync(taskPath, JSON.stringify(taskSnapshot));
    fs.writeFileSync(groupPath, JSON.stringify(groupSnapshot));
    nativeReview.sourceEvidence.bonsaiProjectSnapshotSha256 = crypto.createHash('sha256').update(fs.readFileSync(projectPath)).digest('hex');
    fs.writeFileSync(reviewPath, JSON.stringify(nativeReview));
    const args = ['scripts/prepare-bonsai-active-project-triage.mjs', '--bonsai-projects', projectPath, '--bonsai-tasks', taskPath, '--project-groups', groupPath, '--native-project-review', reviewPath, '--prepared-at', '2026-08-28T01:30:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).format, 'ashbi-bonsai-active-project-triage');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).reasonCode, 'HUMAN_ACTIVE_PROJECT_TRIAGE_REQUIRED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
