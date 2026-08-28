#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiFinancialExceptionDecision } from '../src/services/bonsaiFinancialExceptionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const flags = { financialReview: '--financial-review', invoiceSnapshot: '--invoice-index', timeEntrySnapshot: '--time-entry-index' };
const paths = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, option(flag)]));
const decisionsPath = option('--decisions');
const outputPath = option('--output');
const preparedAt = option('--prepared-at');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');
if (Object.values(paths).some(value => !value) || !outputPath || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:bonsai-financial-exception-decision -- --financial-review <review.json> --invoice-index <invoice.json> --time-entry-index <time.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording financial exception dispositions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const input = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')) : { decisions: [] };
    const record = prepareBonsaiFinancialExceptionDecision({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      financialReviewSha256: artifacts.financialReview.sha256,
      invoiceSnapshotSha256: artifacts.invoiceSnapshot.sha256,
      timeEntrySnapshotSha256: artifacts.timeEntrySnapshot.sha256,
      preparedAt, decisions: input.decisions, approver, decidedAt, reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.decided} and retained ${record.summary.pending} pending financial exception disposition(s) without applying them.\n`);
  } catch {
    process.stderr.write('Bonsai financial exception preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
