import { verifyNotionBonsaiMappingDecision } from './notionBonsaiMappingDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-task-link-decision';
const SCOPE = 'LOGICAL_TASK_IDENTITY_ONLY';
const DECISIONS = new Set(['PENDING', 'APPROVED', 'REJECTED']);

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

function id(value, name) {
  const result = text(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function linkId(kind, notionSourceId, bonsaiSourceId) {
  return `task-link:${kind.toLowerCase()}:${notionSourceId.split('/').pop()}:${bonsaiSourceId}`;
}

function reviewCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review' || review?.version !== 1
    || !Array.isArray(review?.exactTaskLinks) || !Array.isArray(review?.nearTitleCandidates)) {
    throw new TypeError('A valid Notion/Bonsai task review is required');
  }
  const exact = review.exactTaskLinks.map(link => {
    const notionSourceId = id(link.notionSourceId, 'notionSourceId');
    const bonsaiSourceId = id(link.bonsaiSourceId, 'bonsaiSourceId');
    const dependent = link.projectTitleMatch !== true;
    const kind = dependent ? 'PROJECT_DEPENDENT_EXACT' : 'DIRECT_EXACT';
    return {
      candidateId: linkId(kind, notionSourceId, bonsaiSourceId),
      evidenceTier: kind,
      risk: dependent ? 'MEDIUM' : 'LOW',
      notionSourceId,
      bonsaiSourceId,
      notionTitle: text(link.taskTitle),
      bonsaiTitle: text(link.taskTitle),
      notionProject: text(link.notionProject),
      bonsaiProject: text(link.bonsaiProject),
      lifecycleMatch: link.lifecycleMatch === true,
      mappingDependency: dependent ? {
        kind: 'PROJECT_ALIAS', notionProject: text(link.notionProject), bonsaiProject: text(link.bonsaiProject),
      } : null,
    };
  });
  const near = review.nearTitleCandidates.map(link => {
    const notionSourceId = id(link.notionSourceId, 'notionSourceId');
    const bonsaiSourceId = id(link.bonsaiSourceId, 'bonsaiSourceId');
    return {
      candidateId: linkId('NEAR_TITLE', notionSourceId, bonsaiSourceId),
      evidenceTier: 'NEAR_TITLE',
      risk: 'HIGH',
      notionSourceId,
      bonsaiSourceId,
      notionTitle: text(link.notionTitle),
      bonsaiTitle: text(link.bonsaiTitle),
      notionProject: text(link.notionProject),
      bonsaiProject: text(link.bonsaiProject),
      lifecycleMatch: link.lifecycleMatch === true,
      tokenDiceSimilarity: Number(link.tokenDiceSimilarity),
      mappingDependency: { kind: 'NEAR_TITLE_TASK_LINK', notionSourceId, bonsaiSourceId },
    };
  });
  const candidates = [...exact, ...near].sort((left, right) => left.notionSourceId.localeCompare(right.notionSourceId));
  if (candidates.length === 0 || new Set(candidates.map(candidate => candidate.candidateId)).size !== candidates.length
    || new Set(candidates.map(candidate => candidate.notionSourceId)).size !== candidates.length
    || new Set(candidates.map(candidate => candidate.bonsaiSourceId)).size !== candidates.length) {
    throw new TypeError('Task-link candidates require unique source identities');
  }
  return candidates;
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Set(candidates.map(candidate => candidate.candidateId));
  const byId = new Map();
  for (const item of decisions) {
    const candidateId = text(item?.candidateId);
    const decision = text(item?.decision);
    if (!known.has(candidateId)) throw new TypeError(`Unknown task-link candidate: ${candidateId}`);
    if (byId.has(candidateId)) throw new TypeError(`Duplicate task-link decision: ${candidateId}`);
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new TypeError('Recorded decisions must be APPROVED or REJECTED');
    byId.set(candidateId, decision);
  }
  return candidates.map(candidate => ({ ...candidate, decision: byId.get(candidate.candidateId) ?? 'PENDING' }));
}

function identity(candidate) {
  const { decision: _decision, ...rest } = candidate;
  return JSON.stringify(rest);
}

function dependencyApproved(dependency, mappingDecision) {
  return (mappingDecision?.candidates ?? []).some(candidate => {
    if (candidate.decision !== 'APPROVED' || candidate.kind !== dependency.kind) return false;
    if (dependency.kind === 'PROJECT_ALIAS') {
      return candidate.notionProject === dependency.notionProject && candidate.bonsaiProject === dependency.bonsaiProject;
    }
    return candidate.notionSourceId === dependency.notionSourceId && candidate.bonsaiSourceId === dependency.bonsaiSourceId;
  });
}

function summarize(candidates) {
  const states = state => candidates.filter(candidate => candidate.decision === state).length;
  const byTier = Object.fromEntries(['DIRECT_EXACT', 'PROJECT_DEPENDENT_EXACT', 'NEAR_TITLE'].map(tier => [tier, {
    total: candidates.filter(candidate => candidate.evidenceTier === tier).length,
    approved: candidates.filter(candidate => candidate.evidenceTier === tier && candidate.decision === 'APPROVED').length,
    rejected: candidates.filter(candidate => candidate.evidenceTier === tier && candidate.decision === 'REJECTED').length,
    pending: candidates.filter(candidate => candidate.evidenceTier === tier && candidate.decision === 'PENDING').length,
  }]));
  return { total: candidates.length, approved: states('APPROVED'), rejected: states('REJECTED'), pending: states('PENDING'), byTier };
}

