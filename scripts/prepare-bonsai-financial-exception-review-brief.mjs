#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiFinancialExceptionReviewBrief } from '../src/services/bonsaiFinancialExceptionReviewBrief.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function readArtifact(filePath) {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const financialPath = option('--financial-review');
const invoicePath = option('--invoice-index');
const timePath = option('--time-entry-index');
const decisionPath = option('--financial-exception-decision');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!financialPath || !invoicePath || !timePath || !decisionPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:bonsai-financial-exception-review-brief -- --financial-review <review.json> --invoice-index <invoice.json> --time-entry-index <time.json> --financial-exception-decision <pending-decision.json> --prepared-at <ISO> --output <new-brief.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const financial = readArtifact(financialPath);
    const invoice = readArtifact(invoicePath);
    const time = readArtifact(timePath);
    const decision = readArtifact(decisionPath);
    const record = prepareBonsaiFinancialExceptionReviewBrief({
      financialReview: financial.value,
      financialReviewSha256: financial.sha256,
      invoiceSnapshot: invoice.value,
      invoiceSnapshotSha256: invoice.sha256,
      timeEntrySnapshot: time.value,
      timeEntrySnapshotSha256: time.sha256,
      decision: decision.value,
      decisionSha256: decision.sha256,
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${record.summary.approvalReady} approval-ready, ${record.summary.blocked} blocked, and ${record.summary.manualReview} manual-review financial exception recommendation(s). No decisions or external writes were performed.\n`);
  } catch {
    process.stderr.write('Financial exception review brief preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
