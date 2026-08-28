import { verifyBonsaiFinancialIndexSnapshots } from './bonsaiFinancialIndexSnapshot.service.js';

const FORMAT = 'ashbi-bonsai-financial-exception-decision';
const SCOPE = 'NON_PAID_INVOICES_UNBILLED_TIME_AND_CONTRACT_GAPS';
const ALLOWED = {
  NON_PAID_INVOICE: new Set(['PENDING', 'MIGRATE_WITH_SOURCE_STATUS', 'RESOLVE_IN_BONSAI_AND_RECAPTURE', 'RETAIN_IN_BONSAI_DURING_PARALLEL_RUN', 'EXCLUDE_WITH_EVIDENCE']),
  UNBILLED_TIME_ENTRY: new Set(['PENDING', 'MIGRATE_AS_UNBILLED', 'MIGRATE_UNLINKED_WITH_EVIDENCE', 'ASSIGN_PROJECT_AND_RECAPTURE', 'BILL_AND_RECAPTURE', 'MARK_NON_BILLABLE_AND_RECAPTURE', 'EXCLUDE_WITH_EVIDENCE']),
  ACTIVE_PROJECT_CONTRACT_GAP: new Set(['PENDING', 'CAPTURE_CONTRACT_AND_RECAPTURE', 'ATTEST_NO_CONTRACT_WITH_EVIDENCE', 'RETAIN_CONTRACT_IN_BONSAI_DURING_PARALLEL_RUN']),
};
const ACTION_REQUIRED = new Set([
  'RESOLVE_IN_BONSAI_AND_RECAPTURE', 'RETAIN_IN_BONSAI_DURING_PARALLEL_RUN',
  'ASSIGN_PROJECT_AND_RECAPTURE', 'BILL_AND_RECAPTURE', 'MARK_NON_BILLABLE_AND_RECAPTURE',
  'CAPTURE_CONTRACT_AND_RECAPTURE', 'RETAIN_CONTRACT_IN_BONSAI_DURING_PARALLEL_RUN',
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

function candidatesFromEvidence(financialReview, invoiceSnapshot, timeEntrySnapshot) {
  if (financialReview?.format !== 'ashbi-bonsai-active-project-financial-review' || financialReview?.version !== 1
    || !Array.isArray(financialReview?.records)) throw new TypeError('A valid active-project financial review is required');
  const verification = verifyBonsaiFinancialIndexSnapshots(invoiceSnapshot, timeEntrySnapshot);
  if (!verification.valid) throw new TypeError('Valid complete invoice and time-entry indexes are required');
  const candidates = [
    ...invoiceSnapshot.invoices.filter(invoice => invoice.status !== 'paid').map(invoice => ({
      candidateId: `financial-exception:invoice:${sourceId(invoice.id, 'invoice id')}`,
      exceptionKind: 'NON_PAID_INVOICE', sourceId: String(invoice.id), projectId: invoice.project_id === null ? null : String(invoice.project_id),
      taskSourceId: null, project: null, company: text(invoice.client_name), invoiceNumber: text(invoice.invoice_number) || null,
      status: text(invoice.status), currency: text(invoice.currency), amount: text(invoice.total_amount),
      date: invoice.issued_date, dueDate: invoice.due_date, seconds: null, linkageState: invoice.project_id === null ? 'PROJECTLESS' : 'PROJECT_LINKED',
    })),
    ...timeEntrySnapshot.time_entries.filter(entry => entry.billing_status === 'unbilled').map(entry => ({
      candidateId: `financial-exception:time:${sourceId(entry.key, 'time entry key')}`,
      exceptionKind: 'UNBILLED_TIME_ENTRY', sourceId: text(entry.key), projectId: entry.project_id === null ? null : String(entry.project_id),
      taskSourceId: text(entry.task_uuid) || null, project: null, company: null, invoiceNumber: null,
      status: text(entry.billing_status), currency: text(entry.currency), amount: text(entry.billable_amount),
      date: entry.date, dueDate: null, seconds: entry.seconds, linkageState: entry.project_id === null ? 'PROJECTLESS' : 'PROJECT_LINKED',
    })),
    ...financialReview.records.filter(record => record.contractEvidence?.checked !== true).map(record => ({
      candidateId: `financial-exception:contract:${sourceId(record.bonsaiProjectId, 'Bonsai project id')}`,
      exceptionKind: 'ACTIVE_PROJECT_CONTRACT_GAP', sourceId: String(record.bonsaiProjectId), projectId: String(record.bonsaiProjectId),
      taskSourceId: null, project: text(record.project), company: text(record.company), invoiceNumber: null,
      status: text(record.contractEvidence?.reason), currency: null, amount: null, date: null, dueDate: null, seconds: null,
      linkageState: 'PROJECT_LINKED',
    })),
  ].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (!candidates.length || new Set(candidates.map(candidate => candidate.candidateId)).size !== candidates.length) {
    throw new TypeError('Financial exception candidates require unique source identities');
  }
  return candidates;
}

function validateDisposition(candidate, item) {
  const disposition = text(item?.disposition);
  if (!ALLOWED[candidate.exceptionKind]?.has(disposition) || disposition === 'PENDING') {
    throw new TypeError(`Disposition is not allowed for ${candidate.exceptionKind}`);
  }
  if (!text(item?.rationale) || !text(item?.reference)) {
    throw new TypeError('Every financial exception disposition requires a rationale and evidence reference');
  }
  if (disposition === 'MIGRATE_UNLINKED_WITH_EVIDENCE' && candidate.linkageState !== 'PROJECTLESS') {
    throw new TypeError('Only a projectless time entry can migrate as unlinked');
  }
  if (candidate.exceptionKind === 'UNBILLED_TIME_ENTRY' && candidate.linkageState === 'PROJECTLESS'
    && disposition === 'MIGRATE_AS_UNBILLED') {
    throw new TypeError('A projectless time entry requires an explicit linkage disposition');
  }
  return {
    disposition, rationale: text(item.rationale), reference: text(item.reference),
    actionRequired: ACTION_REQUIRED.has(disposition),
  };
}

function applyDecisions(candidates, decisions) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const known = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const chosen = new Map();
  for (const item of decisions) {
    const id = text(item?.candidateId);
    const candidate = known.get(id);
    if (!candidate) throw new TypeError(`Unknown financial exception candidate: ${id}`);
    if (chosen.has(id)) throw new TypeError(`Duplicate financial exception decision: ${id}`);
    chosen.set(id, validateDisposition(candidate, item));
  }
  return candidates.map(candidate => ({
    ...candidate, ...(chosen.get(candidate.candidateId) ?? {
      disposition: 'PENDING', rationale: null, reference: null, actionRequired: false,
    }),
  }));
}

function identity(candidate) {
  const { disposition: _disposition, rationale: _rationale, reference: _reference, actionRequired: _actionRequired, ...rest } = candidate;
  return JSON.stringify(rest);
}

function summary(candidates) {
  const dispositions = [...new Set(candidates.map(candidate => candidate.disposition))].sort();
  return {
    total: candidates.length,
    pending: candidates.filter(candidate => candidate.disposition === 'PENDING').length,
    decided: candidates.filter(candidate => candidate.disposition !== 'PENDING').length,
    actionRequired: candidates.filter(candidate => candidate.actionRequired).length,
    projectlessTimeEntries: candidates.filter(candidate => candidate.exceptionKind === 'UNBILLED_TIME_ENTRY' && candidate.linkageState === 'PROJECTLESS').length,
    byExceptionKind: Object.fromEntries(Object.keys(ALLOWED).map(kind => [kind, candidates.filter(candidate => candidate.exceptionKind === kind).length])),
    byDisposition: Object.fromEntries(dispositions.map(disposition => [disposition, candidates.filter(candidate => candidate.disposition === disposition).length])),
  };
}

export function prepareBonsaiFinancialExceptionDecision({
  financialReview, invoiceSnapshot, timeEntrySnapshot,
  financialReviewSha256, invoiceSnapshotSha256, timeEntrySnapshotSha256,
  preparedAt, decisions = [], approver = null, decidedAt = null, reference = null,
}) {
  const reviewTime = timestamp(financialReview?.preparedAt, 'financial review preparedAt');
  const invoiceTime = timestamp(invoiceSnapshot?.capturedAt, 'invoice capturedAt');
  const timeEntryTime = timestamp(timeEntrySnapshot?.capturedAt, 'time-entry capturedAt');
  const prepared = timestamp(preparedAt, 'preparedAt');
  if (prepared < Math.max(reviewTime, invoiceTime, timeEntryTime)) throw new TypeError('preparedAt must not predate source evidence');
  const hashes = {
    financialReviewSha256: sha256(financialReviewSha256, 'financialReviewSha256'),
    invoiceSnapshotSha256: sha256(invoiceSnapshotSha256, 'invoiceSnapshotSha256'),
    timeEntrySnapshotSha256: sha256(timeEntrySnapshotSha256, 'timeEntrySnapshotSha256'),
  };
  if (text(financialReview?.sourceEvidence?.invoiceSnapshotSha256).toLowerCase() !== hashes.invoiceSnapshotSha256
    || text(financialReview?.sourceEvidence?.timeEntrySnapshotSha256).toLowerCase() !== hashes.timeEntrySnapshotSha256) {
    throw new TypeError('Financial review is bound to another index generation');
  }
  const candidates = applyDecisions(candidatesFromEvidence(financialReview, invoiceSnapshot, timeEntrySnapshot), decisions);
  const totals = summary(candidates);
  let evidence = null;
  if (totals.decided > 0) {
    if (!text(approver) || !text(reference)) throw new TypeError('Recorded dispositions require an approver and batch reference');
    const decided = timestamp(decidedAt, 'decidedAt');
    if (decided < Math.max(reviewTime, invoiceTime, timeEntryTime) || decided > prepared) throw new TypeError('decidedAt is outside the evidence window');
    evidence = { approver: text(approver), decidedAt: new Date(decided).toISOString(), reference: text(reference) };
  } else if (approver !== null || decidedAt !== null || reference !== null) {
    throw new TypeError('A fully pending packet cannot contain decision evidence');
  }
  return {
    format: FORMAT, version: 1, scope: SCOPE,
    complete: totals.pending === 0 && totals.actionRequired === 0,
    preparedAt: new Date(prepared).toISOString(), decisionEvidence: evidence, candidates, summary: totals,
    safeguards: {
      externalWritesPerformed: false, invoicesChanged: false, paymentsChanged: false, timeEntriesChanged: false,
      contractsChanged: false, dispositionsApplied: false, billingOrCollectionAuthorized: false,
      migrationOrCutoverAuthorized: false, bonsaiRetirementAuthorized: false,
    },
    sourceEvidence: {
      ...hashes, financialReviewPreparedAt: new Date(reviewTime).toISOString(),
      invoiceCapturedAt: new Date(invoiceTime).toISOString(), timeEntryCapturedAt: new Date(timeEntryTime).toISOString(),
    },
  };
}

export function verifyBonsaiFinancialExceptionDecision(options) {
  const findings = [];
  let expected = [];
  let hashes = {};
  try {
    hashes = {
      financialReviewSha256: sha256(options.financialReviewSha256, 'financialReviewSha256'),
      invoiceSnapshotSha256: sha256(options.invoiceSnapshotSha256, 'invoiceSnapshotSha256'),
      timeEntrySnapshotSha256: sha256(options.timeEntrySnapshotSha256, 'timeEntrySnapshotSha256'),
    };
    if (text(options.financialReview?.sourceEvidence?.invoiceSnapshotSha256).toLowerCase() !== hashes.invoiceSnapshotSha256
      || text(options.financialReview?.sourceEvidence?.timeEntrySnapshotSha256).toLowerCase() !== hashes.timeEntrySnapshotSha256) throw new TypeError('generation mismatch');
    expected = candidatesFromEvidence(options.financialReview, options.invoiceSnapshot, options.timeEntrySnapshot);
  } catch { findings.push('INVALID_SOURCE_EVIDENCE'); }
  const { record } = options;
  if (record?.format !== FORMAT || record?.version !== 1 || record?.scope !== SCOPE) findings.push('INVALID_DECISION_SCHEMA');
  if (record?.sourceEvidence?.financialReviewSha256 !== hashes.financialReviewSha256
    || record?.sourceEvidence?.invoiceSnapshotSha256 !== hashes.invoiceSnapshotSha256
    || record?.sourceEvidence?.timeEntrySnapshotSha256 !== hashes.timeEntrySnapshotSha256
    || record?.sourceEvidence?.financialReviewPreparedAt !== options.financialReview?.preparedAt
    || record?.sourceEvidence?.invoiceCapturedAt !== options.invoiceSnapshot?.capturedAt
    || record?.sourceEvidence?.timeEntryCapturedAt !== options.timeEntrySnapshot?.capturedAt) findings.push('SOURCE_EVIDENCE_MISMATCH');
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  if (candidates.length !== expected.length || candidates.some((candidate, index) => identity(candidate) !== JSON.stringify(expected[index]))) findings.push('CANDIDATE_SET_MISMATCH');
  for (const candidate of candidates) {
    if (candidate.disposition === 'PENDING') {
      if (candidate.rationale !== null || candidate.reference !== null || candidate.actionRequired !== false) findings.push('INVALID_DISPOSITION');
    } else {
      try {
        const result = validateDisposition(candidate, candidate);
        if (candidate.actionRequired !== result.actionRequired) findings.push('INVALID_DISPOSITION');
      } catch { findings.push('INVALID_DISPOSITION'); }
    }
  }
  const totals = summary(candidates);
  if (record?.complete !== (candidates.length > 0 && totals.pending === 0 && totals.actionRequired === 0)
    || JSON.stringify(record?.summary) !== JSON.stringify(totals)) findings.push('SUMMARY_MISMATCH');
  const sourceTimes = [options.financialReview?.preparedAt, options.invoiceSnapshot?.capturedAt, options.timeEntrySnapshot?.capturedAt].map(value => Date.parse(String(value ?? '')));
  const prepared = Date.parse(String(record?.preparedAt ?? ''));
  if (![...sourceTimes, prepared].every(Number.isFinite) || sourceTimes.some(time => prepared < time)) findings.push('INVALID_PREPARATION_TIME');
  if (totals.decided > 0) {
    const decided = Date.parse(String(record?.decisionEvidence?.decidedAt ?? ''));
    if (!text(record?.decisionEvidence?.approver) || !text(record?.decisionEvidence?.reference)
      || !Number.isFinite(decided) || decided < Math.max(...sourceTimes) || decided > prepared) findings.push('INVALID_DECISION_EVIDENCE');
  } else if (record?.decisionEvidence !== null) findings.push('UNEXPECTED_DECISION_EVIDENCE');
  const safeguards = ['externalWritesPerformed', 'invoicesChanged', 'paymentsChanged', 'timeEntriesChanged', 'contractsChanged',
    'dispositionsApplied', 'billingOrCollectionAuthorized', 'migrationOrCutoverAuthorized', 'bonsaiRetirementAuthorized'];
  if (safeguards.some(key => record?.safeguards?.[key] !== false)) findings.push('SAFEGUARD_MISMATCH');
  return { valid: findings.length === 0, complete: candidates.length > 0 && totals.pending === 0 && totals.actionRequired === 0, ...totals, findings: [...new Set(findings)] };
}

export { FORMAT as BONSAI_FINANCIAL_EXCEPTION_DECISION_FORMAT };
