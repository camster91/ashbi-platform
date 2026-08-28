import { verifyBonsaiProjectSnapshot } from './bonsaiProjectSnapshot.service.js';
import { verifyBonsaiTaskSnapshot } from './bonsaiTaskSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}

function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}

function verifyGroupSnapshot(snapshot) {
  if (snapshot?.format !== 'bonsai-project-group-snapshot' || snapshot?.version !== 1 || snapshot?.complete !== true) return false;
  if (!Number.isFinite(Date.parse(String(snapshot?.capturedAt ?? ''))) || !Array.isArray(snapshot?.groups)) return false;
  const capture = snapshot.captureEvidence;
  if (capture?.connector !== 'bonsai' || capture?.operation !== 'list_board_groups'
    || capture?.resourceType !== 'Project' || capture?.finalHasMore !== false
    || capture?.groupCount !== snapshot.groups.length || capture?.pagesFetched !== 1
    || !Number.isSafeInteger(capture?.pageSize) || capture.pageSize < 1 || capture.pageSize > 100) return false;
  const ids = new Set();
  for (const group of snapshot.groups) {
    if (!text(group?.id) || !text(group?.name) || group?.resource_type !== 'Project'
      || !['active', 'complete'].includes(group?.state) || ids.has(group.id)) return false;
    ids.add(group.id);
  }
  return true;
}

function taskState(task) {
  if (task.archived_at) return 'archived';
  return task.task_status?.state === 'complete' ? 'complete' : 'active';
}

function evidenceMap(review) {
  const map = new Map();
  for (const link of review.exactProjectLinks ?? []) {
    map.set(link.bonsaiProjectId, {
      type: 'EXACT_NOTION_LINK_CANDIDATE',
      notionSourceId: link.notionSourceId,
      notionProject: link.notionProject,
      notionStatus: link.notionStatus,
      evidence: link.evidence,
      decisionState: link.decisionState,
    });
  }
  for (const link of review.taskEvidencedProjectCandidates ?? []) {
    map.set(link.bonsaiProjectId, {
      type: 'TASK_EVIDENCED_LINK_REVIEW',
      notionSourceId: link.notionSourceId,
      notionProject: link.notionProject,
      notionStatus: link.notionStatus,
      evidence: link.evidence,
      decisionState: link.decisionState,
    });
  }
  for (const link of review.possibleTitlePairs ?? []) {
    if (map.has(link.bonsaiProjectId)) continue;
    map.set(link.bonsaiProjectId, {
      type: 'SUGGESTED_NOTION_LINK_REVIEW',
      notionSourceId: link.notionSourceId,
      notionProject: link.notionProject,
      notionStatus: null,
      evidence: link.evidence,
      reviewScore: link.reviewScore,
      decisionState: link.decisionState,
    });
  }
  return map;
}

function triageBucket(evidence, taskCount) {
  if (evidence?.type === 'EXACT_NOTION_LINK_CANDIDATE') return 'PROVEN_EXACT_LINK_REVIEW';
  if (evidence?.type === 'TASK_EVIDENCED_LINK_REVIEW') return 'TASK_EVIDENCED_LINK_REVIEW';
  if (evidence?.type === 'SUGGESTED_NOTION_LINK_REVIEW') return 'SUGGESTED_LINK_REVIEW';
  return taskCount > 0 ? 'ACTIVE_WITH_TASKS_NO_NOTION_LINK' : 'ACTIVE_WITHOUT_TASKS_NO_NOTION_LINK';
}

function nextAction(bucket) {
  const actions = {
    PROVEN_EXACT_LINK_REVIEW: 'VERIFY_LINK_AND_RETAIN_ACTIVE_STATE',
    TASK_EVIDENCED_LINK_REVIEW: 'APPROVE_OR_REJECT_TASK_BACKED_LINK',
    SUGGESTED_LINK_REVIEW: 'APPROVE_OR_REJECT_SUGGESTED_LINK',
    ACTIVE_WITH_TASKS_NO_NOTION_LINK: 'CREATE_OR_SELECT_NOTION_PROJECT_BEFORE_TASK_MIGRATION',
    ACTIVE_WITHOUT_TASKS_NO_NOTION_LINK: 'CONFIRM_CURRENT_WORK_OR_REVIEW_FOR_CLOSURE_AFTER_FINANCIAL_CHECKS',
  };
  return actions[bucket];
}

