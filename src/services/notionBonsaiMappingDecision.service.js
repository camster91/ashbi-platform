const FORMAT = 'ashbi-notion-bonsai-mapping-decision';
const VERSION = 2;
const SCOPE = 'PROJECT_ALIASES_AND_NEAR_TITLE_LINK';
const ALLOWED_DECISIONS = new Set(['PENDING', 'APPROVED', 'REJECTED']);

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

function reviewCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review'
    || review?.version !== 1
    || !Array.isArray(review?.projectAliasCandidates)
    || !Array.isArray(review?.nearTitleCandidates)) {
    throw new TypeError('A valid Notion/Bonsai task review packet is required');
  }
  if (review.projectAliasCandidates.length === 0 && review.nearTitleCandidates.length === 0) {
    throw new TypeError('The review packet has no mapping candidates');
  }

  return [
    ...review.projectAliasCandidates.map(candidate => ({
      candidateId: `mapping:project-alias:${text(candidate.notionProject)}=>${text(candidate.bonsaiProject)}`,
      kind: 'PROJECT_ALIAS',
      notionProject: text(candidate.notionProject),
      bonsaiProject: text(candidate.bonsaiProject),
      evidence: Array.isArray(candidate.evidence)
        ? candidate.evidence.map(item => ({
          notionSourceId: text(item.notionSourceId),
          bonsaiSourceId: text(item.bonsaiSourceId),
          taskTitle: text(item.taskTitle),
        }))
        : [],
    })),
    ...review.nearTitleCandidates.map(candidate => ({
      candidateId: `mapping:near-title:${text(candidate.notionSourceId).split('/').pop()}:${text(candidate.bonsaiSourceId)}`,
      kind: 'NEAR_TITLE_TASK_LINK',
      notionSourceId: text(candidate.notionSourceId),
      bonsaiSourceId: text(candidate.bonsaiSourceId),
      notionTitle: text(candidate.notionTitle),
      bonsaiTitle: text(candidate.bonsaiTitle),
      notionProject: text(candidate.notionProject),
      bonsaiProject: text(candidate.bonsaiProject),
      tokenDiceSimilarity: candidate.tokenDiceSimilarity,
    })),
  ];
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Set(candidates.map(candidate => candidate.candidateId));
  if (known.size !== candidates.length) throw new TypeError('Mapping candidates require unique identities');
  const selected = new Map();
  for (const item of decisions) {
    const candidateId = text(item?.candidateId);
    const decision = text(item?.decision);
    if (!known.has(candidateId)) throw new TypeError(`Unknown mapping candidate: ${candidateId}`);
    if (selected.has(candidateId)) throw new TypeError(`Duplicate mapping decision: ${candidateId}`);
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new TypeError('Recorded mapping decisions must be APPROVED or REJECTED');
    selected.set(candidateId, decision);
  }
  return candidates.map(candidate => ({ ...candidate, decision: selected.get(candidate.candidateId) ?? 'PENDING' }));
}

function canonicalCandidate(candidate) {
  const { decision: _decision, ...identity } = candidate;
  return JSON.stringify(identity);
}

function checkCandidateIdentity(actual, expected) {
  return canonicalCandidate(actual) === JSON.stringify(expected);
}

