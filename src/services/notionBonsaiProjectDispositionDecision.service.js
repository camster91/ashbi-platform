import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-project-disposition-decision';
const SCOPE = 'SOURCE_ONLY_AND_DUPLICATE_PROJECT_DISPOSITIONS';

const ALLOWED = {
  NOTION_ONLY: new Set(['PENDING', 'RESOLVED_BY_APPROVED_LINK', 'MIGRATE_TO_HUB', 'RETAIN_NOTION_ONLY', 'EXCLUDE_WITH_EVIDENCE']),
  BONSAI_ONLY: new Set(['PENDING', 'RESOLVED_BY_APPROVED_LINK', 'MIGRATE_TO_HUB', 'RETAIN_BONSAI_ONLY', 'EXCLUDE_WITH_EVIDENCE']),
  BONSAI_DUPLICATE_TITLE_GROUP: new Set(['PENDING', 'RETAIN_DISTINCT_WITH_EVIDENCE', 'MANUALLY_MAP_MEMBERS_WITH_EVIDENCE', 'REPAIR_SOURCE_AND_RECAPTURE', 'EXCLUDE_GROUP_FINDING_WITH_EVIDENCE']),
};

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
function sourceId(value, name) {
  const result = text(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}
function candidateId(kind, id) {
  return `project-disposition:${kind.toLowerCase()}:${String(id).split('/').pop()}`;
}

function verifyLinkDependency(review, reviewSha256, projectLinkDecision, projectLinkDecisionSha256) {
  const result = verifyNotionBonsaiNativeProjectLinkDecision({
    review, reviewSha256, record: projectLinkDecision,
  });
  if (!result.valid) throw new TypeError('A checksum-valid project-link decision is required');
  return {
    hash: sha256(projectLinkDecisionSha256, 'projectLinkDecisionSha256'),
    candidates: projectLinkDecision.candidates,
  };
}

function reviewCandidates(review, linkCandidates) {
  if (review?.format !== 'ashbi-notion-bonsai-native-project-review' || review?.version !== 1
    || !Array.isArray(review?.unmatchedNotionProjects) || !Array.isArray(review?.unmatchedBonsaiProjects)
    || !Array.isArray(review?.duplicateBonsaiTitles)) {
    throw new TypeError('A valid native Notion/Bonsai project review is required');
  }
  const linksFor = (field, value) => linkCandidates
    .filter(candidate => String(candidate?.[field]) === String(value))
    .map(candidate => candidate.candidateId)
    .sort();
  const candidates = [
    ...review.unmatchedNotionProjects.map(item => {
      const id = sourceId(item.notionSourceId, 'notionSourceId');
      return {
        candidateId: candidateId('NOTION_ONLY', id), sourceKind: 'NOTION_ONLY', notionSourceId: id,
        bonsaiProjectId: null, project: text(item.project), status: text(item.status), company: null, url: null,
        linkedCandidateIds: linksFor('notionSourceId', id), duplicateMemberProjectIds: [],
      };
    }),
    ...review.unmatchedBonsaiProjects.map(item => {
      const id = sourceId(item.bonsaiProjectId, 'bonsaiProjectId');
      return {
        candidateId: candidateId('BONSAI_ONLY', id), sourceKind: 'BONSAI_ONLY', notionSourceId: null,
        bonsaiProjectId: id, project: text(item.project), status: text(item.status), company: text(item.company),
        url: text(item.url), linkedCandidateIds: linksFor('bonsaiProjectId', id), duplicateMemberProjectIds: [],
      };
    }),
    ...review.duplicateBonsaiTitles.map(item => {
      const title = sourceId(item.title, 'duplicate title');
      const members = Array.isArray(item.projects) ? item.projects.map(project => ({
        bonsaiProjectId: sourceId(project.id, 'duplicate member project id'),
        status: text(project.status), company: text(project.company), url: text(project.url),
      })).sort((left, right) => left.bonsaiProjectId.localeCompare(right.bonsaiProjectId)) : [];
      if (members.length < 2) throw new TypeError('Duplicate-title groups require at least two projects');
      return {
        candidateId: candidateId('BONSAI_DUPLICATE_TITLE_GROUP', encodeURIComponent(title.toLowerCase())),
        sourceKind: 'BONSAI_DUPLICATE_TITLE_GROUP', notionSourceId: null, bonsaiProjectId: null,
        project: title, status: null, company: null, url: null, linkedCandidateIds: [],
        duplicateMemberProjectIds: members.map(member => member.bonsaiProjectId), duplicateMembers: members,
      };
    }),
  ].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (!candidates.length || new Set(candidates.map(item => item.candidateId)).size !== candidates.length) {
    throw new TypeError('Project disposition candidates require unique source identities');
  }
  return candidates;
}

function relevantLinkDecisions(candidate, linkCandidates) {
  const ids = new Set(candidate.linkedCandidateIds);
  return linkCandidates.filter(link => ids.has(link.candidateId));
}

function validateChosenDisposition(candidate, chosen, linkCandidates) {
  const disposition = text(chosen?.disposition);
  if (!ALLOWED[candidate.sourceKind]?.has(disposition) || disposition === 'PENDING') {
    throw new TypeError(`Disposition is not allowed for ${candidate.sourceKind}`);
  }
  if (!text(chosen?.rationale) || !text(chosen?.reference)) {
    throw new TypeError('Every recorded project disposition requires a rationale and evidence reference');
  }
  const related = relevantLinkDecisions(candidate, linkCandidates);
  const approved = related.filter(link => link.decision === 'APPROVED');
  const pending = related.filter(link => link.decision === 'PENDING');
  const resolutionId = text(chosen?.projectLinkCandidateId) || null;
  if (candidate.sourceKind !== 'BONSAI_DUPLICATE_TITLE_GROUP') {
    if (pending.length > 0) throw new TypeError('Project disposition must wait for related project-link decisions');
    if (approved.length > 0) {
      if (disposition !== 'RESOLVED_BY_APPROVED_LINK' || approved.length !== 1 || resolutionId !== approved[0].candidateId) {
        throw new TypeError('An approved project link must be recorded as the exact disposition resolution');
      }
    } else if (disposition === 'RESOLVED_BY_APPROVED_LINK' || resolutionId !== null) {
      throw new TypeError('A link resolution requires one approved related project-link candidate');
    }
  } else if (resolutionId !== null || disposition === 'RESOLVED_BY_APPROVED_LINK') {
    throw new TypeError('Duplicate-title group classification cannot be resolved by one project link');
  }
  return {
    disposition, rationale: text(chosen.rationale), reference: text(chosen.reference),
    projectLinkCandidateId: resolutionId,
  };
}

function applyDecisions(candidates, decisions, linkCandidates) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const chosen = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const candidate = known.get(id);
    if (!candidate) throw new TypeError(`Unknown project disposition candidate: ${id}`);
    if (chosen.has(id)) throw new TypeError(`Duplicate project disposition decision: ${id}`);
    chosen.set(id, validateChosenDisposition(candidate, item, linkCandidates));
  }
  return candidates.map(candidate => ({
    ...candidate,
    ...(chosen.get(candidate.candidateId) ?? {
      disposition: 'PENDING', rationale: null, reference: null, projectLinkCandidateId: null,
    }),
  }));
}

