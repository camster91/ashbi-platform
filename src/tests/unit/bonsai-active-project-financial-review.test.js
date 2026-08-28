import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareBonsaiActiveProjectFinancialReview } from '../../services/bonsaiActiveProjectFinancialReview.service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function sources() {
  const capturedAt = '2026-08-28T01:35:44.389Z';
  const triage = {
    format: 'ashbi-bonsai-active-project-triage', version: 1, preparedAt: '2026-08-28T01:27:57.093Z',
    records: [1, 2].map(id => ({ bonsaiProjectId: id, project: `Project ${id}`, company: `Client ${id}`, projectGroup: { id: 'group', name: 'In Progress', state: 'active' }, triageBucket: 'PROVEN_EXACT_LINK_REVIEW' })),
  };
  const invoice = (id, status, total) => ({ id, invoice_number: String(id), currency: 'CAD', issued_date: '2026-08-01', due_date: null, status, total_amount: total, subtotal: total, tax_amount: '0.00', discount_amount: null, project_id: 1, company_id: 10, client_name: 'Client 1', created_at: capturedAt });
  const invoices = {
    format: 'bonsai-invoice-index-snapshot', version: 1, scope: 'all', complete: true, capturedAt,
    captureEvidence: { connector: 'bonsai', operation: 'list_invoices', pageSize: 100, pagesFetched: 1, finalHasMore: false, invoiceCount: 2 },
    privacy: { omittedFields: ['client_email', 'public_url_token', 'url', 'invoice_items', 'title'] },
    invoices: [invoice(1, 'paid', '100.00'), invoice(2, 'overdue', '50.50')],
  };
  const entry = (key, projectId, billingStatus, amount) => ({ key, seconds: 3600, date: '2026-08-01', rate: '100.00', non_billable: false, billable_amount: amount, billing_status: billingStatus, status: billingStatus, currency: 'CAD', project_id: projectId, task_uuid: null, owner_member_id: 30, created_at: capturedAt });
  const time = {
    format: 'bonsai-time-entry-index-snapshot', version: 1, scope: 'all', complete: true, capturedAt,
    captureEvidence: { connector: 'bonsai', operation: 'list_time_entries', pageSize: 100, pagesFetched: 1, finalHasMore: false, timeEntryCount: 2, billingFieldsVisible: true },
    privacy: { omittedFields: ['notes'] },
    time_entries: [entry('time-1', 2, 'unbilled', '100.00'), entry('time-2', null, 'non_billable', '0.00')],
  };
  return { triage, invoices, time };
}

function input() {
  const { triage, invoices, time } = sources();
  return { activeProjectTriage: triage, invoiceSnapshot: invoices, timeEntrySnapshot: time, activeProjectTriageSha256: HASH_A, invoiceSnapshotSha256: HASH_B, timeEntrySnapshotSha256: HASH_C, preparedAt: '2026-08-28T01:40:00Z' };
}

test('adds exact currency-separated invoice and time evidence without authorizing closure', () => {
  const review = prepareBonsaiActiveProjectFinancialReview(input());
  assert.deepEqual(review.summary, {
    activeProjects: 2, projectsWithInvoices: 1, projectsWithNonPaidInvoices: 1,
    projectsWithTimeEntries: 1, projectsWithUnbilledTime: 1,
    projectsWithoutInvoiceOrTimeEvidence: 0, closureAuthorizedProjects: 0,
    invoicesLinkedToActiveProjects: 2, invoicesOutsideActiveProjects: 0, projectlessInvoices: 0,
    timeEntriesLinkedToActiveProjects: 1, timeEntriesOutsideActiveProjects: 1, projectlessTimeEntries: 1,
    activeProjectIdsChecked: 2,
  });
  assert.deepEqual(review.records[0].invoiceEvidence.totalsByCurrency, { CAD: '150.50' });
  assert.deepEqual(review.records[0].invoiceEvidence.nonPaidTotalsByCurrency, { CAD: '50.50' });
  assert.deepEqual(review.records[1].timeEvidence.unbilledAmountsByCurrency, { CAD: '100.00' });
  assert.equal(review.records.every(record => record.closureAuthorized === false), true);
  assert.equal(review.safeguards.financialCutoverApproved, false);
});

test('rejects financial evidence prepared after the requested review time', () => {
  const value = input();
  value.preparedAt = '2026-08-28T01:30:00Z';
  assert.throws(() => prepareBonsaiActiveProjectFinancialReview(value), /must not predate/);
});

test('CLI creates an immutable financial review and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-financial-review-'));
  try {
    const { triage, invoices, time } = sources();
    const triagePath = path.join(temp, 'triage.json');
    const invoicePath = path.join(temp, 'invoices.json');
    const timePath = path.join(temp, 'time.json');
    const outputPath = path.join(temp, 'review.json');
    fs.writeFileSync(triagePath, JSON.stringify(triage));
    fs.writeFileSync(invoicePath, JSON.stringify(invoices));
    fs.writeFileSync(timePath, JSON.stringify(time));
    const args = ['scripts/prepare-bonsai-active-project-financial-review.mjs', '--active-project-triage', triagePath, '--invoice-index', invoicePath, '--time-entry-index', timePath, '--prepared-at', '2026-08-28T01:40:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).format, 'ashbi-bonsai-active-project-financial-review');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).reasonCode, 'PAYMENT_CONTRACT_AND_HUMAN_REVIEW_REQUIRED');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
