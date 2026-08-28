import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiProjectDispositionDecision } from './notionBonsaiProjectDispositionDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-project-disposition-review-brief';
const VERSION = 2;
const DECISION_FORMAT = 'ashbi-notion-bonsai-project-disposition-decision';
const DECISION_SCOPE = 'ALL_SOURCE_PROJECT_AND_DUPLICATE_TITLE_DISPOSITIONS';
const SUPPLEMENTAL_FORMAT = 'ashbi-notion-bonsai-duplicate-project-live-evidence';
const SUPPLEMENTAL_SCOPE = 'SAME_CLIENT_DUPLICATE_TITLE_GROUPS_ONLY';

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

function validateInputs({
  review,
  reviewSha256,
  projectLinkDecision,
  projectLinkDecisionSha256,
  projectDispositionDecision,
}) {
  const links = verifyNotionBonsaiNativeProjectLinkDecision({
    review, reviewSha256, record: projectLinkDecision,
  });
  const dispositions = verifyNotionBonsaiProjectDispositionDecision({
    review,
    reviewSha256,
    projectLinkDecision,
    projectLinkDecisionSha256,
    record: projectDispositionDecision,
  });
  if (!links.valid || !dispositions.valid
    || projectDispositionDecision?.format !== DECISION_FORMAT
    || projectDispositionDecision?.version !== 2
    || projectDispositionDecision?.scope !== DECISION_SCOPE
    || projectDispositionDecision?.complete !== false
    || dispositions.decided !== 0
    || dispositions.pending !== dispositions.total
    || !Array.isArray(projectDispositionDecision?.candidates)) {
    throw new TypeError('A valid fully pending project disposition decision packet is required');
  }
  return {
    candidates: projectDispositionDecision.candidates,
    linksById: new Map(projectLinkDecision.candidates.map(candidate => [candidate.candidateId, candidate])),
  };
}

function duplicateMembership(candidates) {
  const groupsByMember = new Map();
  for (const group of candidates.filter(candidate => candidate.sourceKind === 'BONSAI_DUPLICATE_TITLE_GROUP')) {
    for (const id of group.duplicateMemberProjectIds) {
      const groups = groupsByMember.get(String(id)) ?? [];
      groups.push(group.candidateId);
      groupsByMember.set(String(id), groups);
    }
  }
  return groupsByMember;
}

function supplementalEvidenceByCandidate(supplementalEvidence, candidates) {
  if (supplementalEvidence === null || supplementalEvidence === undefined) return new Map();
  if (supplementalEvidence?.format !== SUPPLEMENTAL_FORMAT
    || supplementalEvidence?.version !== 1
    || supplementalEvidence?.scope !== SUPPLEMENTAL_SCOPE
    || !Array.isArray(supplementalEvidence?.candidates)) {
    throw new TypeError('Valid supplemental duplicate-project evidence is required');
  }
  const prepared = timestamp(supplementalEvidence?.preparedAt, 'supplemental evidence preparedAt');
  const observed = timestamp(supplementalEvidence?.sourceObservedAt, 'supplemental evidence sourceObservedAt');
  if (observed > prepared) throw new TypeError('Source observation cannot postdate supplemental evidence');
  const known = new Map(candidates
    .filter(candidate => candidate.sourceKind === 'BONSAI_DUPLICATE_TITLE_GROUP')
    .map(candidate => [candidate.candidateId, candidate]));
  const evidenceById = new Map();
  for (const evidence of supplementalEvidence.candidates) {
    const id = text(evidence?.candidateId);
    const candidate = known.get(id);
    if (!candidate || evidenceById.has(id) || text(evidence?.title) !== candidate.project
      || evidence?.inference !== true
      || !['SAME_LOGICAL_PROJECT', 'RETAIN_DISTINCT'].includes(evidence?.conclusion)) {
      throw new TypeError(`Supplemental duplicate-project evidence does not bind the candidate: ${id}`);
    }
    const sourceMembers = new Map(candidate.duplicateMembers.map(member => [String(member.bonsaiProjectId), member]));
    const sourceCompanies = new Set(candidate.duplicateMembers.map(member => text(member.company)).filter(Boolean));
    const members = Array.isArray(evidence?.members) ? evidence.members : [];
    if (sourceCompanies.size !== 1 || members.length !== sourceMembers.size
      || new Set(members.map(member => text(member?.bonsaiProjectId))).size !== members.length) {
      throw new TypeError(`Supplemental evidence is limited to complete same-client duplicate groups: ${id}`);
    }
    for (const member of members) {
      const source = sourceMembers.get(text(member?.bonsaiProjectId));
      const counters = ['invoiceCount', 'contractCount', 'taskCount', 'timeEntryCount', 'noteCount'];
      if (!source || text(member?.status) !== source.status || text(member?.company) !== source.company
        || !text(member?.projectNumber) || !text(member?.dateWindow)
        || counters.some(key => !Number.isInteger(member?.[key]) || member[key] < 0)
        || (member.invoiceCount === 0 && (member.invoiceNumberRange !== null || member.invoiceIssuedDateRange !== null))
        || (member.invoiceCount > 0 && (!text(member.invoiceNumberRange) || !text(member.invoiceIssuedDateRange)))) {
        throw new TypeError(`Supplemental evidence member does not bind the source project: ${id}`);
      }
    }
    const signals = Array.isArray(evidence?.signals) ? evidence.signals : [];
    const signalTypes = signals.map(signal => text(signal?.type));
    if (signals.length < 2 || signals.some(signal => !text(signal?.type) || !text(signal?.value))
      || new Set(signalTypes).size !== signalTypes.length) {
      throw new TypeError(`Supplemental evidence requires distinct bounded signals: ${id}`);
    }
    evidenceById.set(id, evidence);
  }
  const safeguardKeys = [
    'externalWritesPerformed', 'projectDispositionDecisionsRecorded', 'projectLinksApplied',
    'duplicateGroupsConsolidated', 'projectsCreatedChangedArchivedOrDeleted',
    'tasksOwnersLifecycleOrFinancialsChanged', 'paymentSettlementEvidenceComplete',
    'migrationOrCutoverAuthorized',
  ];
  if (safeguardKeys.some(key => supplementalEvidence?.safeguards?.[key] !== false)) {
    throw new TypeError('Supplemental evidence safeguards must remain false');
  }
  return evidenceById;
}

