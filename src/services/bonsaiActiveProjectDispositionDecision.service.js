import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiProjectDispositionDecision } from './notionBonsaiProjectDispositionDecision.service.js';

const FORMAT = 'ashbi-bonsai-active-project-disposition-decision';
const SCOPE = 'ACTIVE_PROJECT_OPERATING_AND_MIGRATION_OUTCOME';
const ALLOWED = new Set([
  'PENDING', 'MIGRATE_ACTIVE_TO_HUB', 'RETAIN_ACTIVE_IN_BONSAI',
  'EXCLUDE_ACTIVE_WITH_EVIDENCE', 'CLOSE_AFTER_FINANCIAL_CLEARANCE',
]);

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

function verifyDependencies(options) {
  const triageHash = sha256(options.triageSha256, 'triageSha256');
  const financialHash = sha256(options.financialReviewSha256, 'financialReviewSha256');
  const reviewHash = sha256(options.nativeProjectReviewSha256, 'nativeProjectReviewSha256');
  const linkHash = sha256(options.projectLinkDecisionSha256, 'projectLinkDecisionSha256');
  const dispositionHash = sha256(options.projectDispositionDecisionSha256, 'projectDispositionDecisionSha256');
  const linkResult = verifyNotionBonsaiNativeProjectLinkDecision({
    review: options.nativeProjectReview, reviewSha256: reviewHash, record: options.projectLinkDecision,
  });
  const dispositionResult = verifyNotionBonsaiProjectDispositionDecision({
    review: options.nativeProjectReview, reviewSha256: reviewHash,
    projectLinkDecision: options.projectLinkDecision, projectLinkDecisionSha256: linkHash,
    record: options.projectDispositionDecision,
  });
  if (!linkResult.valid || !dispositionResult.valid) throw new TypeError('Valid project identity and disposition dependencies are required');
  if (text(options.triage?.sourceEvidence?.nativeProjectReviewSha256).toLowerCase() !== reviewHash
    || text(options.financialReview?.sourceEvidence?.activeProjectTriageSha256).toLowerCase() !== triageHash) {
    throw new TypeError('Active project evidence is bound to another source generation');
  }
  return { triageHash, financialHash, reviewHash, linkHash, dispositionHash };
}

