import { verifyBonsaiFinancialExceptionDecision } from './bonsaiFinancialExceptionDecision.service.js';

const FORMAT = 'ashbi-bonsai-financial-exception-review-brief';
const VERSION = 1;

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}
function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}
function canonical(value) { return JSON.stringify(value); }

function validatePendingDecision(options) {
  const verification = verifyBonsaiFinancialExceptionDecision({ ...options, record: options.decision });
  if (!verification.valid || options.decision?.complete !== false || verification.decided !== 0
    || verification.pending !== verification.total || !Array.isArray(options.decision?.candidates)) {
    throw new TypeError('A valid fully pending financial exception decision packet is required');
  }
  return options.decision.candidates;
}

function recommendation(candidate) {
  const shared = {
    candidateId: candidate.candidateId,
    exceptionKind: candidate.exceptionKind,
    sourceId: candidate.sourceId,
    projectId: candidate.projectId,
    taskSourceId: candidate.taskSourceId,
    project: candidate.project,
    company: candidate.company,
    invoiceNumber: candidate.invoiceNumber,
    status: candidate.status,
    currency: candidate.currency,
    amount: candidate.amount,
    date: candidate.date,
    dueDate: candidate.dueDate,
    seconds: candidate.seconds,
    linkageState: candidate.linkageState,
  };
  if (candidate.exceptionKind === 'NON_PAID_INVOICE') {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'MIGRATE_WITH_SOURCE_STATUS',
      reasonCode: 'PRESERVE_NON_PAID_SOURCE_STATUS_WITHOUT_SETTLEMENT_CLAIM',
      prerequisites: ['CONFIRMED_IMPORT_AND_RECONCILIATION', 'PARALLEL_RUN'],
    };
  }
  if (candidate.exceptionKind === 'UNBILLED_TIME_ENTRY' && candidate.linkageState === 'PROJECT_LINKED') {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'MIGRATE_AS_UNBILLED',
      reasonCode: 'PRESERVE_LINKED_UNBILLED_TIME_WITHOUT_BILLING_ACTION',
      prerequisites: ['PROJECT_IDENTITY_DECISION', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
    };
  }
  if (candidate.exceptionKind === 'UNBILLED_TIME_ENTRY') {
    return {
      ...shared,
      recommendation: 'MANUAL_REVIEW',
      recommendedDisposition: null,
      reasonCode: 'PROJECTLESS_TIME_REQUIRES_EXPLICIT_LINKAGE_EVIDENCE',
      prerequisites: ['PROJECT_OR_UNLINKED_DISPOSITION_EVIDENCE'],
    };
  }
  return {
    ...shared,
    recommendation: 'BLOCKED',
    recommendedDisposition: null,
    reasonCode: 'CONTRACT_STATUS_REQUIRES_CAPTURE_OR_CAMERON_ATTESTATION',
    prerequisites: ['COMPLETE_CONTRACT_SOURCE_CAPTURE_OR_EXPLICIT_ATTESTATION'],
  };
}

