import { verifyBonsaiProjectSnapshot } from './bonsaiProjectSnapshot.service.js';
import { verifyNotionOperatingSnapshot } from './notionOperatingSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(normalized(value).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(Boolean)
    .map(token => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)));
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

function grouped(rows, titleFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalized(titleFor(row));
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function lifecycleMatch(notionStatus, bonsaiStatus) {
  return (notionStatus === 'Done') === ['completed', 'archived'].includes(bonsaiStatus);
}

function linkedProject(notionProject, bonsaiProject, evidence, extra = {}) {
  return {
    notionSourceId: notionProject.url,
    notionProject: notionProject.Project,
    notionStatus: notionProject.Status,
    bonsaiProjectId: bonsaiProject.id,
    bonsaiProject: bonsaiProject.title,
    bonsaiStatus: bonsaiProject.status,
    bonsaiCompany: bonsaiProject.company_name,
    lifecycleMatch: lifecycleMatch(notionProject.Status, bonsaiProject.status),
    evidence,
    decisionState: 'REVIEW_REQUIRED',
    ...extra,
  };
}

export function prepareNotionBonsaiNativeProjectReview({
  notionSnapshot,
  bonsaiProjectSnapshot,
  taskReview,
  notionSnapshotSha256,
  bonsaiProjectSnapshotSha256,
  taskReviewSha256,
  preparedAt,
}) {
  const notionVerification = verifyNotionOperatingSnapshot(notionSnapshot);
  const bonsaiVerification = verifyBonsaiProjectSnapshot(bonsaiProjectSnapshot);
  if (!notionVerification.valid) throw new TypeError('A valid current Notion operating snapshot is required');
  if (!bonsaiVerification.valid) throw new TypeError('A valid complete native Bonsai project snapshot is required');
  if (taskReview?.format !== 'ashbi-notion-bonsai-task-review' || taskReview?.version !== 1) {
    throw new TypeError('A supported Notion/Bonsai task review is required');
  }

  const notionHash = sha256(notionSnapshotSha256, 'notionSnapshotSha256');
  const bonsaiHash = sha256(bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256');
  const reviewHash = sha256(taskReviewSha256, 'taskReviewSha256');
  if (normalized(taskReview?.sourceEvidence?.notionSnapshotSha256) !== notionHash) {
    throw new TypeError('Task review must bind the exact Notion snapshot');
  }
  const prepared = timestamp(preparedAt, 'preparedAt');
  const notionCaptured = timestamp(notionSnapshot.capturedAt, 'Notion capturedAt');
  const bonsaiCaptured = timestamp(bonsaiProjectSnapshot.capturedAt, 'Bonsai capturedAt');
  if (prepared < notionCaptured || prepared < bonsaiCaptured) throw new TypeError('preparedAt must not predate either source snapshot');

  const notionByTitle = grouped(notionSnapshot.projects, project => project.Project);
  const bonsaiByTitle = grouped(bonsaiProjectSnapshot.projects, project => project.title);
  const consumedNotion = new Set();
  const consumedBonsai = new Set();
  const exactProjectLinks = [];
  for (const [key, notionProjects] of notionByTitle) {
    const bonsaiProjects = bonsaiByTitle.get(key) ?? [];
    if (notionProjects.length !== 1 || bonsaiProjects.length !== 1) continue;
    const notionProject = notionProjects[0];
    const bonsaiProject = bonsaiProjects[0];
    exactProjectLinks.push(linkedProject(notionProject, bonsaiProject, 'EXACT_UNIQUE_PROJECT_TITLE', { decisionState: 'EXACT_LINK_CANDIDATE' }));
    consumedNotion.add(notionProject.url);
    consumedBonsai.add(bonsaiProject.id);
  }

  const taskEvidencedProjectCandidates = [];
  const taskEvidenceFindings = [];
  const taskCandidates = [
    ...(taskReview.projectAliasCandidates ?? []).map(candidate => ({
      notionProject: candidate.notionProject,
      bonsaiProject: candidate.bonsaiProject,
      evidence: 'EXACT_SHARED_TASKS',
      taskEvidence: candidate.evidence,
      exactSharedTaskCount: candidate.exactSharedTaskCount,
    })),
    ...(taskReview.nearTitleCandidates ?? []).map(candidate => ({
      notionProject: candidate.notionProject,
      bonsaiProject: candidate.bonsaiProject,
      evidence: 'NEAR_TITLE_SHARED_TASK',
      taskEvidence: [{
        notionSourceId: candidate.notionSourceId,
        bonsaiSourceId: candidate.bonsaiSourceId,
        notionTitle: candidate.notionTitle,
        bonsaiTitle: candidate.bonsaiTitle,
        tokenDiceSimilarity: candidate.tokenDiceSimilarity,
      }],
      exactSharedTaskCount: 0,
    })),
  ];
  for (const candidate of taskCandidates) {
    const notionMatches = notionByTitle.get(normalized(candidate.notionProject)) ?? [];
    const bonsaiMatches = bonsaiByTitle.get(normalized(candidate.bonsaiProject)) ?? [];
    if (notionMatches.length !== 1 || bonsaiMatches.length !== 1) {
      taskEvidenceFindings.push({
        code: 'TASK_EVIDENCE_PROJECT_IDENTITY_UNRESOLVED',
        notionProject: candidate.notionProject,
        bonsaiProject: candidate.bonsaiProject,
        notionMatches: notionMatches.length,
        bonsaiMatches: bonsaiMatches.length,
      });
      continue;
    }
    const notionProject = notionMatches[0];
    const bonsaiProject = bonsaiMatches[0];
    if (consumedNotion.has(notionProject.url) || consumedBonsai.has(bonsaiProject.id)) continue;
    taskEvidencedProjectCandidates.push(linkedProject(notionProject, bonsaiProject, candidate.evidence, {
      taskEvidence: candidate.taskEvidence,
      exactSharedTaskCount: candidate.exactSharedTaskCount,
    }));
    consumedNotion.add(notionProject.url);
    consumedBonsai.add(bonsaiProject.id);
  }

  const unmatchedNotionProjects = notionSnapshot.projects
    .filter(project => !consumedNotion.has(project.url))
    .map(project => ({ notionSourceId: project.url, project: project.Project, status: project.Status, decisionState: 'REVIEW_REQUIRED' }));
  const unmatchedBonsaiProjects = bonsaiProjectSnapshot.projects
    .filter(project => !consumedBonsai.has(project.id))
    .map(project => ({
      bonsaiProjectId: project.id,
      project: project.title,
      status: project.status,
      company: project.company_name,
      url: project.url,
      decisionState: 'DISPOSITION_REQUIRED',
    }));

  const possibleTitlePairs = [];
  for (const notionProject of unmatchedNotionProjects) {
    const ranked = unmatchedBonsaiProjects
      .filter(project => lifecycleMatch(notionProject.status, project.status))
      .map(project => {
        const titleSimilarity = tokenDice(notionProject.project, project.project);
        const companySimilarity = tokenDice(notionProject.project, project.company);
        const notionTitle = normalized(notionProject.project);
        const bonsaiTitle = normalized(project.project);
        const titlePrefix = bonsaiTitle.startsWith(`${notionTitle} `) || notionTitle.startsWith(`${bonsaiTitle} `);
        const prefixScore = titlePrefix ? 0.55 : 0;
        const primaryScore = Math.max(titleSimilarity, companySimilarity, prefixScore);
        const score = Math.min(1, primaryScore + (0.25 * Math.min(titleSimilarity, companySimilarity)));
        const evidence = companySimilarity === primaryScore
          ? 'COMPANY_TITLE_SIMILARITY_ONLY'
          : titlePrefix && prefixScore === primaryScore
            ? 'PROJECT_TITLE_PREFIX_ONLY'
            : 'PROJECT_TITLE_SIMILARITY_ONLY';
        return { project, score, titleSimilarity, companySimilarity, evidence };
      })
      .filter(candidate => candidate.score >= 0.4)
      .sort((a, b) => b.score - a.score || b.titleSimilarity - a.titleSimilarity)
      .slice(0, 1);
    for (const [index, candidate] of ranked.entries()) {
      possibleTitlePairs.push({
        notionSourceId: notionProject.notionSourceId,
        notionProject: notionProject.project,
        bonsaiProjectId: candidate.project.bonsaiProjectId,
        bonsaiProject: candidate.project.project,
        bonsaiCompany: candidate.project.company,
        bonsaiStatus: candidate.project.status,
        reviewScore: Number(candidate.score.toFixed(6)),
        titleTokenDiceSimilarity: Number(candidate.titleSimilarity.toFixed(6)),
        companyTokenDiceSimilarity: Number(candidate.companySimilarity.toFixed(6)),
        candidateRank: index + 1,
        evidence: candidate.evidence,
        decisionState: 'REVIEW_REQUIRED',
      });
    }
  }

  const duplicateBonsaiTitles = [...bonsaiByTitle.entries()]
    .filter(([, projects]) => projects.length > 1)
    .map(([, projects]) => ({
      title: projects[0].title,
      projects: projects.map(project => ({ id: project.id, status: project.status, company: project.company_name, url: project.url })),
      decisionState: 'SOURCE_REVIEW_REQUIRED',
    }));
  const unmatchedByStatus = Object.fromEntries(['active', 'completed', 'archived'].map(status => [
    status,
    unmatchedBonsaiProjects.filter(project => project.status === status).length,
  ]));
  exactProjectLinks.sort((a, b) => normalized(a.notionProject).localeCompare(normalized(b.notionProject)));
  taskEvidencedProjectCandidates.sort((a, b) => normalized(a.notionProject).localeCompare(normalized(b.notionProject)));

  return {
    format: 'ashbi-notion-bonsai-native-project-review',
    version: 1,
    complete: false,
    reasonCode: 'HUMAN_PROJECT_RECONCILIATION_REQUIRED',
    preparedAt: new Date(prepared).toISOString(),
    coverage: {
      notionProjectInventoryComplete: true,
      bonsaiProjectInventoryComplete: true,
      bonsaiLifecyclePartitionComplete: true,
      taskEvidenceBound: true,
    },
    summary: {
      notionProjects: notionSnapshot.projects.length,
      bonsaiProjects: bonsaiProjectSnapshot.projects.length,
      bonsaiByStatus: bonsaiVerification.statusCounts,
      exactProjectLinks: exactProjectLinks.length,
      taskEvidencedProjectCandidates: taskEvidencedProjectCandidates.length,
      lifecycleDifferences: [...exactProjectLinks, ...taskEvidencedProjectCandidates].filter(link => !link.lifecycleMatch).length,
      unmatchedNotionProjects: unmatchedNotionProjects.length,
      unmatchedBonsaiProjects: unmatchedBonsaiProjects.length,
      unmatchedBonsaiByStatus: unmatchedByStatus,
      possibleTitlePairs: possibleTitlePairs.length,
      duplicateBonsaiTitles: duplicateBonsaiTitles.length,
      taskEvidenceFindings: taskEvidenceFindings.length,
    },
    exactProjectLinks,
    taskEvidencedProjectCandidates,
    possibleTitlePairs,
    unmatchedNotionProjects,
    unmatchedBonsaiProjects,
    duplicateBonsaiTitles,
    taskEvidenceFindings,
    safeguards: {
      externalWritesPerformed: false,
      projectLinksApplied: false,
      lifecycleChangesApplied: false,
      projectArchivesApplied: false,
      fuzzyMatchesApplied: false,
      sourceRecordsDeleted: false,
    },
    sourceEvidence: {
      notionSnapshotSha256: notionHash,
      notionCapturedAt: new Date(notionCaptured).toISOString(),
      bonsaiProjectSnapshotSha256: bonsaiHash,
      bonsaiCapturedAt: new Date(bonsaiCaptured).toISOString(),
      taskReviewSha256: reviewHash,
    },
  };
}
