import { verifyNotionBonsaiTaskLinkDecision } from './notionBonsaiTaskLinkDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-owner-decision';
const VERSION = 2;
const SCOPE = 'SOURCE_BACKED_NOTION_TASK_OWNERS';
const DECISIONS = new Set(['PENDING', 'APPROVED', 'REJECTED']);

function text(value) { return String(value ?? '').trim(); }
function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}
function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}
function ownerCandidateId(notionSourceId, bonsaiSourceId) {
  return `owner:${notionSourceId.split('/').pop()}:${bonsaiSourceId}`;
}

function sourceBackedCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review' || review?.version !== 1
    || !Array.isArray(review?.exactTaskLinks) || !Array.isArray(review?.nearTitleCandidates)) {
    throw new TypeError('A valid Notion/Bonsai task review packet is required');
  }
  const exact = review.exactTaskLinks.filter(link => text(link.bonsaiOwner)).map(link => {
    const notionSourceId = text(link.notionSourceId);
    const bonsaiSourceId = text(link.bonsaiSourceId);
    return {
      candidateId: ownerCandidateId(notionSourceId, bonsaiSourceId), notionSourceId, bonsaiSourceId,
      taskTitle: text(link.taskTitle), notionProject: text(link.notionProject), bonsaiProject: text(link.bonsaiProject),
      proposedOwner: text(link.bonsaiOwner), evidenceKind: 'EXACT_TASK_TITLE',
      mappingDependency: link.projectTitleMatch === true ? null : 'PROJECT_ALIAS_APPROVAL',
    };
  });
  const near = review.nearTitleCandidates.filter(link => text(link.bonsaiOwner)).map(link => {
    const notionSourceId = text(link.notionSourceId);
    const bonsaiSourceId = text(link.bonsaiSourceId);
    return {
      candidateId: ownerCandidateId(notionSourceId, bonsaiSourceId), notionSourceId, bonsaiSourceId,
      taskTitle: text(link.notionTitle), notionProject: text(link.notionProject), bonsaiProject: text(link.bonsaiProject),
      proposedOwner: text(link.bonsaiOwner), evidenceKind: 'NEAR_TITLE_REVIEW_CANDIDATE',
      mappingDependency: 'NEAR_TITLE_LINK_APPROVAL',
    };
  });
  const candidates = [...exact, ...near].sort((left, right) => left.notionSourceId.localeCompare(right.notionSourceId));
  if (candidates.length === 0 || candidates.some(candidate => !candidate.notionSourceId || !candidate.bonsaiSourceId)
    || new Set(candidates.map(item => item.candidateId)).size !== candidates.length
    || new Set(candidates.map(item => item.notionSourceId)).size !== candidates.length
    || new Set(candidates.map(item => item.bonsaiSourceId)).size !== candidates.length) {
    throw new TypeError('Owner candidates must have unique source identities');
  }
  return candidates;
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Set(candidates.map(candidate => candidate.candidateId));
  const selected = new Map();
  for (const item of decisions) {
    const candidateId = text(item?.candidateId);
    const decision = text(item?.decision);
    if (!known.has(candidateId)) throw new TypeError(`Unknown owner candidate: ${candidateId}`);
    if (selected.has(candidateId)) throw new TypeError(`Duplicate owner decision: ${candidateId}`);
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new TypeError('Recorded owner decisions must be APPROVED or REJECTED');
    selected.set(candidateId, decision);
  }
  return candidates.map(candidate => ({ ...candidate, decision: selected.get(candidate.candidateId) ?? 'PENDING' }));
}
function candidateIdentity(candidate) {
  const { decision: _decision, ...identity } = candidate;
  return JSON.stringify(identity);
}
function taskIdentityApproved(candidate, taskLinkDecision) {
  return (taskLinkDecision?.candidates ?? []).some(link => link.decision === 'APPROVED'
    && link.notionSourceId === candidate.notionSourceId && link.bonsaiSourceId === candidate.bonsaiSourceId);
}
function summaryFor(candidates) {
  const byOwner = new Map();
  for (const candidate of candidates) byOwner.set(candidate.proposedOwner, (byOwner.get(candidate.proposedOwner) ?? 0) + 1);
  return {
    total: candidates.length,
    direct: candidates.filter(candidate => candidate.mappingDependency === null).length,
    conditional: candidates.filter(candidate => candidate.mappingDependency !== null).length,
    approved: candidates.filter(candidate => candidate.decision === 'APPROVED').length,
    rejected: candidates.filter(candidate => candidate.decision === 'REJECTED').length,
    pending: candidates.filter(candidate => candidate.decision === 'PENDING').length,
    byOwner: [...byOwner.entries()].map(([ownerName, taskCount]) => ({ ownerName, taskCount }))
      .sort((left, right) => left.ownerName.localeCompare(right.ownerName)),
  };
}

function verifyApprovalDependencies({ review, reviewSha256, candidates, taskLinkDecisionRecord, taskLinkDecisionSha256, mappingDecisionRecord, mappingDecisionSha256 }) {
  const approved = candidates.filter(candidate => candidate.decision === 'APPROVED');
  if (!approved.length) return { taskLinkSha: null, mappingSha: null };
  const taskLinkSha = sha256(taskLinkDecisionSha256, 'taskLinkDecisionSha256');
  const mappingRequired = text(taskLinkDecisionRecord?.sourceEvidence?.mappingDecisionSha256) !== '';
  const mappingSha = mappingRequired ? sha256(mappingDecisionSha256, 'mappingDecisionSha256') : null;
  const result = verifyNotionBonsaiTaskLinkDecision({
    review, reviewSha256, record: taskLinkDecisionRecord,
    mappingDecision: mappingRequired ? mappingDecisionRecord : null,
    mappingDecisionSha256: mappingRequired ? mappingDecisionSha256 : null,
  });
  if (!result.valid || approved.some(candidate => !taskIdentityApproved(candidate, taskLinkDecisionRecord))) {
    throw new TypeError('Every approved owner candidate requires its approved valid task identity');
  }
  return { taskLinkSha, mappingSha };
}

