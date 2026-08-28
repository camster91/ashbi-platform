import { verifyBonsaiTaskSnapshot } from './bonsaiTaskSnapshot.service.js';
import { verifyNotionOperatingSnapshot } from './notionOperatingSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(normalized(value).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean));
}

function tokenDice(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
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

function notionProjectFor(task, projectByUrl) {
  try {
    const relation = JSON.parse(task.Project);
    return Array.isArray(relation) && relation.length === 1 ? projectByUrl.get(relation[0]) ?? null : null;
  } catch {
    return null;
  }
}

function uniqueGroups(rows, titleFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalized(titleFor(row));
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export function prepareNotionBonsaiProjectReview({
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

  const projectByUrl = new Map(notionSnapshot.projects.map(project => [project.url, project]));
  const notionByTitle = uniqueGroups(notionSnapshot.projects, project => project.Project);
  const bonsaiProjectTasks = new Map();
  let projectlessTasks = 0;
  for (const task of bonsaiSnapshot.tasks) {
    const key = normalized(task.project_title);
    if (!key) {
      projectlessTasks += 1;
      continue;
    }
    const group = bonsaiProjectTasks.get(key) ?? { projectTitle: task.project_title, taskSourceIds: [] };
    group.taskSourceIds.push(task.uuid);
    bonsaiProjectTasks.set(key, group);
  }

  const exactProjectLinks = [];
  const consumedNotion = new Set();
  const consumedBonsai = new Set();
  for (const [key, notionProjects] of notionByTitle) {
    const bonsaiProject = bonsaiProjectTasks.get(key);
    if (notionProjects.length !== 1 || !bonsaiProject) continue;
    const project = notionProjects[0];
    exactProjectLinks.push({
      notionSourceId: project.url,
      notionProject: project.Project,
      bonsaiProject: bonsaiProject.projectTitle,
      bonsaiTaskCount: bonsaiProject.taskSourceIds.length,
      evidence: 'EXACT_PROJECT_TITLE_IN_TASK_SNAPSHOT',
      decisionState: 'EXACT_LINK_CANDIDATE',
    });
    consumedNotion.add(key);
    consumedBonsai.add(key);
  }

  const notionTaskGroups = uniqueGroups(notionSnapshot.tasks, task => task.Task);
  const bonsaiTaskGroups = uniqueGroups(bonsaiSnapshot.tasks, task => task.title);
  const aliasGroups = new Map();
  const unmatchedNotionTasks = [];
  const unmatchedBonsaiTasks = new Set(bonsaiSnapshot.tasks.map(task => task.uuid));
  for (const task of notionSnapshot.tasks) {
    const key = normalized(task.Task);
    const bonsaiMatches = bonsaiTaskGroups.get(key) ?? [];
    if ((notionTaskGroups.get(key) ?? []).length !== 1 || bonsaiMatches.length !== 1) {
      unmatchedNotionTasks.push(task);
      continue;
    }
    const bonsaiTask = bonsaiMatches[0];
    unmatchedBonsaiTasks.delete(bonsaiTask.uuid);
    const notionProject = notionProjectFor(task, projectByUrl);
    const notionKey = normalized(notionProject?.Project);
    const bonsaiKey = normalized(bonsaiTask.project_title);
    if (!notionKey || !bonsaiKey || notionKey === bonsaiKey || consumedNotion.has(notionKey) || consumedBonsai.has(bonsaiKey)) continue;
    const pairKey = `${notionKey}\u0000${bonsaiKey}`;
    const group = aliasGroups.get(pairKey) ?? {
      notionSourceId: notionProject.url,
      notionProject: notionProject.Project,
      bonsaiProject: bonsaiTask.project_title,
      exactSharedTaskCount: 0,
      evidence: [],
      decisionState: 'REVIEW_REQUIRED',
    };
    group.exactSharedTaskCount += 1;
    group.evidence.push({ taskTitle: task.Task, notionSourceId: task.url, bonsaiSourceId: bonsaiTask.uuid });
    aliasGroups.set(pairKey, group);
  }

  const projectAliasCandidates = [...aliasGroups.values()].sort((a, b) => normalized(a.notionProject).localeCompare(normalized(b.notionProject)));
  for (const candidate of projectAliasCandidates) {
    consumedNotion.add(normalized(candidate.notionProject));
    consumedBonsai.add(normalized(candidate.bonsaiProject));
  }

  const nearTitleTaskProjectCandidates = [];
  const remainingBonsaiTasks = bonsaiSnapshot.tasks.filter(task => unmatchedBonsaiTasks.has(task.uuid));
  for (const notionTask of unmatchedNotionTasks) {
    for (const bonsaiTask of remainingBonsaiTasks) {
      const similarity = tokenDice(notionTask.Task, bonsaiTask.title);
      if (similarity < 0.9) continue;
      const notionProject = notionProjectFor(notionTask, projectByUrl);
      const notionKey = normalized(notionProject?.Project);
      const bonsaiKey = normalized(bonsaiTask.project_title);
      if (!notionKey || !bonsaiKey || consumedNotion.has(notionKey) || consumedBonsai.has(bonsaiKey)) continue;
      nearTitleTaskProjectCandidates.push({
        notionSourceId: notionProject.url,
        notionProject: notionProject.Project,
        bonsaiProject: bonsaiTask.project_title,
        taskEvidence: {
          notionTask: notionTask.Task,
          bonsaiTask: bonsaiTask.title,
          notionTaskSourceId: notionTask.url,
          bonsaiTaskSourceId: bonsaiTask.uuid,
          tokenDiceSimilarity: Number(similarity.toFixed(6)),
        },
        decisionState: 'REVIEW_REQUIRED',
      });
      consumedNotion.add(notionKey);
      consumedBonsai.add(bonsaiKey);
    }
  }

  const unmatchedNotionProjects = notionSnapshot.projects
    .filter(project => !consumedNotion.has(normalized(project.Project)))
    .map(project => ({ notionSourceId: project.url, project: project.Project, status: project.Status, decisionState: 'REVIEW_REQUIRED' }));
  const unmatchedBonsaiProjects = [...bonsaiProjectTasks.entries()]
    .filter(([key]) => !consumedBonsai.has(key))
    .map(([, project]) => ({ project: project.projectTitle, taskCount: project.taskSourceIds.length, taskSourceIds: project.taskSourceIds, decisionState: 'REVIEW_REQUIRED' }));

  const possibleTitlePairs = [];
  for (const bonsaiProject of unmatchedBonsaiProjects) {
    for (const notionProject of unmatchedNotionProjects) {
      const similarity = tokenDice(bonsaiProject.project, notionProject.project);
      if (similarity < 0.4) continue;
      possibleTitlePairs.push({
        notionSourceId: notionProject.notionSourceId,
        notionProject: notionProject.project,
        bonsaiProject: bonsaiProject.project,
        tokenDiceSimilarity: Number(similarity.toFixed(6)),
        evidence: 'TITLE_SIMILARITY_ONLY',
        decisionState: 'REVIEW_REQUIRED',
      });
    }
  }
  possibleTitlePairs.sort((a, b) => b.tokenDiceSimilarity - a.tokenDiceSimilarity);
  exactProjectLinks.sort((a, b) => normalized(a.notionProject).localeCompare(normalized(b.notionProject)));

  return {
    format: 'ashbi-notion-bonsai-project-review',
    version: 1,
    complete: false,
    reasonCode: 'NATIVE_BONSAI_PROJECT_EXPORT_REQUIRED',
    preparedAt: new Date(prepared).toISOString(),
    coverage: {
      notionProjectInventoryComplete: true,
      bonsaiProjectInventoryComplete: false,
      bonsaiEvidenceScope: 'DISTINCT_PROJECT_TITLES_REFERENCED_BY_COMPLETE_TASK_SNAPSHOT',
      limitation: 'A native complete Bonsai projects export is required to prove project inventory parity.',
    },
    summary: {
      notionProjects: notionSnapshot.projects.length,
      bonsaiTaskReferencedProjectTitles: bonsaiProjectTasks.size,
      bonsaiProjectlessTasks: projectlessTasks,
      exactProjectLinks: exactProjectLinks.length,
      taskEvidencedProjectAliases: projectAliasCandidates.length,
      nearTitleTaskProjectCandidates: nearTitleTaskProjectCandidates.length,
      unmatchedNotionProjects: unmatchedNotionProjects.length,
      unmatchedBonsaiTaskReferencedProjects: unmatchedBonsaiProjects.length,
      possibleTitlePairs: possibleTitlePairs.length,
    },
    exactProjectLinks,
    taskEvidencedProjectAliases: projectAliasCandidates,
    nearTitleTaskProjectCandidates,
    unmatchedNotionProjects,
    unmatchedBonsaiTaskReferencedProjects: unmatchedBonsaiProjects,
    possibleTitlePairs,
    safeguards: {
      externalWritesPerformed: false,
      projectLinksApplied: false,
      aliasesApplied: false,
      fuzzyMatchesApplied: false,
      inventoryParityClaimed: false,
    },
    sourceEvidence: {
      notionSnapshotSha256: sha256(notionSnapshotSha256, 'notionSnapshotSha256'),
      notionCapturedAt: new Date(notionCaptured).toISOString(),
      bonsaiTaskSnapshotSha256: sha256(bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      bonsaiCapturedAt: new Date(bonsaiCaptured).toISOString(),
    },
  };
}
