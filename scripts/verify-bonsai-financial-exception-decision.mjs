#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiFinancialExceptionDecision } from '../src/services/bonsaiFinancialExceptionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const flags = { financialReview: '--financial-review', invoiceSnapshot: '--invoice-index', timeEntrySnapshot: '--time-entry-index' };
const paths = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, option(flag)]));
const recordPath = option('--financial-exception-decision');
if (Object.values(paths).some(value => !value) || !recordPath) {
  process.stderr.write('Usage: npm run verify:bonsai-financial-exception-decision -- --financial-review <review.json> --invoice-index <invoice.json> --time-entry-index <time.json> --financial-exception-decision <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const result = verifyBonsaiFinancialExceptionDecision({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      financialReviewSha256: artifacts.financialReview.sha256,
      invoiceSnapshotSha256: artifacts.invoiceSnapshot.sha256,
      timeEntrySnapshotSha256: artifacts.timeEntrySnapshot.sha256,
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Financial exception record is valid with ${result.pending} pending and ${result.actionRequired} action-required disposition(s).\n`
      : `Financial exception record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Bonsai financial exception verification failed.\n');
    process.exitCode = 2;
  }
}
