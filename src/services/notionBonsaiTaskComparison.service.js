import { verifyBonsaiTaskSnapshot } from './bonsaiTaskSnapshot.service.js';
import { verifyNotionOperatingSnapshot } from './notionOperatingSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
}
function normalized(value) {
  return text(value).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}

function grouped(rows, titleFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalized(titleFor(row));
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function notionProjectName(task, projectByUrl) {
  try {
    const relation = JSON.parse(task.Project);
    return Array.isArray(relation) && relation.length === 1
      ? projectByUrl.get(relation[0])?.Project ?? null
      : null;
  } catch {
    return null;
  }
}

function notionComplete(task) {
  return task.Status === 'Done';
}

function bonsaiComplete(task) {
  return Boolean(task.completed_at) || task.task_status?.state === 'complete';
}

export function compareNotionBonsaiTasks({
  notionSnapshot,
  bonsaiSnapshot,
  notionSnapshotSha256,
  bonsaiSnapshotSha256,
  completedAt,
}) {
  const notionVerification = verifyNotionOperatingSnapshot(notionSnapshot);
  const bonsaiVerification = verifyBonsaiTaskSnapshot(bonsaiSnapshot);
  if (!notionVerification.valid) throw new TypeError('A valid current Notion operating snapshot is required');
  if (!bonsaiVerification.valid) throw new TypeError('A valid complete Bonsai task snapshot is required');
  const completed = timestamp(completedAt, 'completedAt');
  const notionCaptured = timestamp(notionSnapshot.capturedAt, 'Notion capturedAt');
  const bonsaiCaptured = timestamp(bonsaiSnapshot.capturedAt, 'Bonsai capturedAt');
  if (completed < notionCaptured || completed < bonsaiCaptured) {
    throw new TypeError('completedAt must not predate either source snapshot');
  }

  const notionTasks = notionSnapshot.tasks;
  const bonsaiTasks = bonsaiSnapshot.tasks;
  const notionGroups = grouped(notionTasks, task => task.Task);
  const bonsaiGroups = grouped(bonsaiTasks, task => task.title);
  const projectByUrl = new Map(notionSnapshot.projects.map(project => [project.url, project]));
  const findings = bonsaiVerification.migrationFindings.map(finding => ({
    code: 'BONSAI_SOURCE_REVIEW_REQUIRED',
    sourceId: finding.taskUuid,
    fields: finding.fields,
  }));
  let exactTitleMatches = 0;
  let exactProjectTitleMatches = 0;
  let lifecycleMatches = 0;

  for (const notionTask of notionTasks) {
    const key = normalized(notionTask.Task);
    const matches = bonsaiGroups.get(key) ?? [];
    if (matches.length !== 1) {
      findings.push({
        code: 'NOTION_TASK_MISSING_IN_BONSAI',
        sourceId: notionTask.url,
        taskTitle: notionTask.Task,
      });
      continue;
    }
    exactTitleMatches += 1;
    const bonsaiTask = matches[0];
    const notionProject = notionProjectName(notionTask, projectByUrl);
    if (normalized(notionProject) === normalized(bonsaiTask.project_title)) {
      exactProjectTitleMatches += 1;
    } else {
      findings.push({
        code: 'TASK_PROJECT_TITLE_MISMATCH',
        notionSourceId: notionTask.url,
        bonsaiSourceId: bonsaiTask.uuid,
        notionProject,
        bonsaiProject: bonsaiTask.project_title ?? null,
      });
    }
    if (notionComplete(notionTask) === bonsaiComplete(bonsaiTask)) {
      lifecycleMatches += 1;
    } else {
      findings.push({
        code: 'TASK_LIFECYCLE_MISMATCH',
        notionSourceId: notionTask.url,
        bonsaiSourceId: bonsaiTask.uuid,
        notionStatus: notionTask.Status,
        bonsaiState: bonsaiTask.task_status?.state ?? null,
      });
    }
  }

  for (const bonsaiTask of bonsaiTasks) {
    const key = normalized(bonsaiTask.title);
    if ((notionGroups.get(key) ?? []).length !== 1) {
      findings.push({
        code: 'BONSAI_TASK_MISSING_IN_NOTION',
        sourceId: bonsaiTask.uuid,
        taskTitle: bonsaiTask.title,
      });
    }
  }

  return {
    format: 'ashbi-notion-bonsai-task-comparison',
    version: 1,
    complete: findings.length === 0,
    completedAt: new Date(completed).toISOString(),
    summary: {
      notionTasks: notionTasks.length,
      bonsaiTasks: bonsaiTasks.length,
      exactTitleMatches,
      exactProjectTitleMatches,
      lifecycleMatches,
      notionOnlyTasks: findings.filter(finding => finding.code === 'NOTION_TASK_MISSING_IN_BONSAI').length,
      bonsaiOnlyTasks: findings.filter(finding => finding.code === 'BONSAI_TASK_MISSING_IN_NOTION').length,
      unresolvedFindings: findings.length,
    },
    findings,
    sourceEvidence: {
      notionSnapshotSha256: sha256(notionSnapshotSha256, 'notionSnapshotSha256'),
      notionCapturedAt: new Date(notionCaptured).toISOString(),
      bonsaiSnapshotSha256: sha256(bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      bonsaiCapturedAt: new Date(bonsaiCaptured).toISOString(),
    },
  };
}
