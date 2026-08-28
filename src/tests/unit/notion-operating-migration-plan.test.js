import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTION_OPERATING_SOURCE } from '../../services/notionOperatingSnapshot.service.js';
import { prepareNotionBonsaiTaskReview } from '../../services/notionBonsaiTaskReview.service.js';
import { prepareNotionBonsaiTaskLinkDecision } from '../../services/notionBonsaiTaskLinkDecision.service.js';
import { prepareNotionBonsaiTaskDispositionDecision } from '../../services/notionBonsaiTaskDispositionDecision.service.js';
import { prepareNotionBonsaiNativeProjectReview } from '../../services/notionBonsaiNativeProjectReview.service.js';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import { prepareNotionBonsaiProjectDispositionDecision } from '../../services/notionBonsaiProjectDispositionDecision.service.js';
import { prepareNotionOperatingMigrationPlan, verifyNotionOperatingMigrationPlan } from '../../services/notionOperatingMigrationPlan.service.js';

const HASH = Object.freeze({
  notion: '1'.repeat(64), bonsaiTasks: '2'.repeat(64), bonsaiProjects: '3'.repeat(64),
  taskReview: '4'.repeat(64), taskLink: '5'.repeat(64), taskDisposition: '6'.repeat(64),
  projectReview: '7'.repeat(64), projectLink: '8'.repeat(64), projectDisposition: '9'.repeat(64),
});
const ORG = 'org-sandbox';
const LINKED_PROJECT = 'https://app.notion.com/11111111111111111111111111111111';
const INTERNAL_PROJECT = 'https://app.notion.com/11111111111111111111111111111112';
const LINKED_TASK = 'https://app.notion.com/22222222222222222222222222222221';
const INTERNAL_TASK = 'https://app.notion.com/22222222222222222222222222222222';
const BONSAI_TASK = '4efb6f56-e0bf-4a31-936c-7a215420f3f1';

function sources() {
  const notionSnapshot = {
    format: 'ashbi-notion-project-task-snapshot', version: 1, complete: true,
    capturedAt: '2026-08-28T00:00:00.000Z', workspaceHub: { pageId: NOTION_OPERATING_SOURCE.hubPageId },
    sources: {
      projects: { databaseId: NOTION_OPERATING_SOURCE.projectsDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.projectsDataSourceUrl, hasMore: false, rows: 2 },
      tasks: { databaseId: NOTION_OPERATING_SOURCE.tasksDatabaseId, dataSourceUrl: NOTION_OPERATING_SOURCE.tasksDataSourceUrl, hasMore: false, rows: 2 },
    },
    archivedSources: { projectsDataSourceUrl: NOTION_OPERATING_SOURCE.archivedProjectsDataSourceUrl, tasksDataSourceUrl: NOTION_OPERATING_SOURCE.archivedTasksDataSourceUrl },
    projects: [
      { url: LINKED_PROJECT, createdTime: '2026-08-27T12:00:00.000Z', Project: 'Client Website', Status: 'Active' },
      { url: INTERNAL_PROJECT, createdTime: '2026-08-27T12:01:00.000Z', Project: 'Ashbi Growth', Status: 'Planning' },
    ],
    tasks: [
      { url: LINKED_TASK, createdTime: '2026-08-27T13:00:00.000Z', Task: 'Review homepage', Status: 'Review', Project: JSON.stringify([LINKED_PROJECT]) },
      { url: INTERNAL_TASK, createdTime: '2026-08-27T13:01:00.000Z', Task: 'Publish service page', Status: 'To do', Project: JSON.stringify([INTERNAL_PROJECT]) },
    ],
  };
  const bonsaiTaskSnapshot = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T00:05:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_tasks', pageSize: 100, pagesFetched: 1, finalHasMore: false, taskCount: 1 },
    tasks: [{ uuid: BONSAI_TASK, title: 'Review homepage', project_id: 101, project_title: 'Client Website',
      assignee_member_name: 'Cameron', due_date: null, start_date: null, completed_at: null, archived_at: null,
      priority: null, task_status: { status: 'To Do', state: 'active' } }],
  };
  const bonsaiProjectSnapshot = {
    format: 'bonsai-project-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T00:06:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_projects', pageSize: 100, allStatusPagesFetched: 1,
      allStatusFinalHasMore: false, projectCount: 1, lifecyclePartitionComplete: true,
      lifecycleQueries: [{ status: 'active', pagesFetched: 1, finalHasMore: false, projectCount: 1 },
        { status: 'completed', pagesFetched: 1, finalHasMore: false, projectCount: 0 },
        { status: 'archived', pagesFetched: 1, finalHasMore: false, projectCount: 0 }] },
    projects: [{ id: 101, title: 'Client Website', status: 'active', public_url_token: 'clientsite', number: 'P-101',
      board_group_id: null, company_name: 'Client', url: 'https://app.hellobonsai.com/projects/clientsite' }],
  };
  return { notionSnapshot, bonsaiTaskSnapshot, bonsaiProjectSnapshot };
}

