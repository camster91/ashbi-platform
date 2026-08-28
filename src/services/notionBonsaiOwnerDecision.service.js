import { verifyNotionBonsaiMappingDecision } from './notionBonsaiMappingDecision.service.js';
import { verifyNotionBonsaiTaskLinkDecision } from './notionBonsaiTaskLinkDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-owner-decision';
const SCOPE = 'SOURCE_BACKED_NOTION_TASK_OWNERS';

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

function sourceBackedCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review'
    || review?.version !== 1
    || !Array.isArray(review?.exactTaskLinks)
    || !Array.isArray(review?.nearTitleCandidates)) {
    throw new TypeError('A valid Notion/Bonsai task review packet is required');
  }

  const exact = review.exactTaskLinks
    .filter(link => text(link.bonsaiOwner))
    .map(link => ({
      notionSourceId: text(link.notionSourceId),
      bonsaiSourceId: text(link.bonsaiSourceId),
      taskTitle: text(link.taskTitle),
      notionProject: text(link.notionProject),
      bonsaiProject: text(link.bonsaiProject),
      proposedOwner: text(link.bonsaiOwner),
      evidenceKind: 'EXACT_TASK_TITLE',
      mappingDependency: link.projectTitleMatch === true ? null : 'PROJECT_ALIAS_APPROVAL',
    }));
  const near = review.nearTitleCandidates
    .filter(link => text(link.bonsaiOwner))
    .map(link => ({
      notionSourceId: text(link.notionSourceId),
      bonsaiSourceId: text(link.bonsaiSourceId),
      taskTitle: text(link.notionTitle),
      notionProject: text(link.notionProject),
      bonsaiProject: text(link.bonsaiProject),
      proposedOwner: text(link.bonsaiOwner),
      evidenceKind: 'NEAR_TITLE_REVIEW_CANDIDATE',
      mappingDependency: 'NEAR_TITLE_LINK_APPROVAL',
    }));
  const candidates = [...exact, ...near].sort((left, right) => left.notionSourceId.localeCompare(right.notionSourceId));
  if (candidates.length === 0 || new Set(candidates.map(item => item.notionSourceId)).size !== candidates.length
    || new Set(candidates.map(item => item.bonsaiSourceId)).size !== candidates.length) {
    throw new TypeError('Owner candidates must have unique source identities');
  }
  return candidates;
}

function candidateIdentity(candidate) {
  const { decision: _decision, ...identity } = candidate;
  return JSON.stringify(identity);
}

function summaryFor(candidates) {
  const byOwner = new Map();
  for (const candidate of candidates) {
    byOwner.set(candidate.proposedOwner, (byOwner.get(candidate.proposedOwner) ?? 0) + 1);
  }
  return {
    total: candidates.length,
    direct: candidates.filter(candidate => candidate.mappingDependency === null).length,
    conditional: candidates.filter(candidate => candidate.mappingDependency !== null).length,
    approved: candidates.filter(candidate => candidate.decision === 'APPROVED').length,
    pending: candidates.filter(candidate => candidate.decision === 'PENDING').length,
    byOwner: [...byOwner.entries()]
      .map(([ownerName, taskCount]) => ({ ownerName, taskCount }))
      .sort((left, right) => left.ownerName.localeCompare(right.ownerName)),
  };
}

