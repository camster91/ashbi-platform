import { verifyNotionBonsaiTaskLinkDecision } from './notionBonsaiTaskLinkDecision.service.js';

const FORMAT = 'ashbi-notion-bonsai-task-disposition-decision';
const VERSION = 2;
const SCOPE = 'ALL_SOURCE_TASK_DISPOSITIONS';
const ALLOWED = {
  NOTION_TASK: new Set(['PENDING', 'RESOLVED_BY_APPROVED_LINK', 'MIGRATE_TO_HUB', 'RETAIN_NOTION_SOURCE', 'EXCLUDE_WITH_EVIDENCE']),
  BONSAI_TASK: new Set(['PENDING', 'RESOLVED_BY_APPROVED_LINK', 'MIGRATE_TO_HUB', 'RETAIN_BONSAI_SOURCE', 'EXCLUDE_WITH_EVIDENCE']),
  BONSAI_SOURCE_REVIEW: new Set(['PENDING', 'REPAIR_SOURCE_AND_RECAPTURE', 'MANUALLY_MAP_WITH_EVIDENCE', 'EXCLUDE_WITH_EVIDENCE']),
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
function candidateId(kind, id) { return `task-disposition:${kind.toLowerCase()}:${id.split('/').pop()}`; }

function verifyLinkDependency({ review, reviewSha256, taskLinkDecision, taskLinkDecisionSha256, mappingDecision, mappingDecisionSha256 }) {
  const hash = sha256(taskLinkDecisionSha256, 'taskLinkDecisionSha256');
  const mappingRequired = Boolean(taskLinkDecision?.sourceEvidence?.mappingDecisionSha256);
  const verification = verifyNotionBonsaiTaskLinkDecision({
    review, reviewSha256, record: taskLinkDecision,
    mappingDecision: mappingRequired ? mappingDecision : null,
    mappingDecisionSha256: mappingRequired ? mappingDecisionSha256 : null,
  });
  if (!verification.valid) throw new TypeError('A checksum-valid task-link decision is required');
  return {
    hash,
    mappingHash: mappingRequired ? sha256(mappingDecisionSha256, 'mappingDecisionSha256') : null,
    candidates: taskLinkDecision.candidates,
  };
}

function reviewCandidates(review, linkCandidates) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review' || review?.version !== 1
    || !Array.isArray(review?.notionOnly) || !Array.isArray(review?.bonsaiOnly)
    || !Array.isArray(review?.bonsaiSourceReview)) throw new TypeError('A valid Notion/Bonsai task review is required');
  const linksFor = (field, value) => linkCandidates
    .filter(candidate => text(candidate?.[field]) === text(value))
    .map(candidate => candidate.candidateId).sort();
  const notion = new Map(review.notionOnly.map(item => [text(item.notionSourceId), {
    notionSourceId: item.notionSourceId, title: item.title, project: item.project,
    lifecycleState: item.status, owner: null,
  }]));
  const bonsai = new Map(review.bonsaiOnly.map(item => [text(item.bonsaiSourceId), {
    bonsaiSourceId: item.bonsaiSourceId, title: item.title, project: item.project,
    lifecycleState: item.lifecycleState, owner: item.owner,
  }]));
  for (const link of linkCandidates) {
    if (!notion.has(text(link.notionSourceId))) notion.set(text(link.notionSourceId), {
      notionSourceId: link.notionSourceId, title: link.notionTitle, project: link.notionProject,
      lifecycleState: link.lifecycleMatch ? 'LINKED_LIFECYCLE_MATCH' : 'LINKED_LIFECYCLE_REVIEW', owner: null,
    });
    if (!bonsai.has(text(link.bonsaiSourceId))) bonsai.set(text(link.bonsaiSourceId), {
      bonsaiSourceId: link.bonsaiSourceId, title: link.bonsaiTitle, project: link.bonsaiProject,
      lifecycleState: link.lifecycleMatch ? 'LINKED_LIFECYCLE_MATCH' : 'LINKED_LIFECYCLE_REVIEW', owner: null,
    });
  }
  const sourceReviewIds = new Set(review.bonsaiSourceReview.map(item => text(item.bonsaiSourceId)));
  if ([...sourceReviewIds].some(id => bonsai.has(id))) throw new TypeError('A Bonsai task cannot be both structurally valid and source-review only');
  const candidates = [
    ...[...notion.values()].map(item => {
      const id = sourceId(item.notionSourceId, 'notionSourceId');
      return {
        candidateId: candidateId('NOTION_TASK', id), sourceKind: 'NOTION_TASK', notionSourceId: id,
        bonsaiSourceId: null, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.lifecycleState), owner: null, sourceReviewFields: [],
        linkedCandidateIds: linksFor('notionSourceId', id),
      };
    }),
    ...[...bonsai.values()].map(item => {
      const id = sourceId(item.bonsaiSourceId, 'bonsaiSourceId');
      return {
        candidateId: candidateId('BONSAI_TASK', id), sourceKind: 'BONSAI_TASK', notionSourceId: null,
        bonsaiSourceId: id, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.lifecycleState), owner: text(item.owner), sourceReviewFields: [],
        linkedCandidateIds: linksFor('bonsaiSourceId', id),
      };
    }),
    ...review.bonsaiSourceReview.map(item => {
      const id = sourceId(item.bonsaiSourceId, 'bonsaiSourceId');
      return {
        candidateId: candidateId('BONSAI_SOURCE_REVIEW', id), sourceKind: 'BONSAI_SOURCE_REVIEW', notionSourceId: null,
        bonsaiSourceId: id, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.lifecycleState), owner: text(item.owner),
        sourceReviewFields: Array.isArray(item.fields) ? item.fields.map(text).filter(Boolean).sort() : [],
        linkedCandidateIds: [],
      };
    }),
  ].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (!candidates.length || new Set(candidates.map(item => item.candidateId)).size !== candidates.length) {
    throw new TypeError('Task disposition candidates require unique source identities');
  }
  return candidates;
}

