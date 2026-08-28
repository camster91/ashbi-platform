import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBonsaiFinancialExceptionDecision } from '../../services/bonsaiFinancialExceptionDecision.service.js';
import {
  prepareBonsaiFinancialExceptionReviewBrief,
  verifyBonsaiFinancialExceptionReviewBrief,
} from '../../services/bonsaiFinancialExceptionReviewBrief.service.js';

const HASHES = { review: 'a'.repeat(64), invoice: 'b'.repeat(64), time: 'c'.repeat(64), decision: 'd'.repeat(64) };

function invoiceSnapshot() {
  const base = {
    invoice_number: '1', currency: 'CAD', issued_date: '2026-08-01', due_date: '2026-08-15',
    subtotal: '100.0', tax_amount: '0.0', discount_amount: null, company_id: 1,
    client_name: 'Client', created_at: '2026-08-01T00:00:00.000Z',
  };
  return {
    format: 'bonsai-invoice-index-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:00:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_invoices', pageSize: 100, pagesFetched: 1, finalHasMore: false, invoiceCount: 2 },
    privacy: { omittedFields: ['client_email', 'public_url_token', 'url', 'invoice_items', 'title'] },
    invoices: [
      { ...base, id: 1, status: 'overdue', total_amount: '100.0', project_id: 101 },
      { ...base, id: 2, invoice_number: '2', status: 'paid', total_amount: '50.0', subtotal: '50.0', project_id: 101 },
    ],
  };
}

function timeSnapshot() {
  const base = {
    seconds: 3600, date: '2026-08-01', rate: '50.0', non_billable: false, billable_amount: '50.0',
    status: 'unbilled', currency: 'CAD', task_uuid: null, owner_member_id: 1, created_at: '2026-08-01T00:00:00.000Z',
  };
  return {
    format: 'bonsai-time-entry-index-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:00:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_time_entries', pageSize: 100, pagesFetched: 1, finalHasMore: false, timeEntryCount: 3, billingFieldsVisible: true },
    privacy: { omittedFields: ['notes'] },
    time_entries: [
      { ...base, key: 'time-linked', billing_status: 'unbilled', project_id: 101 },
      { ...base, key: 'time-projectless', billing_status: 'unbilled', project_id: null },
      { ...base, key: 'time-billed', billing_status: 'billed', status: 'billed', project_id: 101 },
    ],
  };
}

function financialReview() {
  return {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, preparedAt: '2026-08-28T01:05:00.000Z',
    records: [{
      bonsaiProjectId: 101, project: 'Project', company: 'Client',
      contractEvidence: { checked: false, reason: 'NO_COMPLETE_CONTRACT_SOURCE_CAPTURE_AVAILABLE' },
    }],
    sourceEvidence: { invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshotSha256: HASHES.time },
  };
}

function options() {
  const financial = financialReview();
  const invoice = invoiceSnapshot();
  const time = timeSnapshot();
  const decision = prepareBonsaiFinancialExceptionDecision({
    financialReview: financial, invoiceSnapshot: invoice, timeEntrySnapshot: time,
    financialReviewSha256: HASHES.review, invoiceSnapshotSha256: HASHES.invoice,
    timeEntrySnapshotSha256: HASHES.time, preparedAt: '2026-08-28T01:06:00.000Z',
  });
  return {
    financialReview: financial, invoiceSnapshot: invoice, timeEntrySnapshot: time,
    financialReviewSha256: HASHES.review, invoiceSnapshotSha256: HASHES.invoice,
    timeEntrySnapshotSha256: HASHES.time, decision, decisionSha256: HASHES.decision,
    preparedAt: '2026-08-28T01:07:00.000Z',
  };
}

test('recommends only source-preserving financial migrations and keeps evidence gaps blocked', () => {
  const record = prepareBonsaiFinancialExceptionReviewBrief(options());
  assert.deepEqual(record.summary, {
    total: 4, approvalReady: 2, blocked: 1, manualReview: 1,
    byRecommendedDisposition: { MIGRATE_WITH_SOURCE_STATUS: 1, MIGRATE_AS_UNBILLED: 1 },
    byExceptionKind: {
      NON_PAID_INVOICE: { total: 1, approvalReady: 1, blocked: 0, manualReview: 0 },
      UNBILLED_TIME_ENTRY: { total: 2, approvalReady: 1, blocked: 0, manualReview: 1 },
      ACTIVE_PROJECT_CONTRACT_GAP: { total: 1, approvalReady: 0, blocked: 1, manualReview: 0 },
    },
  });
  assert.equal(record.safeguards.billingOrCollectionAuthorized, false);
  assert.equal(record.safeguards.paymentsChanged, false);
});

test('rejects decided source packets and detects changed financial recommendations', () => {
  const input = options();
  input.decision.candidates[0].disposition = 'MIGRATE_WITH_SOURCE_STATUS';
  assert.throws(() => prepareBonsaiFinancialExceptionReviewBrief(input), /fully pending/);

  const clean = options();
  const altered = prepareBonsaiFinancialExceptionReviewBrief(clean);
  altered.candidates[0].recommendedDisposition = 'RESOLVE_IN_BONSAI_AND_RECAPTURE';
  const result = verifyBonsaiFinancialExceptionReviewBrief({ ...clean, record: altered });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('REVIEW_BRIEF_MISMATCH'));
});