export function prepareNotionBonsaiOwnerDecision({
  review,
  reviewSha256,
  preparedAt,
  decision = 'PENDING',
  mappingDecisionRecord = null,
  mappingDecisionSha256 = null,
  taskLinkDecisionRecord = null,
  taskLinkDecisionSha256 = null,
  approver = null,
  decidedAt = null,
  reference = null,
}) {
  if (!['PENDING', 'APPROVED'].includes(decision)) throw new TypeError('decision must be PENDING or APPROVED');
  const reviewPrepared = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewPrepared) throw new TypeError('preparedAt must not predate the review packet');

  const candidates = sourceBackedCandidates(review);
  const conditional = candidates.some(candidate => candidate.mappingDependency !== null);
  let mappingSha = null;
  let taskLinkSha = null;
  let decisionEvidence = null;
  if (decision === 'APPROVED') {
    if (!text(approver) || !text(reference)) throw new TypeError('Approval requires an approver and reference');
    const decided = timestamp(decidedAt, 'decidedAt');
    if (decided < reviewPrepared || decided > prepared) throw new TypeError('decidedAt is outside the evidence window');
    if (conditional) {
      mappingSha = sha256(mappingDecisionSha256, 'mappingDecisionSha256');
      const mappingResult = verifyNotionBonsaiMappingDecision({
        review,
        reviewSha256,
        record: mappingDecisionRecord,
      });
      if (!mappingResult.valid || !mappingResult.complete || mappingResult.pending !== 0
        || mappingResult.rejected !== 0 || mappingResult.approved !== mappingDecisionRecord.candidates.length) {
        throw new TypeError('Every conditional owner candidate requires an approved valid mapping decision');
      }
    }
    taskLinkSha = sha256(taskLinkDecisionSha256, 'taskLinkDecisionSha256');
    const taskLinkResult = verifyNotionBonsaiTaskLinkDecision({
      review,
      reviewSha256,
      record: taskLinkDecisionRecord,
      mappingDecision: conditional ? mappingDecisionRecord : null,
      mappingDecisionSha256: conditional ? mappingDecisionSha256 : null,
    });
    if (!taskLinkResult.valid || !taskLinkResult.complete || taskLinkResult.pending !== 0
      || taskLinkResult.rejected !== 0 || taskLinkResult.approved !== taskLinkDecisionRecord?.candidates?.length) {
      throw new TypeError('Every owner approval requires an approved valid task-link decision');
    }
    decisionEvidence = { approver: text(approver), decidedAt: new Date(decided).toISOString(), reference: text(reference) };
  } else if (mappingDecisionRecord !== null || mappingDecisionSha256 !== null
    || taskLinkDecisionRecord !== null || taskLinkDecisionSha256 !== null
    || approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('Pending owner decisions cannot contain approval evidence');
  }

  const decidedCandidates = candidates.map(candidate => ({ ...candidate, decision }));
  return {
    format: FORMAT,
    version: 1,
    scope: SCOPE,
    complete: decision === 'APPROVED',
    preparedAt: new Date(prepared).toISOString(),
    decisionEvidence,
    candidates: decidedCandidates,
    summary: summaryFor(decidedCandidates),
    safeguards: {
      externalWritesPerformed: false,
      ownerAssignmentsApplied: false,
      projectMappingsApplied: false,
      sourceOnlyDispositionsAuthorized: false,
      financialCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPrepared).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
      mappingDecisionSha256: mappingSha,
      taskLinkDecisionSha256: taskLinkSha,
    },
  };
}

