import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  prepareBonsaiFinancialExceptionDecision,
  verifyBonsaiFinancialExceptionDecision,
} from '../../services/bonsaiFinancialExceptionDecision.service.js';

const H = { review: 'a'.repeat(64), invoice: 'b'.repeat(64), time: 'c'.repeat(64) };
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
    captureEvidence: { connector: 'bonsai', operation: 'list_time_entries', pageSize: 100, pagesFetched: 1, finalHasMore: false, timeEntryCount: 2, billingFieldsVisible: true },
    privacy: { omittedFields: ['notes'] },
    time_entries: [
      { ...base, key: 'time-1', billing_status: 'unbilled', project_id: null },
      { ...base, key: 'time-2', billing_status: 'billed', status: 'billed', project_id: 101 },
    ],
  };
}
function financialReview(invoiceHash = H.invoice, timeHash = H.time) {
  return {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, preparedAt: '2026-08-28T01:05:00.000Z',
    records: [{
      bonsaiProjectId: 101, project: 'Project', company: 'Client',
      contractEvidence: { checked: false, reason: 'NO_COMPLETE_CONTRACT_SOURCE_CAPTURE_AVAILABLE' },
    }],
    sourceEvidence: { invoiceSnapshotSha256: invoiceHash, timeEntrySnapshotSha256: timeHash },
  };
}
function options() {
  return {
    financialReview: financialReview(), invoiceSnapshot: invoiceSnapshot(), timeEntrySnapshot: timeSnapshot(),
    financialReviewSha256: H.review, invoiceSnapshotSha256: H.invoice, timeEntrySnapshotSha256: H.time,
    preparedAt: '2026-08-28T01:06:00.000Z',
  };
}

test('prepares every non-paid invoice, unbilled time entry, and active contract gap', () => {
  const input = options();
  const record = prepareBonsaiFinancialExceptionDecision(input);
  assert.deepEqual(record.summary, {
    total: 3, pending: 3, decided: 0, actionRequired: 0, projectlessTimeEntries: 1,
    byExceptionKind: { NON_PAID_INVOICE: 1, UNBILLED_TIME_ENTRY: 1, ACTIVE_PROJECT_CONTRACT_GAP: 1 },
    byDisposition: { PENDING: 3 },
  });
  assert.equal(record.safeguards.billingOrCollectionAuthorized, false);
  assert.equal(verifyBonsaiFinancialExceptionDecision({ ...input, record }).valid, true);
});

test('permits a complete non-mutating migration disposition with evidence', () => {
  const input = options();
  const base = prepareBonsaiFinancialExceptionDecision(input);
  const decisions = base.candidates.map(candidate => ({
    candidateId: candidate.candidateId,
    disposition: candidate.exceptionKind === 'NON_PAID_INVOICE' ? 'MIGRATE_WITH_SOURCE_STATUS'
      : candidate.exceptionKind === 'UNBILLED_TIME_ENTRY' ? 'MIGRATE_UNLINKED_WITH_EVIDENCE'
        : 'ATTEST_NO_CONTRACT_WITH_EVIDENCE',
    rationale: 'Reviewed source evidence', reference: `review:${candidate.sourceId}`,
  }));
  const record = prepareBonsaiFinancialExceptionDecision({
    ...input, preparedAt: '2026-08-28T01:07:00.000Z', decisions,
    approver: 'Cameron', decidedAt: '2026-08-28T01:06:30.000Z', reference: 'financial-batch-1',
  });
  assert.equal(record.complete, true);
  assert.equal(record.summary.actionRequired, 0);
});

test('keeps recapture decisions blocking and rejects implicit projectless migration', () => {
  const input = options();
  const base = prepareBonsaiFinancialExceptionDecision(input);
  const time = base.candidates.find(candidate => candidate.exceptionKind === 'UNBILLED_TIME_ENTRY');
  assert.throws(() => prepareBonsaiFinancialExceptionDecision({
    ...input, decisions: [{ candidateId: time.candidateId, disposition: 'MIGRATE_AS_UNBILLED', rationale: 'Missing link', reference: 'row' }],
  }), /explicit linkage/);
  const invoice = base.candidates.find(candidate => candidate.exceptionKind === 'NON_PAID_INVOICE');
  const record = prepareBonsaiFinancialExceptionDecision({
    ...input, preparedAt: '2026-08-28T01:07:00.000Z',
    decisions: [{ candidateId: invoice.candidateId, disposition: 'RESOLVE_IN_BONSAI_AND_RECAPTURE', rationale: 'Resolve first', reference: 'row' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:06:30.000Z', reference: 'financial-batch-2',
  });
  assert.equal(record.summary.actionRequired, 1);
  assert.equal(record.complete, false);
});

test('rejects altered safeguards and CLI requires confirmation for decisions', () => {
  const input = options();
  const unsafe = prepareBonsaiFinancialExceptionDecision(input);
  unsafe.safeguards.paymentsChanged = true;
  assert.ok(verifyBonsaiFinancialExceptionDecision({ ...input, record: unsafe }).findings.includes('SAFEGUARD_MISMATCH'));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'financial-exception-'));
  try {
    const write = (name, document) => {
      const file = path.join(temp, `${name}.json`);
      const bytes = Buffer.from(JSON.stringify(document));
      fs.writeFileSync(file, bytes);
      return { file, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    };
    const invoice = write('invoice', invoiceSnapshot());
    const time = write('time', timeSnapshot());
    const review = write('review', financialReview(invoice.hash, time.hash));
    const output = path.join(temp, 'decision.json');
    const args = ['scripts/prepare-bonsai-financial-exception-decision.mjs', '--financial-review', review.file,
      '--invoice-index', invoice.file, '--time-entry-index', time.file,
      '--prepared-at', '2026-08-28T01:06:00.000Z', '--output', output];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).summary.pending, 3);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const decisions = path.join(temp, 'decisions.json');
    fs.writeFileSync(decisions, JSON.stringify({ decisions: [] }));
    const unconfirmed = spawnSync(process.execPath, [...args.slice(0, -1), path.join(temp, 'decided.json'), '--decisions', decisions], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