function identity(candidate) {
  const { disposition: _disposition, rationale: _rationale, reference: _reference,
    projectLinkCandidateId: _projectLinkCandidateId, ...rest } = candidate;
  return JSON.stringify(rest);
}

function summary(candidates) {
  const dispositions = [...new Set(candidates.map(candidate => candidate.disposition))].sort();
  return {
    total: candidates.length,
    pending: candidates.filter(candidate => candidate.disposition === 'PENDING').length,
    decided: candidates.filter(candidate => candidate.disposition !== 'PENDING').length,
    bySourceKind: Object.fromEntries(Object.keys(ALLOWED).map(kind => [kind, candidates.filter(candidate => candidate.sourceKind === kind).length])),
    byDisposition: Object.fromEntries(dispositions.map(disposition => [disposition, candidates.filter(candidate => candidate.disposition === disposition).length])),
  };
}

export function prepareNotionBonsaiProjectDispositionDecision({
  review, reviewSha256, projectLinkDecision, projectLinkDecisionSha256, preparedAt,
  decisions = [], approver = null, decidedAt = null, reference = null,
}) {
  const reviewTime = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewTime || prepared < timestamp(projectLinkDecision?.preparedAt, 'project-link preparedAt')) {
    throw new TypeError('preparedAt must not predate source decisions');
  }
  const reviewHash = sha256(reviewSha256, 'reviewSha256');
  const link = verifyLinkDependency(review, reviewHash, projectLinkDecision, projectLinkDecisionSha256);
  const candidates = applyDecisions(reviewCandidates(review, link.candidates), decisions, link.candidates);
  const totals = summary(candidates);
  let evidence = null;
  if (totals.decided > 0) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded dispositions require an approver and batch reference');
    const decisionTime = timestamp(decidedAt, 'decidedAt');
    if (decisionTime < reviewTime || decisionTime > prepared) throw new TypeError('decidedAt is outside the evidence window');
    evidence = { approver: text(approver), decidedAt: new Date(decisionTime).toISOString(), reference: text(reference) };
  } else if (approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('A fully pending packet cannot contain decision evidence');
  }
  return {
    format: FORMAT, version: 1, scope: SCOPE, complete: totals.pending === 0,
    preparedAt: new Date(prepared).toISOString(), decisionEvidence: evidence, candidates, summary: totals,
    safeguards: {
      externalWritesPerformed: false, sourceRecordsDeleted: false, projectsCreatedOrChanged: false,
      projectLinksApplied: false, dispositionsApplied: false, duplicateGroupsConsolidated: false,
      tasksOwnersLifecycleOrFinancialsChanged: false, migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: reviewHash, projectLinkDecisionSha256: link.hash,
      reviewPreparedAt: new Date(reviewTime).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiProjectSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256'),
      taskReviewSha256: sha256(review?.sourceEvidence?.taskReviewSha256, 'taskReviewSha256'),
    },
  };
}

