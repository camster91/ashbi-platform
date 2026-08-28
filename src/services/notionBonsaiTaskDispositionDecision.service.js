const FORMAT = 'ashbi-notion-bonsai-task-disposition-decision';
const SCOPE = 'SOURCE_ONLY_AND_MALFORMED_TASK_DISPOSITIONS';

const ALLOWED = {
  NOTION_ONLY: new Set(['PENDING', 'MIGRATE_TO_HUB', 'RETAIN_NOTION_ONLY', 'EXCLUDE_WITH_EVIDENCE']),
  BONSAI_ONLY: new Set(['PENDING', 'MIGRATE_TO_HUB', 'RETAIN_BONSAI_ONLY', 'EXCLUDE_WITH_EVIDENCE']),
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
function candidateId(kind, id) {
  return `task-disposition:${kind.toLowerCase()}:${id.split('/').pop()}`;
}

function reviewCandidates(review) {
  if (review?.format !== 'ashbi-notion-bonsai-task-review' || review?.version !== 1
    || !Array.isArray(review?.notionOnly) || !Array.isArray(review?.bonsaiOnly)
    || !Array.isArray(review?.bonsaiSourceReview)) throw new TypeError('A valid Notion/Bonsai task review is required');
  const candidates = [
    ...review.notionOnly.map(item => {
      const id = sourceId(item.notionSourceId, 'notionSourceId');
      return {
        candidateId: candidateId('NOTION_ONLY', id), sourceKind: 'NOTION_ONLY', notionSourceId: id,
        bonsaiSourceId: null, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.status), owner: null, sourceReviewFields: [],
      };
    }),
    ...review.bonsaiOnly.map(item => {
      const id = sourceId(item.bonsaiSourceId, 'bonsaiSourceId');
      return {
        candidateId: candidateId('BONSAI_ONLY', id), sourceKind: 'BONSAI_ONLY', notionSourceId: null,
        bonsaiSourceId: id, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.lifecycleState), owner: text(item.owner), sourceReviewFields: [],
      };
    }),
    ...review.bonsaiSourceReview.map(item => {
      const id = sourceId(item.bonsaiSourceId, 'bonsaiSourceId');
      return {
        candidateId: candidateId('BONSAI_SOURCE_REVIEW', id), sourceKind: 'BONSAI_SOURCE_REVIEW', notionSourceId: null,
        bonsaiSourceId: id, title: text(item.title), project: text(item.project),
        lifecycleState: text(item.lifecycleState), owner: text(item.owner),
        sourceReviewFields: Array.isArray(item.fields) ? item.fields.map(text).filter(Boolean).sort() : [],
      };
    }),
  ].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (!candidates.length || new Set(candidates.map(item => item.candidateId)).size !== candidates.length) {
    throw new TypeError('Task disposition candidates require unique source identities');
  }
  return candidates;
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const chosen = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const candidate = known.get(id);
    const disposition = text(item?.disposition);
    if (!candidate) throw new TypeError(`Unknown task disposition candidate: ${id}`);
    if (chosen.has(id)) throw new TypeError(`Duplicate task disposition decision: ${id}`);
    if (!ALLOWED[candidate.sourceKind].has(disposition) || disposition === 'PENDING') {
      throw new TypeError(`Disposition is not allowed for ${candidate.sourceKind}`);
    }
    if (!text(item?.rationale) || !text(item?.reference)) {
      throw new TypeError('Every recorded disposition requires a rationale and evidence reference');
    }
    chosen.set(id, { disposition, rationale: text(item.rationale), reference: text(item.reference) });
  }
  return candidates.map(candidate => ({
    ...candidate,
    ...(chosen.get(candidate.candidateId) ?? { disposition: 'PENDING', rationale: null, reference: null }),
  }));
}

function identity(candidate) {
  const { disposition: _disposition, rationale: _rationale, reference: _reference, ...rest } = candidate;
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
  review, reviewSha256, preparedAt, decisions = [], approver = null, decidedAt = null, reference = null,
}) {
  const reviewTime = timestamp(review?.preparedAt, 'review preparedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < reviewTime) throw new TypeError('preparedAt must not predate the task review');
  const candidates = applyDecisions(reviewCandidates(review), decisions);
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
    format: FORMAT,
    version: 1,
    scope: SCOPE,
    complete: totals.pending === 0,
    preparedAt: new Date(prepared).toISOString(),
    decisionEvidence: evidence,
    candidates,
    summary: totals,
    safeguards: {
      externalWritesPerformed: false,
      sourceRecordsDeleted: false,
      tasksCreatedOrChanged: false,
      dispositionsApplied: false,
      sourceRepairApplied: false,
      migrationOrCutoverAuthorized: false,
    },
    sourceEvidence: {
      reviewSha256: sha256(reviewSha256, 'reviewSha256'),
      reviewPreparedAt: new Date(reviewTime).toISOString(),
      notionSnapshotSha256: sha256(review?.sourceEvidence?.notionSnapshotSha256, 'notionSnapshotSha256'),
      bonsaiSnapshotSha256: sha256(review?.sourceEvidence?.bonsaiSnapshotSha256, 'bonsaiSnapshotSha256'),
    },
  };
}

export function verifyNotionBonsaiTaskDispositionDecision({ review, reviewSha256, record }) {
  const findings = [];
  let expected = [];
  let reviewHash;
  try { expected = reviewCandidates(review); reviewHash = sha256(reviewSha256, 'reviewSha256'); } catch { findings.push('INVALID_TASK_REVIEW'); }
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.reviewSha256 !== reviewHash
    || record?.sourceEvidence?.reviewPreparedAt !== review?.preparedAt
    || record?.sourceEvidence?.notionSnapshotSha256 !== review?.sourceEvidence?.notionSnapshotSha256
    || record?.sourceEvidence?.bonsaiSnapshotSha256 !== review?.sourceEvidence?.bonsaiSnapshotSha256) findings.push('SOURCE_EVIDENCE_MISMATCH');
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) findings.push('CANDIDATE_SET_MISMATCH');
  if (candidates.some(candidate => !ALLOWED[candidate?.sourceKind]?.has(candidate?.disposition)
    || (candidate.disposition === 'PENDING' && (candidate.rationale !== null || candidate.reference !== null))
    || (candidate.disposition !== 'PENDING' && (!text(candidate.rationale) || !text(candidate.reference))))) findings.push('INVALID_DISPOSITION');
  const totals = summary(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const reviewTime = Date.parse(String(review?.preparedAt ?? ''));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (!Number.isFinite(reviewTime) || !Number.isFinite(prepared) || prepared < reviewTime) findings.push('INVALID_PREPARATION_TIME');
  if (totals.decided > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < reviewTime || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'sourceRecordsDeleted', 'tasksCreatedOrChanged', 'dispositionsApplied',
    'sourceRepairApplied', 'migrationOrCutoverAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)) findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0, ...totals, findings };
}

export { FORMAT as NOTION_BONSAI_TASK_DISPOSITION_DECISION_FORMAT };