export function prepareNotionBonsaiMappingDecision({
  review,
  reviewSha256,
  preparedAt,
  decisions = [],
  approver = null,
  decidedAt = null,
  reference = null,
}) {
  const reviewPreparedAt = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewPreparedAt) throw new TypeError('preparedAt must not predate the review packet');

  const candidates = applyDecisions(reviewCandidates(review), decisions);
  const approved = candidates.filter(candidate => candidate.decision === 'APPROVED').length;
  const rejected = candidates.filter(candidate => candidate.decision === 'REJECTED').length;
  const pending = candidates.filter(candidate => candidate.decision === 'PENDING').length;
  const decidedCount = approved + rejected;
  let decided = null;
  if (decidedCount > 0) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded decisions require an approver and reference');
    decided = timestamp(decidedAt, 'decidedAt');
    if (decided < reviewPreparedAt || decided > prepared) {
      throw new TypeError('decidedAt must be after the review and no later than preparation');
    }
  } else if (approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('Pending decisions cannot contain approval evidence');
  }

  return {
    format: FORMAT,
    version: VERSION,
    scope: SCOPE,
    complete: pending === 0,
    preparedAt: new Date(prepared).toISOString(),
    decisionEvidence: decidedCount > 0 ? {
      approver: text(approver),
      decidedAt: new Date(decided).toISOString(),
      reference: text(reference),
    } : null,
    candidates,
    summary: {
      total: candidates.length,
      approved,
      rejected,
      pending,
    },
    safeguards: {
      externalWritesPerformed: false,
      mappingApplied: false,
      ownerAssignmentsAuthorized: false,
      sourceOnlyDispositionsAuthorized: false,
      financialCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPreparedAt).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
    },
  };
}

export function verifyNotionBonsaiMappingDecision({ review, reviewSha256, record }) {
  const findings = [];
  let expectedCandidates = [];
  try {
    expectedCandidates = reviewCandidates(review);
  } catch {
    findings.push('INVALID_REVIEW_PACKET');
  }

  let expectedReviewSha;
  try {
    expectedReviewSha = sha256(reviewSha256, 'reviewSha256');
  } catch {
    findings.push('INVALID_REVIEW_CHECKSUM');
  }

  if (record?.format !== FORMAT || record?.version !== VERSION || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== expectedReviewSha
    || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== review?.sourceEvidence?.bonsaiSnapshotSha256) {
    findings.push('SOURCE_EVIDENCE_MISMATCH');
  }

  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expectedCandidates.length
    || candidates.some((candidate, index) => !checkCandidateIdentity(candidate, expectedCandidates[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  if (candidates.some(candidate => !ALLOWED_DECISIONS.has(candidate?.decision))) findings.push('INVALID_CANDIDATE_DECISION');

  const approved = candidates.filter(candidate => candidate.decision === 'APPROVED').length;
  const rejected = candidates.filter(candidate => candidate.decision === 'REJECTED').length;
  const pending = candidates.filter(candidate => candidate.decision === 'PENDING').length;
  const complete = candidates.length > 0 && pending === 0;
  if (record?.complete !== complete
    || record?.summary?.total !== candidates.length
    || record?.summary?.approved !== approved
    || record?.summary?.rejected !== rejected
    || record?.summary?.pending !== pending) findings.push('SUMMARY_MISMATCH');

  const reviewTime = Date.parse(String(review?.preparedAt ?? ''));
  const preparedTime = Date.parse(String(record?.preparedAt ?? ''));
  if (!Number.isFinite(preparedTime) || !Number.isFinite(reviewTime) || preparedTime < reviewTime) findings.push('INVALID_PREPARATION_TIME');

  if (approved + rejected > 0) {
    const decidedTime = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver)
      || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decidedTime)
      || decidedTime < reviewTime
      || decidedTime > preparedTime) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');

  const expectedSafeguards = record?.safeguards?.externalWritesPerformed === false
    && record?.safeguards?.mappingApplied === false
    && record?.safeguards?.ownerAssignmentsAuthorized === false
    && record?.safeguards?.sourceOnlyDispositionsAuthorized === false
    && record?.safeguards?.financialCutoverAuthorized === false;
  if (!expectedSafeguards) findings.push('SAFEGUARD_MISMATCH');

  return {
    valid: findings.length === 0,
    complete,
    approved,
    rejected,
    pending,
    findings,
  };
}

export { FORMAT as NOTION_BONSAI_MAPPING_DECISION_FORMAT, VERSION as NOTION_BONSAI_MAPPING_DECISION_VERSION, SCOPE as NOTION_BONSAI_MAPPING_DECISION_SCOPE };
