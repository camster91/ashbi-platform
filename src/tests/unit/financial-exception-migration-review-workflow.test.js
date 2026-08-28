import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  exportFinancialExceptionDecision,
  FINANCIAL_EXCEPTION_KIND,
  importFinancialExceptionReviewPacket,
  recordMigrationReviewDecision,
} from '../../services/migrationReview.service.js';
import {
  prepareBonsaiFinancialExceptionDecision,
  verifyBonsaiFinancialExceptionDecision,
} from '../../services/bonsaiFinancialExceptionDecision.service.js';
import { prepareBonsaiFinancialExceptionReviewBrief } from '../../services/bonsaiFinancialExceptionReviewBrief.service.js';

const HASHES = { review: 'a'.repeat(64), invoice: 'b'.repeat(64), time: 'c'.repeat(64), decision: 'd'.repeat(64) };

function evidence() {
  const invoiceSnapshot = {
    format: 'bonsai-invoice-index-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:00:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_invoices', pageSize: 100, pagesFetched: 1, finalHasMore: false, invoiceCount: 1 },
    privacy: { omittedFields: ['client_email', 'public_url_token', 'url', 'invoice_items', 'title'] },
    invoices: [{ id: 1, invoice_number: '1', status: 'overdue', currency: 'CAD', total_amount: '100.0', issued_date: '2026-08-01', due_date: '2026-08-15', subtotal: '100.0', tax_amount: '0.0', discount_amount: null, project_id: 101, company_id: 1, client_name: 'Client', created_at: '2026-08-01T00:00:00.000Z' }],
  };
  const timeEntrySnapshot = {
    format: 'bonsai-time-entry-index-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-28T01:00:00.000Z',
    captureEvidence: { connector: 'bonsai', operation: 'list_time_entries', pageSize: 100, pagesFetched: 1, finalHasMore: false, timeEntryCount: 1, billingFieldsVisible: true },
    privacy: { omittedFields: ['notes'] },
    time_entries: [{ key: 'time-linked', seconds: 3600, date: '2026-08-01', rate: '50.0', non_billable: false, billable_amount: '50.0', status: 'unbilled', billing_status: 'unbilled', currency: 'CAD', task_uuid: null, project_id: 101, owner_member_id: 1, created_at: '2026-08-01T00:00:00.000Z' }],
  };
  const financialReview = {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, preparedAt: '2026-08-28T01:05:00.000Z',
    records: [{ bonsaiProjectId: 101, project: 'Project', company: 'Client', contractEvidence: { checked: false, reason: 'NO_COMPLETE_CONTRACT_SOURCE_CAPTURE_AVAILABLE' } }],
    sourceEvidence: { invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshotSha256: HASHES.time },
  };
  const dispositionDecision = prepareBonsaiFinancialExceptionDecision({ financialReview, invoiceSnapshot, timeEntrySnapshot, financialReviewSha256: HASHES.review, invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshotSha256: HASHES.time, preparedAt: '2026-08-28T01:06:00.000Z' });
  const reviewBrief = prepareBonsaiFinancialExceptionReviewBrief({ financialReview, invoiceSnapshot, timeEntrySnapshot, financialReviewSha256: HASHES.review, invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshotSha256: HASHES.time, decision: dispositionDecision, decisionSha256: HASHES.decision, preparedAt: '2026-08-28T01:07:00.000Z' });
  return { format: 'ashbi-hub-financial-exception-review-import', version: 1, requestId: '11111111-1111-4111-8111-111111111111', financialReview, financialReviewSha256: HASHES.review, invoiceSnapshot, invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshot, timeEntrySnapshotSha256: HASHES.time, dispositionDecision, dispositionDecisionSha256: HASHES.decision, reviewBrief };
}

