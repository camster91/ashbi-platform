import { prepareNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-native-project-link-review-brief';
const VERSION = 2;
const MAPPING_FORMAT = 'ashbi-notion-bonsai-mapping-decision';
const SUPPLEMENTAL_FORMAT = 'ashbi-notion-bonsai-project-link-live-evidence';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase('en-CA').replace(/\s+/g, ' ');
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

function approvedMappingByProjectPair(mappingDecision) {
  if (mappingDecision?.format !== MAPPING_FORMAT
    || mappingDecision?.version !== 2
    || !Array.isArray(mappingDecision?.candidates)) {
    throw new TypeError('A valid candidate-specific mapping decision is required');
  }

  const approved = new Map();
  for (const candidate of mappingDecision.candidates) {
    if (candidate?.decision !== 'APPROVED') continue;
    const notionProject = normalized(candidate?.notionProject);
    const bonsaiProject = normalized(candidate?.bonsaiProject);
    if (!notionProject || !bonsaiProject) continue;
    const key = `${notionProject}\u0000${bonsaiProject}`;
    if (approved.has(key)) throw new TypeError('Approved mapping evidence is ambiguous for a project pair');
    approved.set(key, text(candidate.candidateId));
  }
  return approved;
}

function supplementalEvidenceByCandidate(supplementalEvidence, candidates) {
  if (supplementalEvidence === null || supplementalEvidence === undefined) return new Map();
  if (supplementalEvidence?.format !== SUPPLEMENTAL_FORMAT
    || supplementalEvidence?.version !== 1
    || supplementalEvidence?.scope !== 'LOGICAL_PROJECT_IDENTITY_ONLY'
    || !Array.isArray(supplementalEvidence?.candidates)) {
    throw new TypeError('Valid supplemental live project-link evidence is required');
  }
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const evidenceById = new Map();
  const evidencePreparedAt = timestamp(supplementalEvidence?.preparedAt, 'supplemental evidence preparedAt');
  for (const evidence of supplementalEvidence.candidates) {
    const id = text(evidence?.candidateId);
    const candidate = known.get(id);
    if (!candidate || candidate.tier !== 'SUGGESTED') throw new TypeError(`Unknown suggested project-link evidence: ${id}`);
    if (evidenceById.has(id)) throw new TypeError(`Duplicate suggested project-link evidence: ${id}`);
    if (evidence?.conclusion !== 'SAME_LOGICAL_PROJECT' || evidence?.inference !== true
      || text(evidence?.notionSourceId) !== candidate.notionSourceId
      || text(evidence?.notionProject) !== candidate.notionProject
      || (candidate.notionStatus && text(evidence?.notionStatus) !== candidate.notionStatus)
      || text(evidence?.bonsaiProjectId) !== candidate.bonsaiProjectId
      || text(evidence?.bonsaiProject) !== candidate.bonsaiProject
      || (candidate.bonsaiStatus && text(evidence?.bonsaiStatus) !== candidate.bonsaiStatus)
      || !text(evidence?.bonsaiCompany)
      || !Number.isInteger(evidence?.bonsaiTitleSearchResultCount)
      || evidence.bonsaiTitleSearchResultCount < 1) {
      throw new TypeError(`Suggested project-link evidence does not bind the candidate: ${id}`);
    }
    const notionObservedAt = timestamp(evidence?.notionSourceObservedAt, 'notionSourceObservedAt');
    if (notionObservedAt > evidencePreparedAt) throw new TypeError('Source observation cannot postdate supplemental evidence');
    const signals = Array.isArray(evidence?.signals) ? evidence.signals : [];
    const signalTypes = signals.map(signal => text(signal?.type));
    if (signals.length < 2
      || signals.some(signal => !text(signal?.type) || !text(signal?.value))
      || new Set(signalTypes).size !== signalTypes.length) {
      throw new TypeError(`Suggested project-link evidence requires distinct bounded signals: ${id}`);
    }
    evidenceById.set(id, evidence);
  }
  const safeguardKeys = [
    'externalWritesPerformed', 'projectLinkDecisionsRecorded', 'projectLinksApplied',
    'lifecycleChangesAuthorized', 'financialChangesAuthorized',
    'paymentSettlementEvidenceComplete', 'migrationOrCutoverAuthorized',
  ];
  if (safeguardKeys.some(key => supplementalEvidence?.safeguards?.[key] !== false)) {
    throw new TypeError('Supplemental evidence safeguards must remain false');
  }
  return evidenceById;
}

function recommendations({ review, reviewSha256, mappingDecision, supplementalEvidence, preparedAt }) {
  const pending = prepareNotionBonsaiNativeProjectLinkDecision({
    review,
    reviewSha256,
    preparedAt,
  });
  const approvedMappings = approvedMappingByProjectPair(mappingDecision);
  const supplementalById = supplementalEvidenceByCandidate(supplementalEvidence, pending.candidates);

  return pending.candidates.map(candidate => {
    const shared = {
      candidateId: candidate.candidateId,
      tier: candidate.tier,
      risk: candidate.risk,
      notionSourceId: candidate.notionSourceId,
      notionProject: candidate.notionProject,
      notionStatus: candidate.notionStatus,
      bonsaiProjectId: candidate.bonsaiProjectId,
      bonsaiProject: candidate.bonsaiProject,
      bonsaiStatus: candidate.bonsaiStatus,
      sourceEvidence: candidate.evidence,
    };

    if (candidate.tier === 'EXACT_TITLE' && candidate.lifecycleMatch === true) {
      return {
        ...shared,
        recommendation: 'APPROVAL_READY',
        recommendedDecision: 'APPROVED',
        reasonCode: 'UNIQUE_EXACT_TITLE_AND_LIFECYCLE',
        supportingDecisionCandidateId: null,
        supportingEvidenceCandidateId: null,
      };
    }

    if (candidate.tier === 'TASK_EVIDENCED') {
      const key = `${normalized(candidate.notionProject)}\u0000${normalized(candidate.bonsaiProject)}`;
      const supportingDecisionCandidateId = approvedMappings.get(key) ?? null;
      if (candidate.lifecycleMatch === true && supportingDecisionCandidateId) {
        return {
          ...shared,
          recommendation: 'APPROVAL_READY',
          recommendedDecision: 'APPROVED',
          reasonCode: 'APPROVED_TASK_BACKED_PROJECT_MAPPING',
          supportingDecisionCandidateId,
          supportingEvidenceCandidateId: null,
        };
      }
    }

    if (candidate.tier === 'SUGGESTED' && supplementalById.has(candidate.candidateId)) {
      return {
        ...shared,
        recommendation: 'APPROVAL_READY',
        recommendedDecision: 'APPROVED',
        reasonCode: 'CHECKSUM_BOUND_LIVE_SOURCE_IDENTITY_EVIDENCE',
        supportingDecisionCandidateId: null,
        supportingEvidenceCandidateId: candidate.candidateId,
      };
    }

    return {
      ...shared,
      recommendation: 'MANUAL_REVIEW',
      recommendedDecision: null,
      reasonCode: candidate.tier === 'SUGGESTED'
        ? 'SIMILARITY_ONLY_NOT_IDENTITY_EVIDENCE'
        : 'INSUFFICIENT_APPROVED_IDENTITY_EVIDENCE',
      supportingDecisionCandidateId: null,
      supportingEvidenceCandidateId: null,
    };
  });
}

function canonical(value) {
  return JSON.stringify(value);
}

export function prepareNotionBonsaiNativeProjectLinkReviewBrief({
  review,
  reviewSha256,
  mappingDecision,
  mappingDecisionSha256,
  supplementalEvidence = null,
  supplementalEvidenceSha256 = null,
  preparedAt,
}) {
  const reviewPreparedAt = timestamp(review?.preparedAt, 'review preparedAt');
  const mappingPreparedAt = timestamp(mappingDecision?.preparedAt, 'mapping decision preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  const supplementalPreparedAt = supplementalEvidence
    ? timestamp(supplementalEvidence?.preparedAt, 'supplemental evidence preparedAt')
    : null;
  if (prepared < reviewPreparedAt || prepared < mappingPreparedAt
    || (supplementalPreparedAt !== null && prepared < supplementalPreparedAt)) {
    throw new TypeError('preparedAt must not predate source evidence');
  }
  const mappingTaskReviewSha256 = mappingDecision?.sourceEvidence?.taskReviewSha256
    ?? mappingDecision?.sourceEvidence?.reviewSha256;
  if (mappingTaskReviewSha256 !== review?.sourceEvidence?.taskReviewSha256) {
    throw new TypeError('Mapping decision and native project review must share one task-review generation');
  }

  const candidates = recommendations({ review, reviewSha256, mappingDecision, supplementalEvidence, preparedAt });
  const approvalReady = candidates.filter(candidate => candidate.recommendation === 'APPROVAL_READY').length;
  const manualReview = candidates.filter(candidate => candidate.recommendation === 'MANUAL_REVIEW').length;

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
      byTier: Object.fromEntries(['EXACT_TITLE', 'TASK_EVIDENCED', 'SUGGESTED'].map(tier => [tier, {
        total: candidates.filter(candidate => candidate.tier === tier).length,
        approvalReady: candidates.filter(candidate => candidate.tier === tier && candidate.recommendation === 'APPROVAL_READY').length,
        manualReview: candidates.filter(candidate => candidate.tier === tier && candidate.recommendation === 'MANUAL_REVIEW').length,
      }])),
    },
    recommendationMeaning: 'Approval-ready is a bounded recommendation for Cameron to review, not an approval or an applied project link.',
    safeguards: {
      externalWritesPerformed: false,
      projectLinkDecisionsRecorded: false,
      projectLinksApplied: false,
      projectLifecycleChangesAuthorized: false,
      financialChangesAuthorized: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPreparedAt).toISOString(),
      mappingDecisionSha256: sha256(mappingDecisionSha256, 'mappingDecisionSha256'),
      mappingDecisionPreparedAt: new Date(mappingPreparedAt).toISOString(),
      supplementalEvidenceSha256: supplementalEvidence
        ? sha256(supplementalEvidenceSha256, 'supplementalEvidenceSha256')
        : null,
      supplementalEvidencePreparedAt: supplementalPreparedAt === null
        ? null
        : new Date(supplementalPreparedAt).toISOString(),
      taskReviewSha256: sha256(review?.sourceEvidence?.taskReviewSha256, 'taskReviewSha256'),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiProjectSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256'),
    },
  };
}

export function verifyNotionBonsaiNativeProjectLinkReviewBrief({
  review,
  reviewSha256,
  mappingDecision,
  mappingDecisionSha256,
  supplementalEvidence = null,
  supplementalEvidenceSha256 = null,
  record,
}) {
  const findings = [];
  let expected;
  try {
    expected = prepareNotionBonsaiNativeProjectLinkReviewBrief({
      review,
      reviewSha256,
      mappingDecision,
      mappingDecisionSha256,
      supplementalEvidence,
      supplementalEvidenceSha256,
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

export { FORMAT as NOTION_BONSAI_NATIVE_PROJECT_LINK_REVIEW_BRIEF_FORMAT };
