import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyBonsaiFinancialIndexSnapshots } from '../../services/bonsaiFinancialIndexSnapshot.service.js';

function snapshots() {
  const capturedAt = '2026-08-28T01:35:44.389Z';
  const invoices = {
    format: 'bonsai-invoice-index-snapshot', version: 1, scope: 'all', complete: true, capturedAt,
    captureEvidence: { connector: 'bonsai', operation: 'list_invoices', pageSize: 100, pagesFetched: 1, finalHasMore: false, invoiceCount: 1 },
    privacy: { omittedFields: ['client_email', 'public_url_token', 'url', 'invoice_items', 'title'] },
    invoices: [{ id: 1, invoice_number: '1001', currency: 'CAD', issued_date: '2026-08-01', due_date: null, status: 'paid', total_amount: '100.00', subtotal: '100.00', tax_amount: '0.00', discount_amount: null, project_id: 10, company_id: 20, client_name: 'Client', created_at: capturedAt }],
  };
  const timeEntries = {
    format: 'bonsai-time-entry-index-snapshot', version: 1, scope: 'all', complete: true, capturedAt,
    captureEvidence: { connector: 'bonsai', operation: 'list_time_entries', pageSize: 100, pagesFetched: 1, finalHasMore: false, timeEntryCount: 1, billingFieldsVisible: true },
    privacy: { omittedFields: ['notes'] },
    time_entries: [{ key: 'time-1', seconds: 3600, date: '2026-08-01', rate: '100.00', non_billable: false, billable_amount: '100.00', billing_status: 'billed', status: 'billed', currency: 'CAD', project_id: 10, task_uuid: null, owner_member_id: 30, created_at: capturedAt }],
  };
  return { invoices, timeEntries };
}

test('accepts complete sanitized financial indexes with visible billing evidence', () => {
  const { invoices, timeEntries } = snapshots();
  const report = verifyBonsaiFinancialIndexSnapshots(invoices, timeEntries);
  assert.equal(report.valid, true);
  assert.equal(report.projectLinkageReady, true);
  assert.equal(report.invoices.invoiceCount, 1);
  assert.equal(report.timeEntries.billingFieldsVisible, true);
});

test('preserves projectless financial records as linkage blockers without invalidating capture', () => {
  const { invoices, timeEntries } = snapshots();
  invoices.invoices[0].project_id = null;
  timeEntries.time_entries[0].project_id = null;
  const report = verifyBonsaiFinancialIndexSnapshots(invoices, timeEntries);
  assert.equal(report.valid, true);
  assert.equal(report.projectLinkageReady, false);
  assert.equal(report.invoices.projectlessInvoices, 1);
  assert.equal(report.timeEntries.projectlessTimeEntries, 1);
});

test('rejects forbidden sensitive fields and duplicate stable identities', () => {
  const { invoices, timeEntries } = snapshots();
  invoices.invoices.push({ ...invoices.invoices[0], client_email: 'private@example.test' });
  invoices.captureEvidence.invoiceCount = 2;
  timeEntries.time_entries.push({ ...timeEntries.time_entries[0], notes: 'private' });
  timeEntries.captureEvidence.timeEntryCount = 2;
  const report = verifyBonsaiFinancialIndexSnapshots(invoices, timeEntries);
  assert.equal(report.valid, false);
  assert.match(JSON.stringify(report), /privacy/);
  assert.match(JSON.stringify(report), /DUPLICATE_INVOICE_ID/);
  assert.match(JSON.stringify(report), /DUPLICATE_TIME_ENTRY_KEY/);
});

test('verification command is read-only and reports generic read failures', () => {
  const script = fs.readFileSync('scripts/verify-bonsai-financial-index.mjs', 'utf8');
  assert.doesNotMatch(script, /writeFile|appendFile|createWriteStream|prisma|fetch\(/);
  assert.match(script, /SNAPSHOT_READ_FAILED/);
});