export function prepareNotionBonsaiTaskLinkDecision({
  review,
  reviewSha256,
  preparedAt,
  decisions = [],
  mappingDecision = null,
  mappingDecisionSha256 = null,
  approver = null,
  decidedAt = null,
  reference = null,
}) {
  const reviewTime = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewTime) throw new TypeError('preparedAt must not predate the task review');
  const reviewHash = sha256(reviewSha256, 'reviewSha256');
  const candidates = applyDecisions(reviewCandidates(review), decisions);
  const decided = candidates.filter(candidate => candidate.decision !== 'PENDING');
  const conditionalApproved = candidates.filter(candidate => candidate.decision === 'APPROVED' && candidate.mappingDependency);
  let mappingHash = null;
  if (conditionalApproved.length) {
    mappingHash = sha256(mappingDecisionSha256, 'mappingDecisionSha256');
    const mappingVerification = verifyNotionBonsaiMappingDecision({ review, reviewSha256: reviewHash, record: mappingDecision });
    if (!mappingVerification.valid || conditionalApproved.some(candidate => !dependencyApproved(candidate.mappingDependency, mappingDecision))) {
      throw new TypeError('Every approved conditional task link requires its approved mapping dependency');
    }
  } else if (mappingDecision !== null || mappingDecisionSha256 !== null) {
    throw new TypeError('A mapping decision is allowed only for an approved conditional task link');
  }
  let evidence = null;
  if (decided.length) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded decisions require an approver and reference');
    const decisionTime = timestamp(decidedAt, 'decidedAt');
    if (decisionTime < reviewTime || decisionTime > prepared) throw new TypeError('decidedAt is outside the evidence window');
    evidence = { approver: text(approver), decidedAt: new Date(decisionTime).toISOString(), reference: text(reference) };
  } else if (approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('A fully pending packet cannot contain decision evidence');
  }
  const summary = summarize(candidates);
  return {
    format: FORMAT,
    version: 1,
    scope: SCOPE,
    complete: summary.pending === 0,
    preparedAt: new Date(prepared).toISOString(),
    decisionEvidence: evidence,
    candidates,
    summary,
    approvalMeaning: 'A logical identity decision for the two source task IDs only.',
    safeguards: {
      externalWritesPerformed: false,
      taskLinksApplied: false,
      tasksCreatedOrMoved: false,
      taskFieldsChanged: false,
      ownerAssignmentsAuthorized: false,
      projectMappingsApplied: false,
      sourceRecordsDeleted: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: reviewHash,
      reviewPreparedAt: new Date(reviewTime).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      mappingDecisionSha256: mappingHash,
    },
  };
}

export function verifyNotionBonsaiTaskLinkDecision({
  review, reviewSha256, record, mappingDecision = null, mappingDecisionSha256 = null,
}) {
  const findings = [];
  let expected = [];
  let reviewHash;
  try {
    expected = reviewCandidates(review);
    reviewHash = sha256(reviewSha256, 'reviewSha256');
  } catch {
    findings.push('INVALID_TASK_REVIEW');
  }
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== reviewHash
    || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== review?.sourceEvidence?.bonsaiSnapshotSha256) {
    findings.push('SOURCE_EVIDENCE_MISMATCH');
  }
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  if (candidates.some(candidate => !DECISIONS.has(candidate?.decision))) findings.push('INVALID_CANDIDATE_DECISION');
  const summary = summarize(candidates);
  if (record?.complete !== (candidates.length > 0 && summary.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(summary)) findings.push('SUMMARY_MISMATCH');
  const reviewTime = Date.parse(String(review?.preparedAt ?? ''));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (!Number.isFinite(reviewTime) || !Number.isFinite(prepared) || prepared < reviewTime) findings.push('INVALID_PREPARATION_TIME');
  if (summary.approved + summary.rejected > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < reviewTime || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const conditionalApproved = candidates.filter(candidate => candidate.decision === 'APPROVED' && candidate.mappingDependency);
  if (conditionalApproved.length) {
    let mappingHash;
    try {
      mappingHash = sha256(mappingDecisionSha256, 'mappingDecisionSha256');
    } catch {
      findings.push('INVALID_MAPPING_DECISION_CHECKSUM');
    }
    const mappingVerification = verifyNotionBonsaiMappingDecision({ review, reviewSha256: reviewHash, record: mappingDecision });
    if (record?.sourceEvidence?.mappingDecisionSha256 !== mappingHash || !mappingVerification.valid
      || conditionalApproved.some(candidate => !dependencyApproved(candidate.mappingDependency, mappingDecision))) {
      findings.push('MAPPING_DEPENDENCY_FAILED');
    }
  } else if (record?.sourceEvidence?.mappingDecisionSha256 !== null) findings.push('UNEXPECTED_MAPPING_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'taskLinksApplied', 'tasksCreatedOrMoved', 'taskFieldsChanged',
    'ownerAssignmentsAuthorized', 'projectMappingsApplied', 'sourceRecordsDeleted', 'migrationOrCutoverAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)
    || record?.approvalMeaning !== 'A logical identity decision for the two source task IDs only.') findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && summary.pending === 0, ...summary, findings };
}

export { FORMAT as NOTION_BONSAI_TASK_LINK_DECISION_FORMAT, SCOPE as NOTION_BONSAI_TASK_LINK_DECISION_SCOPE };
