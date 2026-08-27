import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRevenueEvidenceManifest, REVENUE_EVIDENCE_COLLECTIONS } from '../../services/revenueEvidenceExport.service.js';

const reconciliation = await import('../../services/bonsaiRevenueReconciliation.service.js').catch(() => ({}));

function revenueExport(invoices, payments = []) {
  const records = Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [collection, []]));
  records.invoices = invoices;
  records.payments = payments;
  return {
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    exportedAt: '2026-08-20T12:00:00.000Z',
    records,
    manifest: buildRevenueEvidenceManifest(records),
  };
}

test('Bonsai invoice reconciliation binds an exact source match to Hub revenue evidence', () => {
  assert.equal(typeof reconciliation.reconcileBonsaiRevenue, 'function');
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
    { id: 'hub-2', bonsaiInvoiceId: '2719385', invoiceNumber: 'INV-002', status: 'SENT', currency: 'USD', totalMinor: 20000 },
  ], [{ id: 'payment-1', invoiceId: 'hub-1', amountMinor: 11300, currency: 'CAD', method: 'OTHER', settlementEvidenceStatus: 'PENDING' }]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1',
    completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64),
    revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [
      { invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384', status: 'paid', currency: 'cad', total_amount: '113.00' },
      { invoice_number: 'INV-002', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719385', status: 'sent', currency: 'USD', total_amount: '200.00' },
    ],
    revenueExport: hubEvidence,
  });

  assert.equal(report.format, 'ashbi-parallel-reconciliation');
  assert.equal(report.complete, true);
  assert.equal(report.organizationId, 'org-1');
  assert.equal(report.unresolvedFindings, 0);
  assert.equal(report.currenciesSeparated, true);
  assert.deepEqual(report.summary, { sourceInvoices: 2, hubBonsaiInvoices: 2, matchedInvoices: 2 });
  assert.deepEqual(report.findings, []);
  assert.equal(report.sourceEvidence.invoicesSha256, 'a'.repeat(64));
  assert.equal(report.revenueEvidence.artifactSha256, 'b'.repeat(64));
  assert.equal(report.revenueEvidence.recordsSha256, hubEvidence.manifest.recordsSha256);
  assert.equal(report.revenueEvidence.collectionCounts.invoices, 2);
});

test('Bonsai invoice reconciliation reports exact status currency and total mismatches', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
  ], [{ id: 'payment-1', invoiceId: 'hub-1', amountMinor: 11300, currency: 'CAD', method: 'OTHER', settlementEvidenceStatus: 'PENDING' }]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1',
    completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64),
    revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{
      invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
      status: 'sent', currency: 'USD', total_amount: '114.00',
    }],
    revenueExport: hubEvidence,
  });

  assert.equal(report.unresolvedFindings, 3);
  assert.equal(report.summary.matchedInvoices, 0);
  assert.deepEqual(report.findings, [
    { code: 'INVOICE_STATUS_MISMATCH', sourceId: '2719384', invoiceNumber: 'INV-001', bonsai: 'SENT', hub: 'PAID' },
    { code: 'INVOICE_CURRENCY_MISMATCH', sourceId: '2719384', invoiceNumber: 'INV-001', bonsai: 'USD', hub: 'CAD' },
    { code: 'INVOICE_TOTAL_MISMATCH', sourceId: '2719384', invoiceNumber: 'INV-001', bonsaiMinor: 11400, hubMinor: 11300 },
  ]);
});

test('Bonsai invoice reconciliation preserves invoice-number identity evidence', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-OTHER', status: 'SENT', currency: 'CAD', totalMinor: 11300 },
  ]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{
      invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
      status: 'sent', currency: 'CAD', total_amount: '113.00',
    }], revenueExport: hubEvidence,
  });

  assert.deepEqual(report.findings, [{
    code: 'INVOICE_NUMBER_MISMATCH', sourceId: '2719384', bonsai: 'INV-001', hub: 'INV-OTHER',
  }]);
});

test('Bonsai invoice reconciliation reports missing records on either side', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-2', bonsaiInvoiceId: '2719385', invoiceNumber: 'INV-002', status: 'SENT', currency: 'USD', totalMinor: 20000 },
  ]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1',
    completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64),
    revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{
      invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
      status: 'paid', currency: 'CAD', total_amount: '113.00',
    }],
    revenueExport: hubEvidence,
  });

  assert.deepEqual(report.findings, [
    { code: 'BONSAI_INVOICE_MISSING_IN_HUB', sourceId: '2719384', invoiceNumber: 'INV-001' },
    { code: 'HUB_BONSAI_INVOICE_MISSING_IN_SOURCE', sourceId: '2719385', invoiceNumber: 'INV-002', hubInvoiceId: 'hub-2' },
  ]);
});

test('Bonsai invoice reconciliation keeps unsupported source evidence unresolved', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
  ]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{
      invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
      status: 'mystery', currency: 'EUR', total_amount: '113.001',
    }],
    revenueExport: hubEvidence,
  });

  assert.equal(report.currenciesSeparated, false);
  assert.deepEqual(report.findings, [{
    code: 'BONSAI_INVOICE_SOURCE_INVALID', sourceId: '2719384', invoiceNumber: 'INV-001',
    fields: ['status', 'currency', 'total_amount'],
  }]);
});

