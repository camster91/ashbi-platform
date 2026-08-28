const FORMAT = 'ashbi-notion-bonsai-native-project-link-decision';
const SCOPE = 'LOGICAL_PROJECT_IDENTITY_ONLY';
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

function sourceId(value, name) {
  const id = text(value);
  if (!id) throw new TypeError(`${name} is required`);
  return id;
}

function candidateId(tier, notionSourceId, bonsaiProjectId) {
  const notionId = sourceId(notionSourceId, 'notionSourceId').split('/').pop();
  return `project-link:${tier.toLowerCase()}:${notionId}:${sourceId(bonsaiProjectId, 'bonsaiProjectId')}`;
}

function sharedIdentity(candidate, tier, risk) {
  const notionSourceId = sourceId(candidate?.notionSourceId, 'notionSourceId');
  const bonsaiProjectId = sourceId(candidate?.bonsaiProjectId, 'bonsaiProjectId');
  return {
    candidateId: candidateId(tier, notionSourceId, bonsaiProjectId),
    tier,
    risk,
    notionSourceId,
    notionProject: text(candidate?.notionProject),
    notionStatus: text(candidate?.notionStatus ?? candidate?.status),
    bonsaiProjectId,
    bonsaiProject: text(candidate?.bonsaiProject),
    bonsaiStatus: text(candidate?.bonsaiStatus),
    evidence: text(candidate?.evidence),
  };
}

function reviewCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-native-project-review'
    || review?.version !== 1
    || !Array.isArray(review?.exactProjectLinks)
    || !Array.isArray(review?.taskEvidencedProjectCandidates)
    || !Array.isArray(review?.possibleTitlePairs)) {
    throw new TypeError('A valid native Notion/Bonsai project review is required');
  }

  const candidates = [
    ...review.exactProjectLinks.map(candidate => ({
      ...sharedIdentity(candidate, 'EXACT_TITLE', 'LOW'),
      lifecycleMatch: candidate.lifecycleMatch === true,
    })),
    ...review.taskEvidencedProjectCandidates.map(candidate => ({
      ...sharedIdentity(candidate, 'TASK_EVIDENCED', 'MEDIUM'),
      lifecycleMatch: candidate.lifecycleMatch === true,
      exactSharedTaskCount: Number(candidate.exactSharedTaskCount ?? 0),
      taskEvidence: Array.isArray(candidate.taskEvidence) ? candidate.taskEvidence : [],
    })),
    ...review.possibleTitlePairs.map(candidate => ({
      ...sharedIdentity(candidate, 'SUGGESTED', 'HIGH'),
      reviewScore: Number(candidate.reviewScore),
      titleTokenDiceSimilarity: Number(candidate.titleTokenDiceSimilarity),
      companyTokenDiceSimilarity: Number(candidate.companyTokenDiceSimilarity),
      candidateRank: Number(candidate.candidateRank),
    })),
  ];
  if (candidates.length === 0) throw new TypeError('The native project review has no link candidates');
  if (new Set(candidates.map(candidate => candidate.candidateId)).size !== candidates.length) {
    throw new TypeError('Native project review candidates do not have unique identities');
  }
  return candidates;
}

function canonicalCandidate(candidate) {
  const { decision: _decision, ...identity } = candidate;
  return JSON.stringify(identity);
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Set(candidates.map(candidate => candidate.candidateId));
  const byId = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const decision = text(item?.decision);
    if (!known.has(id)) throw new TypeError(`Unknown project-link candidate: ${id}`);
    if (byId.has(id)) throw new TypeError(`Duplicate project-link decision: ${id}`);
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw new TypeError('Recorded decisions must be APPROVED or REJECTED');
    }
    byId.set(id, decision);
  }
  return candidates.map(candidate => ({ ...candidate, decision: byId.get(candidate.candidateId) ?? 'PENDING' }));
}