export function prepareNotionBonsaiOwnerDecision({
  review, reviewSha256, preparedAt, decisions = [],
  mappingDecisionRecord = null, mappingDecisionSha256 = null,
  taskLinkDecisionRecord = null, taskLinkDecisionSha256 = null,
  approver = null, decidedAt = null, reference = null,
}) {
  const reviewPrepared = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewPrepared) throw new TypeError('preparedAt must not predate the review packet');
  const reviewHash = sha256(reviewSha256, 'reviewSha256');
  const candidates = applyDecisions(sourceBackedCandidates(review), decisions);
  const dependencyEvidence = verifyApprovalDependencies({
    review, reviewSha256: reviewHash, candidates, taskLinkDecisionRecord, taskLinkDecisionSha256,
    mappingDecisionRecord, mappingDecisionSha256,
  });
  const totals = summaryFor(candidates);
  let decisionEvidence = null;
  if (totals.approved + totals.rejected > 0) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded owner decisions require an approver and reference');
    const decided = timestamp(decidedAt, 'decidedAt');
    if (decided < reviewPrepared || decided > prepared) throw new TypeError('decidedAt is outside the evidence window');
    decisionEvidence = { approver: text(approver), decidedAt: new Date(decided).toISOString(), reference: text(reference) };
  } else if (approver !== null || decidedAt !== null || reference !== null
    || mappingDecisionRecord !== null || mappingDecisionSha256 !== null
    || taskLinkDecisionRecord !== null || taskLinkDecisionSha256 !== null) {
    throw new TypeError('A fully pending owner packet cannot contain decision evidence');
  }
  return {
    format: FORMAT, version: VERSION, scope: SCOPE, complete: totals.pending === 0,
    preparedAt: new Date(prepared).toISOString(), decisionEvidence, candidates, summary: totals,
    approvalMeaning: 'Approval records the source-backed proposed owner only after that exact task identity is approved.',
    safeguards: {
      externalWritesPerformed: false, ownerAssignmentsApplied: false, projectMappingsApplied: false,
      sourceOnlyDispositionsAuthorized: false, financialCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: reviewHash, reviewPreparedAt: new Date(reviewPrepared).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      mappingDecisionSha256: dependencyEvidence.mappingSha,
      taskLinkDecisionSha256: dependencyEvidence.taskLinkSha,
    },
  };
}

export function verifyNotionBonsaiOwnerDecision({
  review, reviewSha256, record, mappingDecisionRecord = null, mappingDecisionSha256 = null,
  taskLinkDecisionRecord = null, taskLinkDecisionSha256 = null,
}) {
  const findings = [];
  let expected = [];
  let reviewHash;
  try { expected = sourceBackedCandidates(review); reviewHash = sha256(reviewSha256, 'reviewSha256'); }
  catch { findings.push('INVALID_REVIEW_PACKET'); }
  if (record?.format !== FORMAT || record?.version !== VERSION || record?.scope !== SCOPE) findings.push('INVALID_OWNER_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== reviewHash || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== review?.sourceEvidence?.bonsaiSnapshotSha256) findings.push('SOURCE_EVIDENCE_MISMATCH');
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => candidateIdentity(candidate) !== JSON.stringify(expected[index]))) findings.push('CANDIDATE_SET_MISMATCH');
  if (candidates.some(candidate => !DECISIONS.has(candidate?.decision))) findings.push('INVALID_OWNER_DECISION');
  const totals = summaryFor(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const reviewTime = Date.parse(String(review?.preparedAt ?? ''));
  const preparedTime = Date.parse(String(record?.preparedAt ?? ''));
  if (!Number.isFinite(reviewTime) || !Number.isFinite(preparedTime) || preparedTime < reviewTime) findings.push('INVALID_PREPARATION_TIME');
  if (totals.approved + totals.rejected > 0) {
    const decidedTime = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decidedTime) || decidedTime < reviewTime || decidedTime > preparedTime) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  try {
    const dependencies = verifyApprovalDependencies({
      review, reviewSha256: reviewHash, candidates, taskLinkDecisionRecord, taskLinkDecisionSha256,
      mappingDecisionRecord, mappingDecisionSha256,
    });
    if (record?.sourceEvidence?.taskLinkDecisionSha256 !== dependencies.taskLinkSha
      || record?.sourceEvidence?.mappingDecisionSha256 !== dependencies.mappingSha) findings.push('APPROVAL_DEPENDENCY_MISMATCH');
  } catch { findings.push('APPROVAL_DEPENDENCY_FAILED'); }
  const safeguards = ['externalWritesPerformed', 'ownerAssignmentsApplied', 'projectMappingsApplied',
    'sourceOnlyDispositionsAuthorized', 'financialCutoverAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)
    || record?.approvalMeaning !== 'Approval records the source-backed proposed owner only after that exact task identity is approved.') findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0, ...totals, findings: [...new Set(findings)] };
}

export { FORMAT as NOTION_BONSAI_OWNER_DECISION_FORMAT, VERSION as NOTION_BONSAI_OWNER_DECISION_VERSION, SCOPE as NOTION_BONSAI_OWNER_DECISION_SCOPE };