function candidatesFromEvidence(options) {
  if (options.triage?.format !== 'ashbi-bonsai-active-project-triage' || options.triage?.version !== 1
    || options.financialReview?.format !== 'ashbi-bonsai-active-project-financial-review' || options.financialReview?.version !== 1
    || !Array.isArray(options.triage?.records) || !Array.isArray(options.financialReview?.records)) {
    throw new TypeError('Valid active-project triage and financial review are required');
  }
  const financialById = new Map(options.financialReview.records.map(record => [String(record.bonsaiProjectId), record]));
  const linkCandidates = options.projectLinkDecision.candidates;
  const dispositionCandidates = options.projectDispositionDecision.candidates;
  const candidates = options.triage.records.map(record => {
    const id = sourceId(record.bonsaiProjectId, 'bonsaiProjectId');
    const financial = financialById.get(id);
    const sourceDisposition = dispositionCandidates.find(candidate => candidate.sourceKind === 'BONSAI_PROJECT'
      && String(candidate.bonsaiProjectId) === id);
    if (!financial || !sourceDisposition) throw new TypeError(`Missing dependency evidence for active project ${id}`);
    return {
      candidateId: `active-project-disposition:${id}`,
      bonsaiProjectId: id,
      project: text(record.project),
      company: text(record.company),
      url: text(record.url),
      projectGroup: {
        id: text(record.projectGroup?.id), name: text(record.projectGroup?.name), state: text(record.projectGroup?.state),
      },
      triageBucket: text(record.triageBucket),
      duplicateTitleGroup: record.duplicateTitleGroup === true,
      taskCount: Number(record.taskEvidence?.total ?? 0),
      taskSourceIds: Array.isArray(record.taskEvidence?.taskSourceIds) ? [...record.taskEvidence.taskSourceIds].map(text).sort() : [],
      notionSourceId: text(record.notionEvidence?.notionSourceId) || null,
      projectLinkCandidateIds: linkCandidates.filter(candidate => String(candidate.bonsaiProjectId) === id)
        .map(candidate => candidate.candidateId).sort(),
      projectDispositionCandidateId: sourceDisposition.candidateId,
      financialEvidence: {
        invoiceCount: Number(financial.invoiceEvidence?.invoiceCount ?? 0),
        nonPaidInvoiceCount: Number(financial.invoiceEvidence?.nonPaidInvoiceCount ?? 0),
        timeEntryCount: Number(financial.timeEvidence?.entryCount ?? 0),
        unbilledEntryCount: Number(financial.timeEvidence?.unbilledEntryCount ?? 0),
        paymentEvidenceChecked: financial.paymentEvidence?.checked === true,
        contractEvidenceChecked: financial.contractEvidence?.checked === true,
        closureAuthorized: financial.closureAuthorized === true,
        attentionReasons: Array.isArray(financial.financialAttentionReasons)
          ? [...financial.financialAttentionReasons].map(text).filter(Boolean).sort() : [],
      },
    };
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (candidates.length !== Number(options.triage?.summary?.activeProjects)
    || candidates.length !== Number(options.financialReview?.summary?.activeProjects)
    || new Set(candidates.map(candidate => candidate.bonsaiProjectId)).size !== candidates.length
    || financialById.size !== candidates.length) {
    throw new TypeError('Active project evidence does not have one complete identity partition');
  }
  return candidates;
}

function validateOutcome(candidate, chosen, options) {
  const outcome = text(chosen?.outcome);
  if (!ALLOWED.has(outcome) || outcome === 'PENDING') throw new TypeError('Recorded active-project outcomes must be explicit');
  if (!text(chosen?.rationale) || !text(chosen?.reference)) {
    throw new TypeError('Every active-project outcome requires a rationale and evidence reference');
  }
  const links = options.projectLinkDecision.candidates.filter(link => candidate.projectLinkCandidateIds.includes(link.candidateId));
  const sourceDisposition = options.projectDispositionDecision.candidates
    .find(item => item.candidateId === candidate.projectDispositionCandidateId);
  if (links.some(link => link.decision === 'PENDING') || sourceDisposition?.disposition === 'PENDING') {
    throw new TypeError('Active-project outcome must wait for project identity and source disposition decisions');
  }
  const compatible = {
    MIGRATE_ACTIVE_TO_HUB: new Set(['MIGRATE_TO_HUB', 'RESOLVED_BY_APPROVED_LINK']),
    RETAIN_ACTIVE_IN_BONSAI: new Set(['RETAIN_BONSAI_SOURCE']),
    EXCLUDE_ACTIVE_WITH_EVIDENCE: new Set(['EXCLUDE_WITH_EVIDENCE']),
  };
  if (compatible[outcome] && !compatible[outcome].has(sourceDisposition?.disposition)) {
    throw new TypeError('Active-project outcome conflicts with the source project disposition');
  }
  if (outcome === 'CLOSE_AFTER_FINANCIAL_CLEARANCE' && candidate.financialEvidence.closureAuthorized !== true) {
    throw new TypeError('Project closure requires complete financial clearance evidence');
  }
  return { outcome, rationale: text(chosen.rationale), reference: text(chosen.reference) };
}

function applyDecisions(candidates, decisions, options) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const chosen = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const candidate = known.get(id);
    if (!candidate) throw new TypeError(`Unknown active-project candidate: ${id}`);
    if (chosen.has(id)) throw new TypeError(`Duplicate active-project decision: ${id}`);
    chosen.set(id, validateOutcome(candidate, item, options));
  }
  return candidates.map(candidate => ({
    ...candidate, ...(chosen.get(candidate.candidateId) ?? { outcome: 'PENDING', rationale: null, reference: null }),
  }));
}

function identity(candidate) {
  const { outcome: _outcome, rationale: _rationale, reference: _reference, ...rest } = candidate;
  return JSON.stringify(rest);
}

function summary(candidates) {
  const outcomes = [...new Set(candidates.map(candidate => candidate.outcome))].sort();
  return {
    total: candidates.length,
    pending: candidates.filter(candidate => candidate.outcome === 'PENDING').length,
    decided: candidates.filter(candidate => candidate.outcome !== 'PENDING').length,
    closureAuthorized: candidates.filter(candidate => candidate.financialEvidence.closureAuthorized).length,
    byOutcome: Object.fromEntries(outcomes.map(outcome => [outcome, candidates.filter(candidate => candidate.outcome === outcome).length])),
  };
}