export function prepareBonsaiActiveProjectTriage({
  bonsaiProjectSnapshot,
  bonsaiTaskSnapshot,
  projectGroupSnapshot,
  nativeProjectReview,
  bonsaiProjectSnapshotSha256,
  bonsaiTaskSnapshotSha256,
  projectGroupSnapshotSha256,
  nativeProjectReviewSha256,
  preparedAt,
}) {
  const projectVerification = verifyBonsaiProjectSnapshot(bonsaiProjectSnapshot);
  const taskVerification = verifyBonsaiTaskSnapshot(bonsaiTaskSnapshot);
  if (!projectVerification.valid) throw new TypeError('A valid complete Bonsai project snapshot is required');
  if (!taskVerification.valid) throw new TypeError('A valid complete Bonsai task snapshot is required');
  if (!verifyGroupSnapshot(projectGroupSnapshot)) throw new TypeError('A valid complete Bonsai project-group snapshot is required');
  if (nativeProjectReview?.format !== 'ashbi-notion-bonsai-native-project-review' || nativeProjectReview?.version !== 1) {
    throw new TypeError('A supported native project review is required');
  }

  const projectHash = sha256(bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256');
  const taskHash = sha256(bonsaiTaskSnapshotSha256, 'bonsaiTaskSnapshotSha256');
  const groupHash = sha256(projectGroupSnapshotSha256, 'projectGroupSnapshotSha256');
  const reviewHash = sha256(nativeProjectReviewSha256, 'nativeProjectReviewSha256');
  if (text(nativeProjectReview?.sourceEvidence?.bonsaiProjectSnapshotSha256).toLowerCase() !== projectHash) {
    throw new TypeError('Native project review must bind the exact Bonsai project snapshot');
  }
  const prepared = timestamp(preparedAt, 'preparedAt');
  const sourceTimes = [
    timestamp(bonsaiProjectSnapshot.capturedAt, 'Bonsai project capturedAt'),
    timestamp(bonsaiTaskSnapshot.capturedAt, 'Bonsai task capturedAt'),
    timestamp(projectGroupSnapshot.capturedAt, 'Bonsai project-group capturedAt'),
    timestamp(nativeProjectReview.preparedAt, 'Native project review preparedAt'),
  ];
  if (sourceTimes.some(value => prepared < value)) throw new TypeError('preparedAt must not predate source evidence');

  const groups = new Map(projectGroupSnapshot.groups.map(group => [group.id, group]));
  const tasksByProject = new Map();
  for (const task of bonsaiTaskSnapshot.tasks) {
    if (!Number.isSafeInteger(task.project_id)) continue;
    tasksByProject.set(task.project_id, [...(tasksByProject.get(task.project_id) ?? []), task]);
  }
  const duplicateTitleIds = new Set((nativeProjectReview.duplicateBonsaiTitles ?? [])
    .flatMap(group => group.projects ?? []).map(project => project.id));
  const evidence = evidenceMap(nativeProjectReview);
  const activeProjects = bonsaiProjectSnapshot.projects.filter(project => project.status === 'active');
  const records = activeProjects.map(project => {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    const stateCounts = { active: 0, complete: 0, archived: 0 };
    for (const task of projectTasks) stateCounts[taskState(task)] += 1;
    const linkEvidence = evidence.get(project.id) ?? null;
    const bucket = triageBucket(linkEvidence, projectTasks.length);
    const group = groups.get(project.board_group_id) ?? null;
    return {
      bonsaiProjectId: project.id,
      project: project.title,
      company: project.company_name,
      url: project.url,
      projectGroup: group ? { id: group.id, name: group.name, state: group.state } : null,
      taskEvidence: {
        total: projectTasks.length,
        byState: stateCounts,
        taskSourceIds: projectTasks.map(task => task.uuid),
      },
      notionEvidence: linkEvidence,
      duplicateTitleGroup: duplicateTitleIds.has(project.id),
      triageBucket: bucket,
      recommendedNextAction: nextAction(bucket),
      financialSafety: {
        invoicesChecked: false,
        paymentsChecked: false,
        contractsChecked: false,
        timeEntriesChecked: false,
        closureAuthorized: false,
      },
      decisionState: 'REVIEW_REQUIRED',
    };
  });
  const bucketNames = [
    'PROVEN_EXACT_LINK_REVIEW', 'TASK_EVIDENCED_LINK_REVIEW', 'SUGGESTED_LINK_REVIEW',
    'ACTIVE_WITH_TASKS_NO_NOTION_LINK', 'ACTIVE_WITHOUT_TASKS_NO_NOTION_LINK',
  ];
  const byBucket = Object.fromEntries(bucketNames.map(bucket => [bucket, records.filter(record => record.triageBucket === bucket).length]));
  const byGroup = Object.fromEntries(projectGroupSnapshot.groups.map(group => [group.name, records.filter(record => record.projectGroup?.id === group.id).length]));
  const referencedTaskIds = new Set(records.flatMap(record => record.taskEvidence.taskSourceIds));

  return {
    format: 'ashbi-bonsai-active-project-triage',
    version: 1,
    complete: false,
    reasonCode: 'HUMAN_ACTIVE_PROJECT_TRIAGE_REQUIRED',
    preparedAt: new Date(prepared).toISOString(),
    summary: {
      activeProjects: records.length,
      byBucket,
      byProjectGroup: byGroup,
      projectsWithCurrentTaskEvidence: records.filter(record => record.taskEvidence.total > 0).length,
      projectsWithoutCurrentTaskEvidence: records.filter(record => record.taskEvidence.total === 0).length,
      tasksAttachedToActiveProjects: referencedTaskIds.size,
      sourceTasksOutsideActiveProjects: bonsaiTaskSnapshot.tasks.length - referencedTaskIds.size,
      activeDuplicateTitleRecords: records.filter(record => record.duplicateTitleGroup).length,
    },
    records,
    safeguards: {
      externalWritesPerformed: false,
      linksApplied: false,
      projectsCreated: false,
      projectsArchivedOrCompleted: false,
      tasksMoved: false,
      financialEvidenceChecked: false,
      closureAuthorized: false,
    },
    sourceEvidence: {
      bonsaiProjectSnapshotSha256: projectHash,
      bonsaiProjectCapturedAt: new Date(sourceTimes[0]).toISOString(),
      bonsaiTaskSnapshotSha256: taskHash,
      bonsaiTaskCapturedAt: new Date(sourceTimes[1]).toISOString(),
      projectGroupSnapshotSha256: groupHash,
      projectGroupCapturedAt: new Date(sourceTimes[2]).toISOString(),
      nativeProjectReviewSha256: reviewHash,
      nativeProjectReviewPreparedAt: new Date(sourceTimes[3]).toISOString(),
    },
  };
}