function fakePrisma() {
  const packets = [];
  const decisions = [];
  return {
    packets, decisions,
    migrationReviewPacket: {
      async findFirst({ where }) { const row = packets.find(item => Object.entries(where).every(([key, value]) => item[key] === value)); return row ? { ...row, decisions: decisions.filter(item => item.packetId === row.id).sort((a, b) => b.decidedAt - a.decidedAt) } : null; },
      async findMany() { return packets.map(row => ({ ...row, decisions: decisions.filter(item => item.packetId === row.id) })); },
      async create({ data }) { const row = { id: `packet-${packets.length + 1}`, ...data, updatedAt: data.createdAt }; packets.push(row); return { ...row, decisions: [] }; },
    },
    migrationReviewDecision: {
      async findFirst({ where }) { return decisions.find(item => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null; },
      async create({ data }) { const row = { id: `decision-${decisions.length + 1}`, ...data, createdAt: data.decidedAt }; decisions.push(row); return row; },
    },
  };
}

test('imports financial exceptions replay-safely and exports only approved source-preserving recommendations', async () => {
  const prismaClient = fakePrisma();
  const input = evidence();
  const first = await importFinancialExceptionReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:08:00.000Z') });
  const replay = await importFinancialExceptionReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  assert.equal(first.packet.kind, FINANCIAL_EXCEPTION_KIND);
  assert.equal(first.packet.summary.total, 3);
  assert.equal(replay.replayed, true);
  const invoice = first.packet.candidates.find(item => item.exceptionKind === 'NON_PAID_INVOICE');
  await recordMigrationReviewDecision({ prismaClient, packetId: first.packet.id, candidateId: invoice.candidateId, requestId: '22222222-2222-4222-8222-222222222222', decision: 'APPROVED', reviewedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:09:00.000Z') });
  const record = await exportFinancialExceptionDecision({ prismaClient, packetId: first.packet.id, now: new Date('2026-08-28T01:10:00.000Z') });
  const verified = verifyBonsaiFinancialExceptionDecision({ financialReview: input.financialReview, financialReviewSha256: HASHES.review, invoiceSnapshot: input.invoiceSnapshot, invoiceSnapshotSha256: HASHES.invoice, timeEntrySnapshot: input.timeEntrySnapshot, timeEntrySnapshotSha256: HASHES.time, record });
  assert.equal(verified.valid, true);
  assert.equal(verified.decided, 1);
  assert.equal(record.safeguards.dispositionsApplied, false);
  assert.equal(record.safeguards.billingOrCollectionAuthorized, false);
});

test('refuses approval for a contract gap without source capture or attestation', async () => {
  const prismaClient = fakePrisma();
  const input = evidence();
  const imported = await importFinancialExceptionReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  const contractGap = imported.packet.candidates.find(item => item.exceptionKind === 'ACTIVE_PROJECT_CONTRACT_GAP');
  await assert.rejects(recordMigrationReviewDecision({ prismaClient, packetId: imported.packet.id, candidateId: contractGap.candidateId, requestId: '33333333-3333-4333-8333-333333333333', decision: 'APPROVED', reviewedBy: 'cameron@ashbi.ca' }), /approval-ready/);
});

test('financial-exception bundle CLI binds exact file bytes and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'financial-exception-hub-review-'));
  try {
    const input = evidence();
    const names = ['financialReview', 'invoiceSnapshot', 'timeEntrySnapshot', 'dispositionDecision'];
    const paths = Object.fromEntries(names.map(name => [name, path.join(temp, `${name}.json`)]));
    for (const name of names) fs.writeFileSync(paths[name], `${JSON.stringify(input[name], null, 2)}\n`);
    const hashes = Object.fromEntries(names.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(paths[name])).digest('hex')]));
    input.financialReview.sourceEvidence.invoiceSnapshotSha256 = hashes.invoiceSnapshot;
    input.financialReview.sourceEvidence.timeEntrySnapshotSha256 = hashes.timeEntrySnapshot;
    fs.writeFileSync(paths.financialReview, `${JSON.stringify(input.financialReview, null, 2)}\n`);
    hashes.financialReview = crypto.createHash('sha256').update(fs.readFileSync(paths.financialReview)).digest('hex');
    input.dispositionDecision = prepareBonsaiFinancialExceptionDecision({
      financialReview: input.financialReview, invoiceSnapshot: input.invoiceSnapshot, timeEntrySnapshot: input.timeEntrySnapshot,
      financialReviewSha256: hashes.financialReview, invoiceSnapshotSha256: hashes.invoiceSnapshot,
      timeEntrySnapshotSha256: hashes.timeEntrySnapshot, preparedAt: '2026-08-28T01:06:00.000Z',
    });
    fs.writeFileSync(paths.dispositionDecision, `${JSON.stringify(input.dispositionDecision, null, 2)}\n`);
    hashes.dispositionDecision = crypto.createHash('sha256').update(fs.readFileSync(paths.dispositionDecision)).digest('hex');
    const brief = prepareBonsaiFinancialExceptionReviewBrief({
      financialReview: input.financialReview, financialReviewSha256: hashes.financialReview,
      invoiceSnapshot: input.invoiceSnapshot, invoiceSnapshotSha256: hashes.invoiceSnapshot,
      timeEntrySnapshot: input.timeEntrySnapshot, timeEntrySnapshotSha256: hashes.timeEntrySnapshot,
      decision: input.dispositionDecision, decisionSha256: hashes.dispositionDecision, preparedAt: '2026-08-28T01:07:00.000Z',
    });
    const briefPath = path.join(temp, 'brief.json');
    const outputPath = path.join(temp, 'bundle.json');
    fs.writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    const args = ['scripts/prepare-financial-exception-migration-review-bundle.mjs', '--financial-review', paths.financialReview, '--invoice-snapshot', paths.invoiceSnapshot, '--time-entry-snapshot', paths.timeEntrySnapshot, '--financial-exception-decision', paths.dispositionDecision, '--review-brief', briefPath, '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const bundle = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(bundle.format, 'ashbi-hub-financial-exception-review-import');
    assert.equal(bundle.reviewBrief.summary.approvalReady, 2);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
