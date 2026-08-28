import { verifyBonsaiFinancialIndexSnapshots } from './bonsaiFinancialIndexSnapshot.service.js';

function text(value) {
  return String(value ?? '').trim();
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

function moneyMinor(value) {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const minor = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
  return negative ? -minor : minor;
}

function moneyString(minor) {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function amountsByCurrency(rows, amountFor) {
  const totals = new Map();
  for (const row of rows) {
    const minor = moneyMinor(amountFor(row));
    const currency = text(row.currency);
    if (minor === null || !currency) continue;
    totals.set(currency, (totals.get(currency) ?? 0n) + minor);
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => [currency, moneyString(minor)]));
}

function countBy(rows, field) {
  return Object.fromEntries([...new Set(rows.map(row => String(row?.[field] ?? 'unknown')))]
    .sort().map(value => [value, rows.filter(row => String(row?.[field] ?? 'unknown') === value).length]));
}

export function prepareBonsaiActiveProjectFinancialReview({
  activeProjectTriage,
  invoiceSnapshot,
  timeEntrySnapshot,
  activeProjectTriageSha256,
  invoiceSnapshotSha256,
  timeEntrySnapshotSha256,
  preparedAt,
}) {
  if (activeProjectTriage?.format !== 'ashbi-bonsai-active-project-triage'
    || activeProjectTriage?.version !== 1 || !Array.isArray(activeProjectTriage?.records)) {
    throw new TypeError('A supported active project triage packet is required');
  }
  const verification = verifyBonsaiFinancialIndexSnapshots(invoiceSnapshot, timeEntrySnapshot);
  if (!verification.valid) throw new TypeError('Valid sanitized Bonsai invoice and time-entry indexes are required');
  const triageHash = sha256(activeProjectTriageSha256, 'activeProjectTriageSha256');
  const invoiceHash = sha256(invoiceSnapshotSha256, 'invoiceSnapshotSha256');
  const timeHash = sha256(timeEntrySnapshotSha256, 'timeEntrySnapshotSha256');
  const prepared = timestamp(preparedAt, 'preparedAt');
  const triagePrepared = timestamp(activeProjectTriage.preparedAt, 'Active triage preparedAt');
  const invoiceCaptured = timestamp(invoiceSnapshot.capturedAt, 'Invoice capturedAt');
  const timeCaptured = timestamp(timeEntrySnapshot.capturedAt, 'Time capturedAt');
  if ([triagePrepared, invoiceCaptured, timeCaptured].some(value => prepared < value)) throw new TypeError('preparedAt must not predate source evidence');

  const invoicesByProject = new Map();
  for (const invoice of invoiceSnapshot.invoices) {
    if (!Number.isSafeInteger(invoice.project_id)) continue;
    invoicesByProject.set(invoice.project_id, [...(invoicesByProject.get(invoice.project_id) ?? []), invoice]);
  }
  const timeByProject = new Map();
  for (const entry of timeEntrySnapshot.time_entries) {
    if (!Number.isSafeInteger(entry.project_id)) continue;
    timeByProject.set(entry.project_id, [...(timeByProject.get(entry.project_id) ?? []), entry]);
  }

  const records = activeProjectTriage.records.map(project => {
    const invoices = invoicesByProject.get(project.bonsaiProjectId) ?? [];
    const attentionInvoices = invoices.filter(invoice => invoice.status !== 'paid');
    const timeEntries = timeByProject.get(project.bonsaiProjectId) ?? [];
    const unbilledTime = timeEntries.filter(entry => entry.billing_status === 'unbilled');
    const reasons = [];
    if (attentionInvoices.length) reasons.push('NON_PAID_INVOICE_RECORDS_REQUIRE_REVIEW');
    if (unbilledTime.length) reasons.push('UNBILLED_TIME_REQUIRES_REVIEW');
    reasons.push('DIRECT_PAYMENT_EVIDENCE_NOT_AVAILABLE');
    reasons.push('CONTRACT_EVIDENCE_NOT_AVAILABLE');
    return {
      bonsaiProjectId: project.bonsaiProjectId,
      project: project.project,
      company: project.company,
      projectGroup: project.projectGroup,
      triageBucket: project.triageBucket,
      invoiceEvidence: {
        checked: true,
        invoiceCount: invoices.length,
        byStatus: countBy(invoices, 'status'),
        totalsByCurrency: amountsByCurrency(invoices, invoice => invoice.total_amount),
        nonPaidInvoiceCount: attentionInvoices.length,
        nonPaidTotalsByCurrency: amountsByCurrency(attentionInvoices, invoice => invoice.total_amount),
        sourceIds: invoices.map(invoice => invoice.id),
      },
      timeEvidence: {
        checked: true,
        entryCount: timeEntries.length,
        totalSeconds: timeEntries.reduce((sum, entry) => sum + entry.seconds, 0),
        byBillingStatus: countBy(timeEntries, 'billing_status'),
        billableAmountsByCurrency: amountsByCurrency(timeEntries, entry => entry.billable_amount),
        unbilledEntryCount: unbilledTime.length,
        unbilledSeconds: unbilledTime.reduce((sum, entry) => sum + entry.seconds, 0),
        unbilledAmountsByCurrency: amountsByCurrency(unbilledTime, entry => entry.billable_amount),
        sourceKeys: timeEntries.map(entry => entry.key),
      },
      paymentEvidence: { checked: false, reason: 'INVOICE_STATUS_IS_NOT_DIRECT_PAYMENT_OR_SETTLEMENT_EVIDENCE' },
      contractEvidence: { checked: false, reason: 'NO_COMPLETE_CONTRACT_SOURCE_CAPTURE_AVAILABLE' },
      financialAttentionReasons: reasons,
      closureAuthorized: false,
      decisionState: 'REVIEW_REQUIRED',
    };
  });
  const activeIds = new Set(records.map(record => record.bonsaiProjectId));
  const invoiceIdsOnActive = new Set(records.flatMap(record => record.invoiceEvidence.sourceIds));
  const timeKeysOnActive = new Set(records.flatMap(record => record.timeEvidence.sourceKeys));

  return {
    format: 'ashbi-bonsai-active-project-financial-review',
    version: 1,
    complete: false,
    reasonCode: 'PAYMENT_CONTRACT_AND_HUMAN_REVIEW_REQUIRED',
    preparedAt: new Date(prepared).toISOString(),
    summary: {
      activeProjects: records.length,
      projectsWithInvoices: records.filter(record => record.invoiceEvidence.invoiceCount > 0).length,
      projectsWithNonPaidInvoices: records.filter(record => record.invoiceEvidence.nonPaidInvoiceCount > 0).length,
      projectsWithTimeEntries: records.filter(record => record.timeEvidence.entryCount > 0).length,
      projectsWithUnbilledTime: records.filter(record => record.timeEvidence.unbilledEntryCount > 0).length,
      projectsWithoutInvoiceOrTimeEvidence: records.filter(record => record.invoiceEvidence.invoiceCount === 0 && record.timeEvidence.entryCount === 0).length,
      closureAuthorizedProjects: 0,
      invoicesLinkedToActiveProjects: invoiceIdsOnActive.size,
      invoicesOutsideActiveProjects: invoiceSnapshot.invoices.length - invoiceIdsOnActive.size,
      projectlessInvoices: verification.invoices.projectlessInvoices,
      timeEntriesLinkedToActiveProjects: timeKeysOnActive.size,
      timeEntriesOutsideActiveProjects: timeEntrySnapshot.time_entries.length - timeKeysOnActive.size,
      projectlessTimeEntries: verification.timeEntries.projectlessTimeEntries,
      activeProjectIdsChecked: activeIds.size,
    },
    records,
    safeguards: {
      externalWritesPerformed: false,
      invoicesMutated: false,
      paymentsMutated: false,
      timeEntriesMutated: false,
      contractsMutated: false,
      projectsArchivedOrCompleted: false,
      closureAuthorized: false,
      financialCutoverApproved: false,
    },
    sourceEvidence: {
      activeProjectTriageSha256: triageHash,
      activeProjectTriagePreparedAt: new Date(triagePrepared).toISOString(),
      invoiceSnapshotSha256: invoiceHash,
      invoiceCapturedAt: new Date(invoiceCaptured).toISOString(),
      timeEntrySnapshotSha256: timeHash,
      timeEntryCapturedAt: new Date(timeCaptured).toISOString(),
    },
  };
}