function validateChosenDisposition(candidate, item, linkCandidates) {
  const disposition = text(item?.disposition);
  if (!ALLOWED[candidate.sourceKind].has(disposition) || disposition === 'PENDING') {
    throw new TypeError(`Disposition is not allowed for ${candidate.sourceKind}`);
  }
  if (!text(item?.rationale) || !text(item?.reference)) {
    throw new TypeError('Every recorded disposition requires a rationale and evidence reference');
  }
  const links = candidate.linkedCandidateIds.map(id => linkCandidates.find(link => link.candidateId === id));
  const pendingLinks = links.filter(link => link?.decision === 'PENDING');
  const approvedLinks = links.filter(link => link?.decision === 'APPROVED');
  const selectedLink = text(item?.taskLinkCandidateId) || null;
  if (pendingLinks.length) throw new TypeError('A task with a pending identity decision cannot be dispositioned');
  if (approvedLinks.length) {
    if (disposition !== 'RESOLVED_BY_APPROVED_LINK' || approvedLinks.length !== 1
      || selectedLink !== approvedLinks[0].candidateId) {
      throw new TypeError('An approved task link must be the exact source disposition resolution');
    }
  } else if (disposition === 'RESOLVED_BY_APPROVED_LINK' || selectedLink !== null) {
    throw new TypeError('A task disposition cannot cite an unapproved task link');
  }
  return { disposition, rationale: text(item.rationale), reference: text(item.reference), taskLinkCandidateId: selectedLink };
}

function applyDecisions(candidates, decisions, linkCandidates) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const chosen = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const candidate = known.get(id);
    if (!candidate) throw new TypeError(`Unknown task disposition candidate: ${id}`);
    if (chosen.has(id)) throw new TypeError(`Duplicate task disposition decision: ${id}`);
    chosen.set(id, validateChosenDisposition(candidate, item, linkCandidates));
  }
  return candidates.map(candidate => ({
    ...candidate,
    ...(chosen.get(candidate.candidateId) ?? {
      disposition: 'PENDING', rationale: null, reference: null, taskLinkCandidateId: null,
    }),
  }));
}