export function prepareBonsaiActiveProjectDispositionDecision(options) {
  const triageTime = timestamp(options.triage?.preparedAt, 'triage preparedAt');
  const financialTime = timestamp(options.financialReview?.preparedAt, 'financial review preparedAt');
  const prepared = timestamp(options.preparedAt, 'preparedAt');
  if (prepared < Math.max(triageTime, financialTime, timestamp(options.projectDispositionDecision?.preparedAt, 'project disposition preparedAt'))) {
    throw new TypeError('preparedAt must not predate source evidence');
  }
  const hashes = verifyDependencies(options);
  const candidates = applyDecisions(candidatesFromEvidence(options), options.decisions ?? [], options);
  const totals = summary(candidates);
  let evidence = null;
  if (totals.decided > 0) {
    if (!text(options.approver) || !text(options.reference)) throw new TypeError('Recorded outcomes require an approver and batch reference');
    const decided = timestamp(options.decidedAt, 'decidedAt');
    if (decided < Math.max(triageTime, financialTime) || decided > prepared) throw new TypeError('decidedAt is outside the evidence window');
    evidence = { approver: text(options.approver), decidedAt: new Date(decided).toISOString(), reference: text(options.reference) };
  } else if ((options.approver !== null && options.approver !== undefined)
    || (options.decidedAt !== null && options.decidedAt !== undefined)
    || (options.reference !== null && options.reference !== undefined)) {
    throw new TypeError('A fully pending packet cannot contain decision evidence');
  }
  return {
    format: FORMAT, version: 1, scope: SCOPE, complete: totals.pending === 0,
    preparedAt: new Date(prepared).toISOString(), decisionEvidence: evidence, candidates, summary: totals,
    safeguards: {
      externalWritesPerformed: false, projectsCreatedOrChanged: false, projectsClosedOrArchived: false,
      tasksOwnersLifecycleOrFinancialsChanged: false, outcomesApplied: false,
      migrationOrCutoverAuthorized: false, bonsaiRetirementAuthorized: false,
    },
    sourceEvidence: {
      activeProjectTriageSha256: hashes.triageHash,
      financialReviewSha256: hashes.financialHash,
      nativeProjectReviewSha256: hashes.reviewHash,
      projectLinkDecisionSha256: hashes.linkHash,
      projectDispositionDecisionSha256: hashes.dispositionHash,
      bonsaiProjectSnapshotSha256: sha256(options.triage?.sourceEvidence?.bonsaiProjectSnapshotSha256, 'bonsaiProjectSnapshotSha256'),
      bonsaiTaskSnapshotSha256: sha256(options.triage?.sourceEvidence?.bonsaiTaskSnapshotSha256, 'bonsaiTaskSnapshotSha256'),
      invoiceSnapshotSha256: sha256(options.financialReview?.sourceEvidence?.invoiceSnapshotSha256, 'invoiceSnapshotSha256'),
      timeEntrySnapshotSha256: sha256(options.financialReview?.sourceEvidence?.timeEntrySnapshotSha256, 'timeEntrySnapshotSha256'),
    },
  };
}

export function verifyBonsaiActiveProjectDispositionDecision(options) {
  const findings = [];
  let expected = [];
  try { verifyDependencies(options); expected = candidatesFromEvidence(options); } catch { findings.push('INVALID_SOURCE_EVIDENCE'); }
  const { record } = options;
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  const sourceChecks = {
    activeProjectTriageSha256: options.triageSha256,
    financialReviewSha256: options.financialReviewSha256,
    nativeProjectReviewSha256: options.nativeProjectReviewSha256,
    projectLinkDecisionSha256: options.projectLinkDecisionSha256,
    projectDispositionDecisionSha256: options.projectDispositionDecisionSha256,
    bonsaiProjectSnapshotSha256: options.triage?.sourceEvidence?.bonsaiProjectSnapshotSha256,
    bonsaiTaskSnapshotSha256: options.triage?.sourceEvidence?.bonsaiTaskSnapshotSha256,
    invoiceSnapshotSha256: options.financialReview?.sourceEvidence?.invoiceSnapshotSha256,
    timeEntrySnapshotSha256: options.financialReview?.sourceEvidence?.timeEntrySnapshotSha256,
  };
  if (Object.entries(sourceChecks).some(([key, value]) => record?.sourceEvidence?.[key] !== String(value ?? '').toLowerCase())) {
    findings.push('SOURCE_EVIDENCE_MISMATCH');
  }
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) {
    findings.push('CANDIDATE_SET_MISMATCH');
  }
  for (const candidate of candidates) {
    if (candidate.outcome === 'PENDING') {
      if (candidate.rationale !== null || candidate.reference !== null) findings.push('INVALID_OUTCOME');
    } else {
      try { validateOutcome(candidate, candidate, options); } catch { findings.push('INVALID_OUTCOME'); }
    }
  }
  const totals = summary(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const sourceTimes = [options.triage, options.financialReview, options.projectDispositionDecision]
    .map(source => Date.parse(String(source?.preparedAt ?? '')));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (![...sourceTimes, prepared].every(Number.isFinite) || sourceTimes.some(time => prepared < time)) findings.push('INVALID_PREPARATION_TIME');
  if (totals.decided > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < Math.max(...sourceTimes) || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'projectsCreatedOrChanged', 'projectsClosedOrArchived',
    'tasksOwnersLifecycleOrFinancialsChanged', 'outcomesApplied', 'migrationOrCutoverAuthorized', 'bonsaiRetirementAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)) findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0, ...totals, findings: [...new Set(findings)] };
}

export { FORMAT as BONSAI_ACTIVE_PROJECT_DISPOSITION_DECISION_FORMAT };