test('Bonsai invoice reconciliation validates malformed rows before matching', () => {
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{ invoice_number: '', status: 'paid', currency: 'CAD', total_amount: '113.00' }],
    revenueExport: revenueExport([]),
  });

  assert.deepEqual(report.findings, [{
    code: 'BONSAI_INVOICE_SOURCE_INVALID', sourceId: '', invoiceNumber: '', fields: ['invoice_number'],
  }]);
});

test('Bonsai reconciliation rejects malformed thousands separators instead of guessing', () => {
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{ invoice_number: 'INV-001', status: 'sent', currency: 'CAD', total_amount: '1,2,3.00' }],
    revenueExport: revenueExport([]),
  });
  assert.deepEqual(report.findings[0].fields, ['total_amount']);
});

test('Bonsai invoice reconciliation refuses ambiguous duplicate source identities', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
    { id: 'hub-2', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001-copy', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
  ]);
  const sourceRow = {
    invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
    status: 'paid', currency: 'CAD', total_amount: '113.00',
  };
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [sourceRow, { ...sourceRow }], revenueExport: hubEvidence,
  });

  assert.deepEqual(report.findings, [
    { code: 'DUPLICATE_BONSAI_INVOICE_ID', sourceId: '2719384', rows: 2 },
    { code: 'DUPLICATE_HUB_BONSAI_INVOICE_ID', sourceId: '2719384', hubInvoiceIds: ['hub-1', 'hub-2'] },
  ]);
});

test('Bonsai paid invoices require exact Hub payment evidence', () => {
  const hubEvidence = revenueExport([
    { id: 'hub-1', bonsaiInvoiceId: '2719384', invoiceNumber: 'INV-001', status: 'PAID', currency: 'CAD', totalMinor: 11300 },
  ]);
  const report = reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T13:00:00.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [{
      invoice_number: 'INV-001', contractor_invoice_link: 'https://app.hellobonsai.com/invoices/2719384',
      status: 'paid', currency: 'CAD', total_amount: '113.00',
    }],
    revenueExport: hubEvidence,
  });

  assert.deepEqual(report.findings, [{
    code: 'PAID_INVOICE_PAYMENT_EVIDENCE_MISSING', sourceId: '2719384', invoiceNumber: 'INV-001',
    expectedMinor: 11300, currency: 'CAD', evidencedMinor: 0,
  }]);
});

test('Bonsai revenue reconciliation CLI creates a read-only-source owner evidence report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-revenue-'));
  try {
    const csvPath = path.join(directory, 'invoices.csv');
    const revenuePath = path.join(directory, 'revenue.json');
    const outputPath = path.join(directory, 'parallel.json');
    fs.writeFileSync(csvPath, [
      'invoice_number,contractor_invoice_link,status,currency,total_amount',
      'INV-002,https://app.hellobonsai.com/invoices/2719385,sent,USD,200.00',
    ].join('\n'));
    fs.writeFileSync(revenuePath, JSON.stringify(revenueExport([
      { id: 'hub-2', bonsaiInvoiceId: '2719385', invoiceNumber: 'INV-002', status: 'SENT', currency: 'USD', totalMinor: 20000 },
    ])));

    const result = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-revenue.js',
      '--organization-id', 'org-1',
      '--bonsai-invoices', csvPath,
      '--revenue-export', revenuePath,
      '--completed-at', '2026-08-20T13:00:00.000Z',
      '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(report.unresolvedFindings, 0);
    assert.equal(report.summary.matchedInvoices, 1);
    assert.match(result.stdout, /Reconciliation passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Bonsai revenue reconciliation CLI preserves a bounded failed-attempt artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-revenue-failed-'));
  try {
    const csvPath = path.join(directory, 'invoices.csv');
    const revenuePath = path.join(directory, 'revenue.json');
    const outputPath = path.join(directory, 'parallel.json');
    fs.writeFileSync(csvPath, 'invoice_number,status,currency,total_amount\nINV-001,paid,CAD,113.00\n');
    fs.writeFileSync(revenuePath, JSON.stringify({ format: 'invalid' }));

    const result = spawnSync(process.execPath, [
      'scripts/reconcile-bonsai-revenue.js', '--organization-id', 'org-1',
      '--bonsai-invoices', csvPath, '--revenue-export', revenuePath,
      '--completed-at', '2026-08-20T13:00:00.000Z', '--output', outputPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), {
      format: 'ashbi-parallel-reconciliation', version: 1, complete: false,
      reasonCode: 'RECONCILIATION_FAILED',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Bonsai reconciliation cannot be completed before the Hub evidence export', () => {
  assert.throws(() => reconciliation.reconcileBonsaiRevenue({
    organizationId: 'org-1', completedAt: '2026-08-20T11:59:59.000Z',
    bonsaiInvoicesSha256: 'a'.repeat(64), revenueArtifactSha256: 'b'.repeat(64),
    bonsaiRows: [], revenueExport: revenueExport([]),
  }), /completedAt must not predate/);
});