function identity(candidate) {
  const { disposition: _disposition, rationale: _rationale, reference: _reference,
    taskLinkCandidateId: _taskLinkCandidateId, ...rest } = candidate;
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

export function prepareNotionBonsaiTaskDispositionDecision({
  review, reviewSha256, taskLinkDecision, taskLinkDecisionSha256,
  mappingDecision = null, mappingDecisionSha256 = null,
  preparedAt, decisions = [], approver = null, decidedAt = null, reference = null,
}) {
  const reviewTime = timestamp(review?.preparedAt, 'review preparedAt');
  const linkTime = timestamp(taskLinkDecision?.preparedAt, 'task-link preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewTime || prepared < linkTime) throw new TypeError('preparedAt must not predate source decisions');
  const reviewHash = sha256(reviewSha256, 'reviewSha256');
  const link = verifyLinkDependency({
    review, reviewSha256: reviewHash, taskLinkDecision, taskLinkDecisionSha256,
    mappingDecision, mappingDecisionSha256,
  });
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
    format: FORMAT, version: VERSION, scope: SCOPE, complete: totals.pending === 0,
    preparedAt: new Date(prepared).toISOString(), decisionEvidence: evidence, candidates, summary: totals,
    safeguards: {
      externalWritesPerformed: false, sourceRecordsDeleted: false, tasksCreatedOrChanged: false,
      taskLinksApplied: false, dispositionsApplied: false, sourceRepairApplied: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: reviewHash, taskLinkDecisionSha256: link.hash,
      mappingDecisionSha256: link.mappingHash, reviewPreparedAt: new Date(reviewTime).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
    },
  };
}

export function verifyNotionBonsaiTaskDispositionDecision(options) {
  const findings = [];
  let expected = [];
  let linkCandidates = [];
  let reviewHash;
  let linkHash;
  let mappingHash;
  try {
    reviewHash = sha256(options.reviewSha256, 'reviewSha256');
    const link = verifyLinkDependency({
      review: options.review, reviewSha256: reviewHash,
      taskLinkDecision: options.taskLinkDecision, taskLinkDecisionSha256: options.taskLinkDecisionSha256,
      mappingDecision: options.mappingDecision, mappingDecisionSha256: options.mappingDecisionSha256,
    });
    linkHash = link.hash;
    mappingHash = link.mappingHash;
    linkCandidates = link.candidates;
    expected = reviewCandidates(options.review, linkCandidates);
  } catch { findings.push('INVALID_SOURCE_EVIDENCE'); }
  const { record } = options;
  if (record?.format !== FORMAT || record?.version !== VERSION || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== reviewHash
    || record?.sourceEvidence?.taskLinkDecisionSha256 !== linkHash
    || record?.sourceEvidence?.mappingDecisionSha256 !== mappingHash
    || record?.sourceEvidence?.reviewPreparedAt !== options.review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== options.review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== options.review?.sourceEvidence?.bonsaiSnapshotSha256) findings.push('SOURCE_EVIDENCE_MISMATCH');
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) findings.push('CANDIDATE_SET_MISMATCH');
  if (candidates.some(candidate => {
    if (!ALLOWED[candidate?.sourceKind]?.has(candidate?.disposition)
      || (candidate.disposition === 'PENDING' && (candidate.rationale !== null || candidate.reference !== null || candidate.taskLinkCandidateId !== null))
      || (candidate.disposition !== 'PENDING' && (!text(candidate.rationale) || !text(candidate.reference)))) return true;
    if (candidate.disposition === 'PENDING') return false;
    try { validateChosenDisposition(candidate, candidate, linkCandidates); return false; } catch { return true; }
  })) findings.push('INVALID_DISPOSITION');
  const totals = summary(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const reviewTime = Date.parse(String(options.review?.preparedAt ?? ''));
  const linkTime = Date.parse(String(options.taskLinkDecision?.preparedAt ?? ''));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (![reviewTime, linkTime, prepared].every(Number.isFinite) || prepared < reviewTime || prepared < linkTime) findings.push('INVALID_PREPARATION_TIME');
  if (totals.decided > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < reviewTime || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'sourceRecordsDeleted', 'tasksCreatedOrChanged', 'taskLinksApplied',
    'dispositionsApplied', 'sourceRepairApplied', 'migrationOrCutoverAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)) findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0, ...totals, findings: [...new Set(findings)] };
}

export { FORMAT as NOTION_BONSAI_TASK_DISPOSITION_DECISION_FORMAT };