export function prepareBonsaiFinancialExceptionReviewBrief(options) {
  const reviewTime = timestamp(options.financialReview?.preparedAt, 'financial review preparedAt');
  const decisionTime = timestamp(options.decision?.preparedAt, 'decision preparedAt');
  const invoiceTime = timestamp(options.invoiceSnapshot?.capturedAt, 'invoice capturedAt');
  const timeEntryTime = timestamp(options.timeEntrySnapshot?.capturedAt, 'time-entry capturedAt');
  const prepared = timestamp(options.preparedAt, 'preparedAt');
  if (prepared < Math.max(reviewTime, decisionTime, invoiceTime, timeEntryTime)) {
    throw new TypeError('preparedAt must not predate source evidence');
  }
  const candidates = validatePendingDecision(options).map(recommendation);
  const approvalReady = candidates.filter(candidate => candidate.recommendation === 'APPROVAL_READY').length;
  const blocked = candidates.filter(candidate => candidate.recommendation === 'BLOCKED').length;
  const manualReview = candidates.filter(candidate => candidate.recommendation === 'MANUAL_REVIEW').length;
  return {
    format: FORMAT,
    version: VERSION,
    complete: blocked === 0 && manualReview === 0,
    preparedAt: new Date(prepared).toISOString(),
    candidates,
    summary: {
      total: candidates.length,
      approvalReady,
      blocked,
      manualReview,
      byRecommendedDisposition: {
        MIGRATE_WITH_SOURCE_STATUS: candidates.filter(candidate => candidate.recommendedDisposition === 'MIGRATE_WITH_SOURCE_STATUS').length,
        MIGRATE_AS_UNBILLED: candidates.filter(candidate => candidate.recommendedDisposition === 'MIGRATE_AS_UNBILLED').length,
      },
      byExceptionKind: Object.fromEntries(['NON_PAID_INVOICE', 'UNBILLED_TIME_ENTRY', 'ACTIVE_PROJECT_CONTRACT_GAP'].map(kind => [kind, {
        total: candidates.filter(candidate => candidate.exceptionKind === kind).length,
        approvalReady: candidates.filter(candidate => candidate.exceptionKind === kind && candidate.recommendation === 'APPROVAL_READY').length,
        blocked: candidates.filter(candidate => candidate.exceptionKind === kind && candidate.recommendation === 'BLOCKED').length,
        manualReview: candidates.filter(candidate => candidate.exceptionKind === kind && candidate.recommendation === 'MANUAL_REVIEW').length,
      }])),
    },
    recommendationMeaning: 'Approval-ready preserves the exact non-paid invoice or linked unbilled-time source state for a later confirmed import. It is not settlement evidence, billing or collection authority, a payment action, a contract attestation, an applied disposition, reconciliation, cutover, or Bonsai retirement authorization.',
    safeguards: {
      externalWritesPerformed: false,
      financialExceptionDecisionsRecorded: false,
      invoicesChanged: false,
      paymentsChanged: false,
      timeEntriesChanged: false,
      contractsChanged: false,
      billingOrCollectionAuthorized: false,
      migrationApplied: false,
      reconciliationConfirmed: false,
      migrationOrCutoverAuthorized: false,
      bonsaiRetirementAuthorized: false,
    },
    sourceEvidence: {
      financialReviewSha256: sha256(options.financialReviewSha256, 'financialReviewSha256'),
      invoiceSnapshotSha256: sha256(options.invoiceSnapshotSha256, 'invoiceSnapshotSha256'),
      timeEntrySnapshotSha256: sha256(options.timeEntrySnapshotSha256, 'timeEntrySnapshotSha256'),
      decisionSha256: sha256(options.decisionSha256, 'decisionSha256'),
      financialReviewPreparedAt: new Date(reviewTime).toISOString(),
      invoiceCapturedAt: new Date(invoiceTime).toISOString(),
      timeEntryCapturedAt: new Date(timeEntryTime).toISOString(),
      decisionPreparedAt: new Date(decisionTime).toISOString(),
    },
  };
}

export function verifyBonsaiFinancialExceptionReviewBrief(options) {
  const findings = [];
  let expected;
  try { expected = prepareBonsaiFinancialExceptionReviewBrief({ ...options, preparedAt: options.record?.preparedAt }); }
  catch { findings.push('INVALID_SOURCE_EVIDENCE'); }
  if (options.record?.format !== FORMAT || options.record?.version !== VERSION) findings.push('INVALID_REVIEW_BRIEF_SCHEMA');
  if (expected && canonical(options.record) !== canonical(expected)) findings.push('REVIEW_BRIEF_MISMATCH');
  return {
    valid: findings.length === 0,
    complete: expected?.complete === true,
    approvalReady: expected?.summary?.approvalReady ?? 0,
    blocked: expected?.summary?.blocked ?? 0,
    manualReview: expected?.summary?.manualReview ?? 0,
    findings,
  };
}

export { FORMAT as BONSAI_FINANCIAL_EXCEPTION_REVIEW_BRIEF_FORMAT };
