import { verifyBonsaiActiveProjectDispositionDecision } from './bonsaiActiveProjectDispositionDecision.service.js';

const FORMAT = 'ashbi-bonsai-active-project-outcome-review-brief';
const VERSION = 1;

function canonical(value) { return JSON.stringify(value); }
function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}
function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}

function validatePendingDecision(options) {
  const verification = verifyBonsaiActiveProjectDispositionDecision({ ...options, record: options.decision });
  if (!verification.valid || options.decision?.complete !== false || verification.decided !== 0
    || verification.pending !== verification.total || !Array.isArray(options.decision?.candidates)) {
    throw new TypeError('A valid fully pending active-project outcome packet is required');
  }
  return options.decision.candidates;
}

function recommendation(candidate, options) {
  const projectDisposition = options.projectDispositionDecision.candidates
    .find(item => item.candidateId === candidate.projectDispositionCandidateId);
  const projectLinks = options.projectLinkDecision.candidates
    .filter(item => candidate.projectLinkCandidateIds.includes(item.candidateId));
  const shared = {
    candidateId: candidate.candidateId,
    bonsaiProjectId: candidate.bonsaiProjectId,
    project: candidate.project,
    company: candidate.company,
    projectGroup: candidate.projectGroup,
    triageBucket: candidate.triageBucket,
    duplicateTitleGroup: candidate.duplicateTitleGroup,
    taskCount: candidate.taskCount,
    notionSourceId: candidate.notionSourceId,
    projectLinkCandidateIds: candidate.projectLinkCandidateIds,
    projectDispositionCandidateId: candidate.projectDispositionCandidateId,
    financialEvidence: candidate.financialEvidence,
  };
  if (!projectDisposition || projectDisposition.disposition === 'PENDING'
    || projectLinks.some(link => link.decision === 'PENDING')) {
    return {
      ...shared,
      recommendation: 'BLOCKED',
      recommendedOutcome: null,
      reasonCode: 'PROJECT_IDENTITY_OR_SOURCE_DISPOSITION_PENDING',
      prerequisites: ['PROJECT_LINK_DECISIONS_COMPLETE', 'PROJECT_DISPOSITION_DECISIONS_COMPLETE'],
    };
  }
  const outcomeByDisposition = {
    MIGRATE_TO_HUB: 'MIGRATE_ACTIVE_TO_HUB',
    RESOLVED_BY_APPROVED_LINK: 'MIGRATE_ACTIVE_TO_HUB',
    RETAIN_BONSAI_SOURCE: 'RETAIN_ACTIVE_IN_BONSAI',
    EXCLUDE_WITH_EVIDENCE: 'EXCLUDE_ACTIVE_WITH_EVIDENCE',
  };
  const recommendedOutcome = outcomeByDisposition[projectDisposition.disposition];
  if (!recommendedOutcome) {
    return {
      ...shared,
      recommendation: 'MANUAL_REVIEW',
      recommendedOutcome: null,
      reasonCode: 'SOURCE_DISPOSITION_HAS_NO_BOUNDED_ACTIVE_OUTCOME',
      prerequisites: ['EXPLICIT_ACTIVE_PROJECT_OUTCOME_EVIDENCE'],
    };
  }
  return {
    ...shared,
    recommendation: 'APPROVAL_READY',
    recommendedOutcome,
    reasonCode: `PRESERVE_${projectDisposition.disposition}_WITHOUT_APPLYING_PROJECT_CHANGE`,
    prerequisites: ['CONFIRMED_IMPORT_AND_RECONCILIATION', 'PARALLEL_RUN'],
  };
}

export function prepareBonsaiActiveProjectOutcomeReviewBrief(options) {
  const sourceTimes = [
    timestamp(options.triage?.preparedAt, 'triage preparedAt'),
    timestamp(options.financialReview?.preparedAt, 'financial review preparedAt'),
    timestamp(options.projectLinkDecision?.preparedAt, 'project link preparedAt'),
    timestamp(options.projectDispositionDecision?.preparedAt, 'project disposition preparedAt'),
    timestamp(options.decision?.preparedAt, 'active-project decision preparedAt'),
  ];
  const prepared = timestamp(options.preparedAt, 'preparedAt');
  if (sourceTimes.some(value => prepared < value)) throw new TypeError('preparedAt must not predate source evidence');
  const candidates = validatePendingDecision(options).map(candidate => recommendation(candidate, options));
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
      closureRecommended: candidates.filter(candidate => candidate.recommendedOutcome === 'CLOSE_AFTER_FINANCIAL_CLEARANCE').length,
      byRecommendedOutcome: Object.fromEntries(['MIGRATE_ACTIVE_TO_HUB', 'RETAIN_ACTIVE_IN_BONSAI', 'EXCLUDE_ACTIVE_WITH_EVIDENCE']
        .map(outcome => [outcome, candidates.filter(candidate => candidate.recommendedOutcome === outcome).length])),
    },
    recommendationMeaning: 'Approval-ready preserves an already decided source-project disposition as an active-project outcome for a later confirmed import. It is not a project mutation, closure, archive, financial clearance, migration, cutover, or Bonsai retirement authorization.',
    safeguards: {
      externalWritesPerformed: false,
      activeProjectOutcomesRecorded: false,
      projectsCreatedOrChanged: false,
      projectsClosedOrArchived: false,
      tasksOwnersLifecycleOrFinancialsChanged: false,
      outcomesApplied: false,
      closureRecommended: false,
      migrationOrCutoverAuthorized: false,
      bonsaiRetirementAuthorized: false,
    },
    sourceEvidence: {
      activeProjectTriageSha256: sha256(options.triageSha256, 'triageSha256'),
      financialReviewSha256: sha256(options.financialReviewSha256, 'financialReviewSha256'),
      nativeProjectReviewSha256: sha256(options.nativeProjectReviewSha256, 'nativeProjectReviewSha256'),
      projectLinkDecisionSha256: sha256(options.projectLinkDecisionSha256, 'projectLinkDecisionSha256'),
      projectDispositionDecisionSha256: sha256(options.projectDispositionDecisionSha256, 'projectDispositionDecisionSha256'),
      activeProjectDecisionSha256: sha256(options.decisionSha256, 'decisionSha256'),
    },
  };
}

export function verifyBonsaiActiveProjectOutcomeReviewBrief(options) {
  const findings = [];
  let expected;
  try { expected = prepareBonsaiActiveProjectOutcomeReviewBrief({ ...options, preparedAt: options.record?.preparedAt }); }
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

export { FORMAT as BONSAI_ACTIVE_PROJECT_OUTCOME_REVIEW_BRIEF_FORMAT };