export function verifyNotionBonsaiProjectDispositionDecision(options) {
  const findings = [];
  let expected = [];
  let linkCandidates = [];
  let reviewHash;
  let linkHash;
  try {
    reviewHash = sha256(options.reviewSha256, 'reviewSha256');
    const link = verifyLinkDependency(options.review, reviewHash, options.projectLinkDecision, options.projectLinkDecisionSha256);
    linkHash = link.hash;
    linkCandidates = link.candidates;
    expected = reviewCandidates(options.review, linkCandidates);
  } catch { findings.push('INVALID_SOURCE_EVIDENCE'); }
  const { record } = options;
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== reviewHash
    || record?.sourceEvidence?.projectLinkDecisionSha256 !== linkHash
    || record?.sourceEvidence?.reviewPreparedAt !== options.review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== options.review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiProjectSnapshotSha256 !== options.review?.sourceEvidence?.bonsaiProjectSnapshotSha256
    || record?.sourceEvidence?.taskReviewSha256 !== options.review?.sourceEvidence?.taskReviewSha256) findings.push('SOURCE_EVIDENCE_MISMATCH');
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  for (const candidate of candidates) {
    if (candidate.disposition === 'PENDING') {
      if (candidate.rationale !== null || candidate.reference !== null || candidate.projectLinkCandidateId !== null) findings.push('INVALID_DISPOSITION');
    } else {
      try { validateChosenDisposition(candidate, candidate, linkCandidates); } catch { findings.push('INVALID_DISPOSITION'); }
    }
  }
  const totals = summary(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const reviewTime = Date.parse(String(options.review?.preparedAt ?? ''));
  const linkTime = Date.parse(String(options.projectLinkDecision?.preparedAt ?? ''));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (![reviewTime, linkTime, prepared].every(Number.isFinite) || prepared < reviewTime || prepared < linkTime) findings.push('INVALID_PREPARATION_TIME');
  if (totals.decided > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < reviewTime || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'sourceRecordsDeleted', 'projectsCreatedOrChanged', 'projectLinksApplied',
    'dispositionsApplied', 'duplicateGroupsConsolidated', 'tasksOwnersLifecycleOrFinancialsChanged', 'migrationOrCutoverAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)) findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0, ...totals, findings: [...new Set(findings)] };
}

export { FORMAT as NOTION_BONSAI_PROJECT_DISPOSITION_DECISION_FORMAT };