function packets({ approved = true } = {}) {
  const source = sources();
  const taskReview = prepareNotionBonsaiTaskReview({ notionSnapshot: source.notionSnapshot,
    bonsaiSnapshot: source.bonsaiTaskSnapshot, notionSnapshotSha256: HASH.notion,
    bonsaiSnapshotSha256: HASH.bonsaiTasks, preparedAt: '2026-08-28T00:10:00.000Z' });
  const pendingTaskLink = prepareNotionBonsaiTaskLinkDecision({ review: taskReview, reviewSha256: HASH.taskReview,
    preparedAt: '2026-08-28T00:11:00.000Z' });
  const taskLinkDecision = approved ? prepareNotionBonsaiTaskLinkDecision({ review: taskReview, reviewSha256: HASH.taskReview,
    preparedAt: '2026-08-28T00:12:00.000Z', decisions: pendingTaskLink.candidates.map(item => ({ candidateId: item.candidateId, decision: 'APPROVED' })),
    approver: 'Cameron', decidedAt: '2026-08-28T00:11:30.000Z', reference: 'task-link-review' }) : pendingTaskLink;
  const pendingTaskDisposition = prepareNotionBonsaiTaskDispositionDecision({ review: taskReview, reviewSha256: HASH.taskReview,
    taskLinkDecision, taskLinkDecisionSha256: HASH.taskLink, preparedAt: '2026-08-28T00:13:00.000Z' });
  const taskDispositionDecision = approved ? prepareNotionBonsaiTaskDispositionDecision({ review: taskReview, reviewSha256: HASH.taskReview,
    taskLinkDecision, taskLinkDecisionSha256: HASH.taskLink, preparedAt: '2026-08-28T00:14:00.000Z',
    decisions: pendingTaskDisposition.candidates.map(item => item.sourceKind === 'NOTION_TASK' && item.notionSourceId === INTERNAL_TASK
      ? { candidateId: item.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current internal work', reference: 'task-row-2' }
      : { candidateId: item.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK', rationale: 'Same task', reference: 'task-link-review', taskLinkCandidateId: item.linkedCandidateIds[0] }),
    approver: 'Cameron', decidedAt: '2026-08-28T00:13:30.000Z', reference: 'task-disposition-review' }) : pendingTaskDisposition;

  const nativeProjectReview = prepareNotionBonsaiNativeProjectReview({ notionSnapshot: source.notionSnapshot,
    bonsaiProjectSnapshot: source.bonsaiProjectSnapshot, taskReview, notionSnapshotSha256: HASH.notion,
    bonsaiProjectSnapshotSha256: HASH.bonsaiProjects, taskReviewSha256: HASH.taskReview,
    preparedAt: '2026-08-28T00:15:00.000Z' });
  const pendingProjectLink = prepareNotionBonsaiNativeProjectLinkDecision({ review: nativeProjectReview,
    reviewSha256: HASH.projectReview, preparedAt: '2026-08-28T00:16:00.000Z' });
  const projectLinkDecision = approved ? prepareNotionBonsaiNativeProjectLinkDecision({ review: nativeProjectReview,
    reviewSha256: HASH.projectReview, preparedAt: '2026-08-28T00:17:00.000Z',
    decisions: pendingProjectLink.candidates.map(item => ({ candidateId: item.candidateId, decision: 'APPROVED' })),
    approver: 'Cameron', decidedAt: '2026-08-28T00:16:30.000Z', reference: 'project-link-review' }) : pendingProjectLink;
  const pendingProjectDisposition = prepareNotionBonsaiProjectDispositionDecision({ review: nativeProjectReview,
    reviewSha256: HASH.projectReview, projectLinkDecision, projectLinkDecisionSha256: HASH.projectLink,
    preparedAt: '2026-08-28T00:18:00.000Z' });
  const projectDispositionDecision = approved ? prepareNotionBonsaiProjectDispositionDecision({ review: nativeProjectReview,
    reviewSha256: HASH.projectReview, projectLinkDecision, projectLinkDecisionSha256: HASH.projectLink,
    preparedAt: '2026-08-28T00:19:00.000Z',
    decisions: pendingProjectDisposition.candidates.map(item => item.sourceKind === 'NOTION_PROJECT' && item.notionSourceId === INTERNAL_PROJECT
      ? { candidateId: item.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Ashbi operating project', reference: 'project-row-2' }
      : { candidateId: item.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK', rationale: 'Same project', reference: 'project-link-review', projectLinkCandidateId: item.linkedCandidateIds[0] }),
    approver: 'Cameron', decidedAt: '2026-08-28T00:18:30.000Z', reference: 'project-disposition-review' }) : pendingProjectDisposition;
  return { ...source, taskReview, taskLinkDecision, taskDispositionDecision, nativeProjectReview, projectLinkDecision, projectDispositionDecision };
}

function input(options = {}) {
  const packet = packets(options);
  return { ...packet, organizationId: ORG, notionSnapshotSha256: HASH.notion,
    taskReviewSha256: HASH.taskReview, taskLinkDecisionSha256: HASH.taskLink,
    taskDispositionDecisionSha256: HASH.taskDisposition, nativeProjectReviewSha256: HASH.projectReview,
    projectLinkDecisionSha256: HASH.projectLink, projectDispositionDecisionSha256: HASH.projectDisposition,
    preparedAt: '2026-08-28T00:20:00.000Z', notionProjectBindings: { [INTERNAL_PROJECT]: { clientId: 'client-ashbi', status: 'STARTING_UP' } },
    existingSourceRecords: [
      { organizationId: ORG, sourceSystem: 'BONSAI', entityType: 'PROJECT', sourceId: '101', destinationId: 'project-client', outcome: 'IMPORTED', sourceFingerprint: HASH.bonsaiProjects },
      { organizationId: ORG, sourceSystem: 'BONSAI', entityType: 'TASK', sourceId: BONSAI_TASK, destinationId: 'task-client', outcome: 'IMPORTED', sourceFingerprint: HASH.bonsaiTasks },
    ],
    destinationClients: [{ id: 'client-client', organizationId: ORG }, { id: 'client-ashbi', organizationId: ORG }],
    destinationProjects: [{ id: 'project-client', organizationId: ORG, clientId: 'client-client', name: 'Client Website', status: 'DESIGN_DEV' }],
    destinationTasks: [{ id: 'task-client', organizationId: ORG, projectId: 'project-client', title: 'Review homepage', status: 'PENDING' }],
  };
}

test('blocks the plan while source identity and disposition decisions remain pending', () => {
  const plan = prepareNotionOperatingMigrationPlan(input({ approved: false }));
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.findings.some(item => item.code === 'PENDING_PROJECT_LINK_DECISIONS'));
  assert.ok(plan.findings.some(item => item.code === 'PENDING_TASK_DISPOSITIONS'));
});

test('plans linked aliases and one Notion-only project/task without duplicate creates', () => {
  const plan = prepareNotionOperatingMigrationPlan(input());
  assert.equal(plan.status, 'READY', JSON.stringify(plan.findings));
  assert.deepEqual(plan.summary, { actions: 6, createProjects: 1, createTasks: 1, registerProjectSources: 2, registerTaskSources: 2, findings: 0 });
  assert.equal(plan.actions.find(item => item.kind === 'REGISTER_PROJECT_SOURCE' && item.sourceId === LINKED_PROJECT).destinationId, 'project-client');
  assert.equal(plan.actions.find(item => item.kind === 'REGISTER_TASK_SOURCE' && item.sourceId === LINKED_TASK).destinationId, 'task-client');
  const createdProject = plan.actions.find(item => item.kind === 'CREATE_PROJECT');
  const createdTask = plan.actions.find(item => item.kind === 'CREATE_TASK');
  assert.equal(createdProject.values.clientId, 'client-ashbi');
  assert.equal(createdTask.projectRef, createdProject.actionId);
  assert.equal(plan.safeguards.externalWritesPerformed, false);
});

test('requires an explicit client and Hub lifecycle for every Notion-only project', () => {
  const value = input();
  value.notionProjectBindings = {};
  const plan = prepareNotionOperatingMigrationPlan(value);
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.findings.some(item => item.code === 'NOTION_PROJECT_BINDING_REQUIRED' && item.sourceId === INTERNAL_PROJECT));
});

test('rejects a linked task whose proven Bonsai destination belongs to another project', () => {
  const value = input();
  value.destinationProjects.push({ id: 'project-wrong', organizationId: ORG, clientId: 'client-client', name: 'Wrong', status: 'DESIGN_DEV' });
  value.destinationTasks[0].projectId = 'project-wrong';
  const plan = prepareNotionOperatingMigrationPlan(value);
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.findings.some(item => item.code === 'LINKED_TASK_PROJECT_MISMATCH'));
});

test('an exact rerun reuses all four destination records and plans no writes', () => {
  const value = input();
  value.destinationProjects.push({ id: 'project-ashbi', organizationId: ORG, clientId: 'client-ashbi', name: 'Ashbi Growth', status: 'STARTING_UP' });
  value.destinationTasks.push({ id: 'task-ashbi', organizationId: ORG, projectId: 'project-ashbi', title: 'Publish service page', status: 'PENDING' });
  value.existingSourceRecords.push(
    { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'PROJECT', sourceId: LINKED_PROJECT, destinationId: 'project-client', outcome: 'LINKED', sourceFingerprint: HASH.notion },
    { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'PROJECT', sourceId: INTERNAL_PROJECT, destinationId: 'project-ashbi', outcome: 'IMPORTED', sourceFingerprint: HASH.notion },
    { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'TASK', sourceId: LINKED_TASK, destinationId: 'task-client', outcome: 'LINKED', sourceFingerprint: HASH.notion },
    { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'TASK', sourceId: INTERNAL_TASK, destinationId: 'task-ashbi', outcome: 'IMPORTED', sourceFingerprint: HASH.notion },
  );
  const plan = prepareNotionOperatingMigrationPlan(value);
  assert.equal(plan.status, 'READY', JSON.stringify(plan.findings));
  assert.equal(plan.actions.length, 0);
});

test('verification recomputes the exact plan and rejects a changed destination', () => {
  const value = input();
  const record = prepareNotionOperatingMigrationPlan(value);
  assert.deepEqual(verifyNotionOperatingMigrationPlan({ ...value, record }), {
    valid: true, ready: true, actions: 6, findings: [],
  });
  record.actions.find(item => item.destinationId === 'task-client').destinationId = 'task-other';
  assert.deepEqual(verifyNotionOperatingMigrationPlan({ ...value, record }), {
    valid: false, ready: false, actions: 0, findings: ['PLAN_MISMATCH'],
  });
});
