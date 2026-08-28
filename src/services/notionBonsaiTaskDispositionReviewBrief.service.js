import { verifyNotionBonsaiTaskDispositionDecision } from './notionBonsaiTaskDispositionDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-task-disposition-review-brief';
const VERSION = 1;
const DECISION_FORMAT = 'ashbi-notion-bonsai-task-disposition-decision';
const DECISION_SCOPE = 'SOURCE_ONLY_AND_MALFORMED_TASK_DISPOSITIONS';

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

function validatePendingDecision({ review, reviewSha256, decision }) {
  const verification = verifyNotionBonsaiTaskDispositionDecision({ review, reviewSha256, record: decision });
  if (!verification.valid
    || decision?.format !== DECISION_FORMAT
    || decision?.version !== 1
    || decision?.scope !== DECISION_SCOPE
    || decision?.complete !== false
    || verification.decided !== 0
    || verification.pending !== verification.total
    || !Array.isArray(decision?.candidates)) {
    throw new TypeError('A valid fully pending task disposition decision packet is required');
  }
  return decision.candidates;
}

function recommend(candidate) {
  const shared = {
    candidateId: candidate.candidateId,
    sourceKind: candidate.sourceKind,
    notionSourceId: candidate.notionSourceId,
    bonsaiSourceId: candidate.bonsaiSourceId,
    title: candidate.title,
    project: candidate.project,
    lifecycleState: candidate.lifecycleState,
    owner: candidate.owner,
    sourceReviewFields: candidate.sourceReviewFields,
  };

  if (candidate.sourceKind === 'NOTION_ONLY' && text(candidate.title) && text(candidate.project)
    && text(candidate.lifecycleState) && candidate.notionSourceId && !candidate.bonsaiSourceId
    && Array.isArray(candidate.sourceReviewFields) && candidate.sourceReviewFields.length === 0) {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'MIGRATE_TO_HUB',
      reasonCode: 'CANONICAL_NOTION_TASK_WITH_VALID_PROJECT_RELATION',
      prerequisites: ['PROJECT_IDENTITY_DECISION', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
    };
  }

  if (candidate.sourceKind === 'BONSAI_ONLY' && text(candidate.title) && text(candidate.project)
    && text(candidate.lifecycleState) && text(candidate.owner) && candidate.bonsaiSourceId
    && !candidate.notionSourceId && Array.isArray(candidate.sourceReviewFields)
    && candidate.sourceReviewFields.length === 0) {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'MIGRATE_TO_HUB',
      reasonCode: 'STRUCTURALLY_VALID_BONSAI_ONLY_TASK',
      prerequisites: ['PROJECT_IDENTITY_DECISION', 'OWNER_IDENTITY_DECISION', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
    };
  }

  if (candidate.sourceKind === 'BONSAI_SOURCE_REVIEW' && candidate.bonsaiSourceId
    && !candidate.notionSourceId && Array.isArray(candidate.sourceReviewFields)
    && candidate.sourceReviewFields.length > 0) {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'REPAIR_SOURCE_AND_RECAPTURE',
      reasonCode: 'MALFORMED_OR_PROJECTLESS_BONSAI_TASK',
      prerequisites: ['SOURCE_REPAIR', 'FRESH_COMPLETE_BONSAI_TASK_CAPTURE', 'REVIEW_REGENERATION'],
    };
  }

  return {
    ...shared,
    recommendation: 'MANUAL_REVIEW',
    recommendedDisposition: null,
    reasonCode: 'UNEXPECTED_OR_INCOMPLETE_SOURCE_STRUCTURE',
    prerequisites: ['ADDITIONAL_SOURCE_EVIDENCE'],
  };
}

function canonical(value) { return JSON.stringify(value); }

export function prepareNotionBonsaiTaskDispositionReviewBrief({
  review,
  reviewSha256,
  decision,
  decisionSha256,
  preparedAt,
}) {
  const reviewPreparedAt = timestamp(review?.preparedAt, 'review preparedAt');
  const decisionPreparedAt = timestamp(decision?.preparedAt, 'decision preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewPreparedAt || prepared < decisionPreparedAt) {
    throw new TypeError('preparedAt must not predate source evidence');
  }
  const candidates = validatePendingDecision({ review, reviewSha256, decision }).map(recommend);
  const approvalReady = candidates.filter(candidate => candidate.recommendation === 'APPROVAL_READY').length;
  const manualReview = candidates.filter(candidate => candidate.recommendation === 'MANUAL_REVIEW').length;
  const sourceKinds = ['NOTION_ONLY', 'BONSAI_ONLY', 'BONSAI_SOURCE_REVIEW'];

  return {
    format: FORMAT,
    version: VERSION,
    complete: manualReview === 0,
    preparedAt: new Date(prepared).toISOString(),
    candidates,
    summary: {
      total: candidates.length,
      approvalReady,
      manualReview,
      byRecommendedDisposition: {
        MIGRATE_TO_HUB: candidates.filter(candidate => candidate.recommendedDisposition === 'MIGRATE_TO_HUB').length,
        REPAIR_SOURCE_AND_RECAPTURE: candidates.filter(candidate => candidate.recommendedDisposition === 'REPAIR_SOURCE_AND_RECAPTURE').length,
      },
      bySourceKind: Object.fromEntries(sourceKinds.map(sourceKind => [sourceKind, {
        total: candidates.filter(candidate => candidate.sourceKind === sourceKind).length,
        approvalReady: candidates.filter(candidate => candidate.sourceKind === sourceKind && candidate.recommendation === 'APPROVAL_READY').length,
        manualReview: candidates.filter(candidate => candidate.sourceKind === sourceKind && candidate.recommendation === 'MANUAL_REVIEW').length,
      }])),
    },
    recommendationMeaning: 'Approval-ready is a bounded recommendation for Cameron to review. It is not a recorded disposition, source repair, task change, import, reconciliation result, or cutover authorization.',
    safeguards: {
      externalWritesPerformed: false,
      taskDispositionDecisionsRecorded: false,
      sourceRecordsDeleted: false,
      tasksCreatedOrChanged: false,
      sourceRepairApplied: false,
      migrationApplied: false,
      reconciliationConfirmed: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPreparedAt).toISOString(),
      decisionSha256: sha256(decisionSha256, 'decisionSha256'),
      decisionPreparedAt: new Date(decisionPreparedAt).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
    },
  };
}

export function verifyNotionBonsaiTaskDispositionReviewBrief({
  review,
  reviewSha256,
  decision,
  decisionSha256,
  record,
}) {
  const findings = [];
  let expected;
  try {
    expected = prepareNotionBonsaiTaskDispositionReviewBrief({
      review,
      reviewSha256,
      decision,
      decisionSha256,
      preparedAt: record?.preparedAt,
    });
  } catch {
    findings.push('INVALID_SOURCE_EVIDENCE');
  }
  if (record?.format !== FORMAT || record?.version !== VERSION) findings.push('INVALID_REVIEW_BRIEF_SCHEMA');
  if (expected && canonical(record) !== canonical(expected)) findings.push('REVIEW_BRIEF_MISMATCH');
  return {
    valid: findings.length === 0,
    complete: expected?.complete === true,
    approvalReady: expected?.summary?.approvalReady ?? 0,
    manualReview: expected?.summary?.manualReview ?? 0,
    findings,
  };
}

export { FORMAT as NOTION_BONSAI_TASK_DISPOSITION_REVIEW_BRIEF_FORMAT };