function recommend(candidate, linksById, groupsByMember, supplementalById) {
  const shared = {
    candidateId: candidate.candidateId,
    sourceKind: candidate.sourceKind,
    notionSourceId: candidate.notionSourceId,
    bonsaiProjectId: candidate.bonsaiProjectId,
    project: candidate.project,
    status: candidate.status,
    company: candidate.company,
    url: candidate.url,
    linkedCandidateIds: candidate.linkedCandidateIds,
    duplicateMemberProjectIds: candidate.duplicateMemberProjectIds,
    duplicateMembers: candidate.duplicateMembers,
  };

  if (candidate.sourceKind === 'BONSAI_DUPLICATE_TITLE_GROUP') {
    const members = Array.isArray(candidate.duplicateMembers) ? candidate.duplicateMembers : [];
    const companies = members.map(member => text(member.company)).filter(Boolean);
    if (members.length >= 2 && companies.length === members.length && new Set(companies).size === members.length) {
      return {
        ...shared,
        recommendation: 'APPROVAL_READY',
        recommendedDisposition: 'RETAIN_DISTINCT_WITH_EVIDENCE',
        reasonCode: 'UNIQUE_CLIENT_PER_STABLE_PROJECT_MEMBER',
        projectLinkCandidateId: null,
        prerequisites: ['PRESERVE_STABLE_BONSAI_PROJECT_IDS', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
      };
    }
    const supplemental = supplementalById.get(candidate.candidateId);
    if (supplemental) {
      const sameLogicalProject = supplemental.conclusion === 'SAME_LOGICAL_PROJECT';
      return {
        ...shared,
        recommendation: 'APPROVAL_READY',
        recommendedDisposition: sameLogicalProject
          ? 'MANUALLY_MAP_MEMBERS_WITH_EVIDENCE'
          : 'RETAIN_DISTINCT_WITH_EVIDENCE',
        reasonCode: sameLogicalProject
          ? 'CHECKSUM_BOUND_LIVE_SAME_LOGICAL_PROJECT_EVIDENCE'
          : 'CHECKSUM_BOUND_LIVE_DISTINCT_ENGAGEMENT_EVIDENCE',
        projectLinkCandidateId: null,
        supportingEvidenceCandidateId: candidate.candidateId,
        prerequisites: sameLogicalProject
          ? ['CANONICAL_PROJECT_SELECTION_AT_IMPORT', 'PRESERVE_ALL_SOURCE_IDS', 'CONFIRMED_IMPORT_AND_RECONCILIATION']
          : ['PRESERVE_STABLE_BONSAI_PROJECT_IDS', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
      };
    }
    return {
      ...shared,
      recommendation: 'MANUAL_REVIEW',
      recommendedDisposition: null,
      reasonCode: 'SAME_CLIENT_REPEATED_TITLE_NEEDS_ENGAGEMENT_EVIDENCE',
      projectLinkCandidateId: null,
      supportingEvidenceCandidateId: null,
      prerequisites: ['LIVE_PROJECT_HISTORY_OR_CONTRACT_EVIDENCE'],
    };
  }

  const relatedLinks = candidate.linkedCandidateIds.map(id => linksById.get(id)).filter(Boolean);
  const pendingLinks = relatedLinks.filter(link => link.decision === 'PENDING');
  const approvedLinks = relatedLinks.filter(link => link.decision === 'APPROVED');
  if (pendingLinks.length > 0) {
    return {
      ...shared,
      recommendation: 'BLOCKED',
      recommendedDisposition: null,
      reasonCode: 'PROJECT_LINK_DECISION_PENDING',
      projectLinkCandidateId: null,
      prerequisites: pendingLinks.map(link => link.candidateId),
    };
  }
  if (approvedLinks.length === 1) {
    return {
      ...shared,
      recommendation: 'APPROVAL_READY',
      recommendedDisposition: 'RESOLVED_BY_APPROVED_LINK',
      reasonCode: 'EXACT_APPROVED_PROJECT_LINK_RESOLUTION',
      projectLinkCandidateId: approvedLinks[0].candidateId,
      prerequisites: ['PRESERVE_BOTH_SOURCE_IDS', 'CONFIRMED_IMPORT_AND_RECONCILIATION'],
    };
  }
  if (approvedLinks.length > 1) {
    return {
      ...shared,
      recommendation: 'MANUAL_REVIEW',
      recommendedDisposition: null,
      reasonCode: 'AMBIGUOUS_MULTIPLE_APPROVED_PROJECT_LINKS',
      projectLinkCandidateId: null,
      prerequisites: ['PROJECT_IDENTITY_REPAIR'],
    };
  }

  const duplicateGroupCandidateIds = candidate.sourceKind === 'BONSAI_PROJECT'
    ? (groupsByMember.get(String(candidate.bonsaiProjectId)) ?? [])
    : [];
  return {
    ...shared,
    recommendation: 'APPROVAL_READY',
    recommendedDisposition: 'MIGRATE_TO_HUB',
    reasonCode: candidate.sourceKind === 'NOTION_PROJECT'
      ? 'VERIFIED_SOURCE_ONLY_NOTION_PROJECT'
      : 'VERIFIED_SOURCE_ONLY_BONSAI_PROJECT',
    projectLinkCandidateId: null,
    prerequisites: [
      ...(duplicateGroupCandidateIds.length ? duplicateGroupCandidateIds : []),
      'PRESERVE_SOURCE_LIFECYCLE_AND_IDENTITY',
      'CONFIRMED_IMPORT_AND_RECONCILIATION',
    ],
  };
}

function canonical(value) { return JSON.stringify(value); }

export function prepareNotionBonsaiProjectDispositionReviewBrief({
  review,
  reviewSha256,
  projectLinkDecision,
  projectLinkDecisionSha256,
  projectDispositionDecision,
  projectDispositionDecisionSha256,
  supplementalEvidence = null,
  supplementalEvidenceSha256 = null,
  preparedAt,
}) {
  const reviewPreparedAt = timestamp(review?.preparedAt, 'review preparedAt');
  const linkPreparedAt = timestamp(projectLinkDecision?.preparedAt, 'project-link decision preparedAt');
  const dispositionPreparedAt = timestamp(projectDispositionDecision?.preparedAt, 'project disposition decision preparedAt');
  const supplementalPreparedAt = supplementalEvidence
    ? timestamp(supplementalEvidence?.preparedAt, 'supplemental evidence preparedAt')
    : null;
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewPreparedAt || prepared < linkPreparedAt || prepared < dispositionPreparedAt
    || (supplementalPreparedAt !== null && prepared < supplementalPreparedAt)) {
    throw new TypeError('preparedAt must not predate source evidence');
  }
  const { candidates: sourceCandidates, linksById } = validateInputs({
    review, reviewSha256, projectLinkDecision, projectLinkDecisionSha256, projectDispositionDecision,
  });
  const groupsByMember = duplicateMembership(sourceCandidates);
  const supplementalById = supplementalEvidenceByCandidate(supplementalEvidence, sourceCandidates);
  const candidates = sourceCandidates.map(candidate => recommend(candidate, linksById, groupsByMember, supplementalById));
  const approvalReady = candidates.filter(candidate => candidate.recommendation === 'APPROVAL_READY').length;
  const blocked = candidates.filter(candidate => candidate.recommendation === 'BLOCKED').length;
  const manualReview = candidates.filter(candidate => candidate.recommendation === 'MANUAL_REVIEW').length;
  const sourceKinds = ['NOTION_PROJECT', 'BONSAI_PROJECT', 'BONSAI_DUPLICATE_TITLE_GROUP'];

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
        RESOLVED_BY_APPROVED_LINK: candidates.filter(candidate => candidate.recommendedDisposition === 'RESOLVED_BY_APPROVED_LINK').length,
        MIGRATE_TO_HUB: candidates.filter(candidate => candidate.recommendedDisposition === 'MIGRATE_TO_HUB').length,
        RETAIN_DISTINCT_WITH_EVIDENCE: candidates.filter(candidate => candidate.recommendedDisposition === 'RETAIN_DISTINCT_WITH_EVIDENCE').length,
        MANUALLY_MAP_MEMBERS_WITH_EVIDENCE: candidates.filter(candidate => candidate.recommendedDisposition === 'MANUALLY_MAP_MEMBERS_WITH_EVIDENCE').length,
      },
      bySourceKind: Object.fromEntries(sourceKinds.map(sourceKind => [sourceKind, {
        total: candidates.filter(candidate => candidate.sourceKind === sourceKind).length,
        approvalReady: candidates.filter(candidate => candidate.sourceKind === sourceKind && candidate.recommendation === 'APPROVAL_READY').length,
        blocked: candidates.filter(candidate => candidate.sourceKind === sourceKind && candidate.recommendation === 'BLOCKED').length,
        manualReview: candidates.filter(candidate => candidate.sourceKind === sourceKind && candidate.recommendation === 'MANUAL_REVIEW').length,
      }])),
    },
    recommendationMeaning: 'Approval-ready is a bounded recommendation for Cameron to review. Blocked candidates require the named upstream project-link decision. No recommendation is a recorded disposition, applied link, consolidation, import, reconciliation result, lifecycle or financial change, or cutover authorization.',
    safeguards: {
      externalWritesPerformed: false,
      projectDispositionDecisionsRecorded: false,
      sourceRecordsDeleted: false,
      projectsCreatedOrChanged: false,
      projectLinksApplied: false,
      duplicateGroupsConsolidated: false,
      tasksOwnersLifecycleOrFinancialsChanged: false,
      migrationApplied: false,
      reconciliationConfirmed: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewPreparedAt).toISOString(),
      projectLinkDecisionSha256: sha256(projectLinkDecisionSha256, 'projectLinkDecisionSha256'),
      projectLinkDecisionPreparedAt: new Date(linkPreparedAt).toISOString(),
      projectDispositionDecisionSha256: sha256(projectDispositionDecisionSha256, 'projectDispositionDecisionSha256'),
      projectDispositionDecisionPreparedAt: new Date(dispositionPreparedAt).toISOString(),
      supplementalEvidenceSha256: supplementalEvidence
        ? sha256(supplementalEvidenceSha256, 'supplementalEvidenceSha256')
        : null,
      supplementalEvidencePreparedAt: supplementalPreparedAt === null
        ? null
        : new Date(supplementalPreparedAt).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiProjectSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256'),
      taskReviewSha256: sha256(review?.sourceEvidence?.taskReviewSha256, 'taskReviewSha256'),
    },
  };
}

export function verifyNotionBonsaiProjectDispositionReviewBrief({
  review,
  reviewSha256,
  projectLinkDecision,
  projectLinkDecisionSha256,
  projectDispositionDecision,
  projectDispositionDecisionSha256,
  supplementalEvidence = null,
  supplementalEvidenceSha256 = null,
  record,
}) {
  const findings = [];
  let expected;
  try {
    expected = prepareNotionBonsaiProjectDispositionReviewBrief({
      review,
      reviewSha256,
      projectLinkDecision,
      projectLinkDecisionSha256,
      projectDispositionDecision,
      projectDispositionDecisionSha256,
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
    blocked: expected?.summary?.blocked ?? 0,
    manualReview: expected?.summary?.manualReview ?? 0,
    findings,
  };
}

export { FORMAT as NOTION_BONSAI_PROJECT_DISPOSITION_REVIEW_BRIEF_FORMAT };