export function verifyNotionBonsaiOwnerDecision({
  review,
  reviewSha256,
  record,
  mappingDecisionRecord = null,
  mappingDecisionSha256 = null,
  taskLinkDecisionRecord = null,
  taskLinkDecisionSha256 = null,
}) {
  const findings = [];
  let expected = [];
  try {
    expected = sourceBackedCandidates(review);
  } catch {
    findings.push('INVALID_REVIEW_PACKET');
  }
  let expectedReviewSha;
  try {
    expectedReviewSha = sha256(reviewSha256, 'reviewSha256');
  } catch {
    findings.push('INVALID_REVIEW_CHECKSUM');
  }
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_OWNER_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== expectedReviewSha
    || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== review?.sourceEvidence?.bonsaiSnapshotSha256) {
    findings.push('SOURCE_EVIDENCE_MISMATCH');
  }

  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length
    || candidates.some((candidate, index) => candidateIdentity(candidate) !== JSON.stringify(expected[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  if (candidates.some(candidate => !['PENDING', 'APPROVED'].includes(candidate?.decision))) findings.push('INVALID_OWNER_DECISION');
  const complete = candidates.length > 0 && candidates.every(candidate => candidate.decision === 'APPROVED');
  if (record?.complete !== complete || JSON.stringify(record?.summary) !== JSON.stringify(summaryFor(candidates))) {
    findings.push('SUMMARY_MISMATCH');
  }

  const reviewTime = Date.parse(String(review?.preparedAt ?? ''));
  const preparedTime = Date.parse(String(record?.preparedAt ?? ''));
  if (!Number.isFinite(reviewTime) || !Number.isFinite(preparedTime) || preparedTime < reviewTime) findings.push('INVALID_PREPARATION_TIME');
  if (complete) {
    const decidedTime = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decidedTime) || decidedTime < reviewTime || decidedTime > preparedTime) {
      findings.push('INVALID_DECISION_EVIDENCE');
    }
    let actualMappingSha;
    try {
      actualMappingSha = sha256(mappingDecisionSha256, 'mappingDecisionSha256');
    } catch {
      findings.push('INVALID_MAPPING_DECISION_CHECKSUM');
    }
    const mappingResult = verifyNotionBonsaiMappingDecision({ review, reviewSha256, record: mappingDecisionRecord });
    if (record?.sourceEvidence?.mappingDecisionSha256 !== actualMappingSha
      || !mappingResult.valid || !mappingResult.complete || mappingResult.pending !== 0
      || mappingResult.rejected !== 0 || mappingResult.approved !== mappingDecisionRecord?.candidates?.length) {
      findings.push('MAPPING_DECISION_DEPENDENCY_FAILED');
    }
    let actualTaskLinkSha;
    try {
      actualTaskLinkSha = sha256(taskLinkDecisionSha256, 'taskLinkDecisionSha256');
    } catch {
      findings.push('INVALID_TASK_LINK_DECISION_CHECKSUM');
    }
    const taskLinkResult = verifyNotionBonsaiTaskLinkDecision({
      review,
      reviewSha256,
      record: taskLinkDecisionRecord,
      mappingDecision: mappingDecisionRecord,
      mappingDecisionSha256,
    });
    if (record?.sourceEvidence?.taskLinkDecisionSha256 !== actualTaskLinkSha
      || !taskLinkResult.valid || !taskLinkResult.complete || taskLinkResult.pending !== 0
      || taskLinkResult.rejected !== 0 || taskLinkResult.approved !== taskLinkDecisionRecord?.candidates?.length) {
      findings.push('TASK_LINK_DECISION_DEPENDENCY_FAILED');
    }
  } else if (record?.decisionEvidence !== null || record?.sourceEvidence?.mappingDecisionSha256 !== null
    || (record?.sourceEvidence?.taskLinkDecisionSha256 ?? null) !== null) {
    findings.push('UNEXPECTED_APPROVAL_EVIDENCE');
  }

  if (record?.safeguards?.externalWritesPerformed !== false
    || record?.safeguards?.ownerAssignmentsApplied !== false
    || record?.safeguards?.projectMappingsApplied !== false
    || record?.safeguards?.sourceOnlyDispositionsAuthorized !== false
    || record?.safeguards?.financialCutoverAuthorized !== false) findings.push('SAFEGUARD_MISMATCH');

  return {
    valid: findings.length === 0,
    complete,
    total: candidates.length,
    direct: candidates.filter(candidate => candidate.mappingDependency === null).length,
    conditional: candidates.filter(candidate => candidate.mappingDependency !== null).length,
    approved: candidates.filter(candidate => candidate.decision === 'APPROVED').length,
    pending: candidates.filter(candidate => candidate.decision === 'PENDING').length,
    findings,
  };
}

export { FORMAT as NOTION_BONSAI_OWNER_DECISION_FORMAT, SCOPE as NOTION_BONSAI_OWNER_DECISION_SCOPE };
