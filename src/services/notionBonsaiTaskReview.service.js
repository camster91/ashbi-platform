import { verifyBonsaiTaskSnapshot } from './bonsaiTaskSnapshot.service.js';
import { verifyNotionOperatingSnapshot } from './notionOperatingSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function titleTokens(value) {
  return new Set(normalized(value).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean));
}

function tokenDice(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return (2 * shared) / (leftTokens.size + rightTokens.size);
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

function grouped(rows, titleFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalized(titleFor(row));
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function notionProject(task, projectByUrl) {
  try {
    const relation = JSON.parse(task.Project);
    return Array.isArray(relation) && relation.length === 1 ? projectByUrl.get(relation[0]) ?? null : null;
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

function ownerSummary(tasks) {
  const counts = new Map();
  const unassignedSourceIds = [];
  for (const task of tasks) {
    const owner = text(task.assignee_member_name);
    if (!owner) unassignedSourceIds.push(task.uuid);
    else counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return {
    source: 'Bonsai assignee_member_name',
    assigned: tasks.length - unassignedSourceIds.length,
    unassigned: unassignedSourceIds.length,
    byOwner: [...counts.entries()]
      .map(([ownerName, taskCount]) => ({ ownerName, taskCount }))
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
    unassignedSourceIds,
    decisionState: 'SOURCE_EVIDENCE_ONLY',
  };
}

export function prepareNotionBonsaiTaskReview({
  notionSnapshot,
  bonsaiSnapshot,
  notionSnapshotSha256,
  bonsaiSnapshotSha256,
  preparedAt,
}) {
  const notionVerification = verifyNotionOperatingSnapshot(notionSnapshot);
  const bonsaiVerification = verifyBonsaiTaskSnapshot(bonsaiSnapshot);
  if (!notionVerification.valid) throw new TypeError('A valid current Notion operating snapshot is required');
  if (!bonsaiVerification.valid) throw new TypeError('A valid complete Bonsai task snapshot is required');

  const prepared = timestamp(preparedAt, 'preparedAt');
  const notionCaptured = timestamp(notionSnapshot.capturedAt, 'Notion capturedAt');
  const bonsaiCaptured = timestamp(bonsaiSnapshot.capturedAt, 'Bonsai capturedAt');
  if (prepared < notionCaptured || prepared < bonsaiCaptured) {
    throw new TypeError('preparedAt must not predate either source snapshot');
  }

  const notionGroups = grouped(notionSnapshot.tasks, task => task.Task);
  const bonsaiGroups = grouped(bonsaiSnapshot.tasks, task => task.title);
  const projectByUrl = new Map(notionSnapshot.projects.map(project => [project.url, project]));
  const exactTaskLinks = [];
  const projectAliasGroups = new Map();
  const matchedNotion = new Set();
  const matchedBonsai = new Set();

  for (const notionTask of notionSnapshot.tasks) {
    const key = normalized(notionTask.Task);
    const bonsaiMatches = bonsaiGroups.get(key) ?? [];
    const notionMatches = notionGroups.get(key) ?? [];
    if (notionMatches.length !== 1 || bonsaiMatches.length !== 1) continue;
    const bonsaiTask = bonsaiMatches[0];
    const project = notionProject(notionTask, projectByUrl);
    const projectTitleMatch = normalized(project?.Project) === normalized(bonsaiTask.project_title);
    const lifecycleMatch = notionComplete(notionTask) === bonsaiComplete(bonsaiTask);
    exactTaskLinks.push({
      taskTitle: notionTask.Task,
      notionSourceId: notionTask.url,
      bonsaiSourceId: bonsaiTask.uuid,
      notionProject: project?.Project ?? null,
      bonsaiProject: bonsaiTask.project_title ?? null,
      projectTitleMatch,
      lifecycleMatch,
      bonsaiOwner: bonsaiTask.assignee_member_name ?? null,
      decisionState: projectTitleMatch && lifecycleMatch ? 'EXACT_LINK_CANDIDATE' : 'REVIEW_REQUIRED',
    });
    matchedNotion.add(notionTask.url);
    matchedBonsai.add(bonsaiTask.uuid);

    if (!projectTitleMatch) {
      const aliasKey = `${normalized(project?.Project)}\u0000${normalized(bonsaiTask.project_title)}`;
      const group = projectAliasGroups.get(aliasKey) ?? {
        notionProject: project?.Project ?? null,
        bonsaiProject: bonsaiTask.project_title ?? null,
        exactSharedTaskCount: 0,
        evidence: [],
        decisionState: 'REVIEW_REQUIRED',
      };
      group.exactSharedTaskCount += 1;
      group.evidence.push({ notionSourceId: notionTask.url, bonsaiSourceId: bonsaiTask.uuid, taskTitle: notionTask.Task });
      projectAliasGroups.set(aliasKey, group);
    }
  }

  const unmatchedNotion = notionSnapshot.tasks.filter(task => !matchedNotion.has(task.url));
  const unmatchedBonsai = bonsaiSnapshot.tasks.filter(task => !matchedBonsai.has(task.uuid));
  const nearTitleCandidates = [];
  for (const notionTask of unmatchedNotion) {
    for (const bonsaiTask of unmatchedBonsai) {
      const similarity = tokenDice(notionTask.Task, bonsaiTask.title);
      if (similarity < 0.9) continue;
      const project = notionProject(notionTask, projectByUrl);
      nearTitleCandidates.push({
        notionSourceId: notionTask.url,
        bonsaiSourceId: bonsaiTask.uuid,
        notionTitle: notionTask.Task,
        bonsaiTitle: bonsaiTask.title,
        tokenDiceSimilarity: Number(similarity.toFixed(6)),
        notionProject: project?.Project ?? null,
        bonsaiProject: bonsaiTask.project_title ?? null,
        lifecycleMatch: notionComplete(notionTask) === bonsaiComplete(bonsaiTask),
        bonsaiOwner: bonsaiTask.assignee_member_name ?? null,
        decisionState: 'REVIEW_REQUIRED',
      });
    }
  }

  const sourceReview = bonsaiVerification.migrationFindings.map(finding => {
    const task = bonsaiSnapshot.tasks.find(candidate => candidate.uuid === finding.taskUuid);
    return {
      bonsaiSourceId: finding.taskUuid,
      title: task?.title ?? null,
      project: task?.project_title ?? null,
      owner: task?.assignee_member_name ?? null,
      fields: finding.fields,
      lifecycleState: task?.task_status?.state ?? null,
      decisionState: 'REVIEW_REQUIRED',
    };
  });

  const nearNotionIds = new Set(nearTitleCandidates.map(candidate => candidate.notionSourceId));
  const nearBonsaiIds = new Set(nearTitleCandidates.map(candidate => candidate.bonsaiSourceId));
  const sourceReviewBonsaiIds = new Set(sourceReview.map(item => item.bonsaiSourceId));
  const notionOnly = unmatchedNotion
    .filter(task => !nearNotionIds.has(task.url))
    .map(task => {
      const project = notionProject(task, projectByUrl);
      return {
        notionSourceId: task.url,
        title: task.Task,
        project: project?.Project ?? null,
        status: task.Status,
        decisionState: 'REVIEW_REQUIRED',
      };
    });
  const bonsaiOnly = unmatchedBonsai
    .filter(task => !nearBonsaiIds.has(task.uuid) && !sourceReviewBonsaiIds.has(task.uuid))
    .map(task => ({
      bonsaiSourceId: task.uuid,
      title: task.title,
      project: task.project_title ?? null,
      lifecycleState: task.task_status?.state ?? null,
      owner: task.assignee_member_name ?? null,
      decisionState: 'REVIEW_REQUIRED',
    }));

  const projectAliases = [...projectAliasGroups.values()].sort((a, b) => (
    normalized(a.notionProject).localeCompare(normalized(b.notionProject))
  ));
  exactTaskLinks.sort((a, b) => normalized(a.taskTitle).localeCompare(normalized(b.taskTitle)));
  nearTitleCandidates.sort((a, b) => b.tokenDiceSimilarity - a.tokenDiceSimilarity);

  const reviewItems = projectAliases.length + nearTitleCandidates.length + sourceReview.length + notionOnly.length + bonsaiOnly.length;
  return {
    format: 'ashbi-notion-bonsai-task-review',
    version: 1,
    complete: false,
    reasonCode: 'HUMAN_RECONCILIATION_REQUIRED',
    preparedAt: new Date(prepared).toISOString(),
    summary: {
      notionTasks: notionSnapshot.tasks.length,
      bonsaiTasks: bonsaiSnapshot.tasks.length,
      exactTaskLinks: exactTaskLinks.length,
      exactTaskLinksReadyForApproval: exactTaskLinks.filter(link => link.decisionState === 'EXACT_LINK_CANDIDATE').length,
      projectAliasCandidates: projectAliases.length,
      nearTitleCandidates: nearTitleCandidates.length,
      notionOnly: notionOnly.length,
      bonsaiOnly: bonsaiOnly.length,
      bonsaiSourceReview: sourceReview.length,
      reviewItems,
    },
    ownerEvidence: ownerSummary(bonsaiSnapshot.tasks),
    exactTaskLinks,
    projectAliasCandidates: projectAliases,
    nearTitleCandidates,
    notionOnly,
    bonsaiOnly,
    bonsaiSourceReview: sourceReview,
    safeguards: {
      externalWritesPerformed: false,
      exactLinksApplied: false,
      projectAliasesApplied: false,
      ownerAssignmentsApplied: false,
      fuzzyMatchesApplied: false,
    },
    sourceEvidence: {
      notionSnapshotSha256: sha256(notionSnapshotSha256, 'notionSnapshotSha256'),
      notionCapturedAt: new Date(notionCaptured).toISOString(),
      bonsaiSnapshotSha256: sha256(bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      bonsaiCapturedAt: new Date(bonsaiCaptured).toISOString(),
    },
  };
}