export function prepareNotionBonsaiNativeProjectLinkDecision({
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
  if (prepared < reviewPreparedAt) throw new TypeError('preparedAt must not predate the native project review');

  const candidates = applyDecisions(reviewCandidates(review), decisions);
  const decidedCount = candidates.filter(candidate => candidate.decision !== 'PENDING').length;
  let decided = null;
  if (decidedCount > 0) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded decisions require an approver and reference');
    decided = timestamp(decidedAt, 'decidedAt');
    if (decided < reviewPreparedAt || decided > prepared) {
      throw new TypeError('decidedAt must be after the review and no later than preparation');
    }
  } else if (approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('A fully pending packet cannot contain decision evidence');
  }

  const approved = candidates.filter(candidate => candidate.decision === 'APPROVED').length;
  const rejected = candidates.filter(candidate => candidate.decision === 'REJECTED').length;
  const pending = candidates.filter(candidate => candidate.decision === 'PENDING').length;
  const byTier = Object.fromEntries(['EXACT_TITLE', 'TASK_EVIDENCED', 'SUGGESTED'].map(tier => [tier, {
    total: candidates.filter(candidate => candidate.tier === tier).length,
    approved: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'APPROVED').length,
    rejected: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'REJECTED').length,
    pending: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'PENDING').length,
  }]));

  return {
    format: FORMAT,
    version: 1,
    scope: SCOPE,
    complete: pending === 0,
    preparedAt: new Date(prepared).toISOString(),
    decisionEvidence: decidedCount > 0 ? {
      approver: text(approver),
      decidedAt: new Date(decided).toISOString(),
      reference: text(reference),
    } : null,
    candidates,
    summary: { total: candidates.length, approved, rejected, pending, byTier },
    approvalMeaning: 'A logical identity decision for the two source project IDs only.',
    safeguards: {
      externalWritesPerformed: false,
      projectLinksApplied: false,
      projectsCreated: false,
      tasksMoved: false,
      ownerAssignmentsAuthorized: false,
      lifecycleChangesAuthorized: false,
      sourceRecordsDeleted: false,
      invoicesPaymentsContractsOrTimeAuthorized: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPreparedAt).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiProjectSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256'),
      taskReviewSha256: sha256(review?.sourceEvidence?.taskReviewSha256, 'taskReviewSha256'),
    },
  };
}

export function verifyNotionBonsaiNativeProjectLinkDecision({ review, reviewSha256, record }) {
  const findings = [];
  let expectedCandidates = [];
  try {
    expectedCandidates = reviewCandidates(review);
  } catch {
    findings.push('INVALID_NATIVE_PROJECT_REVIEW');
  }
  let expectedReviewSha;
  try {
    expectedReviewSha = sha256(reviewSha256, 'reviewSha256');
  } catch {
    findings.push('INVALID_REVIEW_CHECKSUM');
  }

  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== expectedReviewSha
    || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiProjectSnapshotSha256 !== review?.sourceEvidence?.bonsaiProjectSnapshotSha256
    || record?.sourceEvidence?.taskReviewSha256 !== review?.sourceEvidence?.taskReviewSha256) {
    findings.push('SOURCE_EVIDENCE_MISMATCH');
  }

  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expectedCandidates.length
    || candidates.some((candidate, index) => canonicalCandidate(candidate) !== JSON.stringify(expectedCandidates[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  if (candidates.some(candidate => !ALLOWED_DECISIONS.has(candidate?.decision))) findings.push('INVALID_CANDIDATE_DECISION');

  const approved = candidates.filter(candidate => candidate.decision === 'APPROVED').length;
  const rejected = candidates.filter(candidate => candidate.decision === 'REJECTED').length;
  const pending = candidates.filter(candidate => candidate.decision === 'PENDING').length;
  const complete = candidates.length > 0 && pending === 0;
  const expectedByTier = Object.fromEntries(['EXACT_TITLE', 'TASK_EVIDENCED', 'SUGGESTED'].map(tier => [tier, {
    total: candidates.filter(candidate => candidate.tier === tier).length,
    approved: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'APPROVED').length,
    rejected: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'REJECTED').length,
    pending: candidates.filter(candidate => candidate.tier === tier && candidate.decision === 'PENDING').length,
  }]));
  if (record?.complete !== complete
    || record?.summary?.total !== candidates.length
    || record?.summary?.approved !== approved
    || record?.summary?.rejected !== rejected
    || record?.summary?.pending !== pending
    || JSON.stringify(record?.summary?.byTier) !== JSON.stringify(expectedByTier)) findings.push('SUMMARY_MISMATCH');

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

  const safeguardKeys = [
    'externalWritesPerformed', 'projectLinksApplied', 'projectsCreated', 'tasksMoved',
    'ownerAssignmentsAuthorized', 'lifecycleChangesAuthorized', 'sourceRecordsDeleted',
    'invoicesPaymentsContractsOrTimeAuthorized', 'migrationOrCutoverAuthorized',
  ];
  if (safeguardKeys.some(key => record?.safeguards?.[key] !== false)
    || record?.approvalMeaning !== 'A logical identity decision for the two source project IDs only.') {
    findings.push('SAFEGUARD_MISMATCH');
  }

  return { valid: findings.length === 0, complete, approved, rejected, pending, findings };
}

export {
  FORMAT as NOTION_BONSAI_NATIVE_PROJECT_LINK_DECISION_FORMAT,
  SCOPE as NOTION_BONSAI_NATIVE_PROJECT_LINK_DECISION_SCOPE,
};
