#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiFinancialExceptionReviewBrief } from '../src/services/bonsaiFinancialExceptionReviewBrief.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readArtifact(filePath) {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const financialReviewPath = option('--financial-review');
const invoiceSnapshotPath = option('--invoice-snapshot');
const timeEntrySnapshotPath = option('--time-entry-snapshot');
const dispositionPath = option('--financial-exception-decision');
const briefPath = option('--review-brief');
const outputPath = option('--output');

if (!financialReviewPath || !invoiceSnapshotPath || !timeEntrySnapshotPath || !dispositionPath || !briefPath || !outputPath) {
  process.stderr.write('Usage: npm run prepare:financial-exception-migration-review-bundle -- --financial-review <review.json> --invoice-snapshot <invoices.json> --time-entry-snapshot <time.json> --financial-exception-decision <pending-decision.json> --review-brief <brief.json> --output <new-bundle.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const financialReview = readArtifact(financialReviewPath);
    const invoiceSnapshot = readArtifact(invoiceSnapshotPath);
    const timeEntrySnapshot = readArtifact(timeEntrySnapshotPath);
    const dispositionDecision = readArtifact(dispositionPath);
    const reviewBrief = readArtifact(briefPath);
    const verification = verifyBonsaiFinancialExceptionReviewBrief({
      financialReview: financialReview.value,
      financialReviewSha256: financialReview.sha256,
      invoiceSnapshot: invoiceSnapshot.value,
      invoiceSnapshotSha256: invoiceSnapshot.sha256,
      timeEntrySnapshot: timeEntrySnapshot.value,
      timeEntrySnapshotSha256: timeEntrySnapshot.sha256,
      decision: dispositionDecision.value,
      decisionSha256: dispositionDecision.sha256,
      record: reviewBrief.value,
    });
    if (!verification.valid) throw new Error('Review evidence is invalid');
    const bundle = {
      format: 'ashbi-hub-financial-exception-review-import',
      version: 1,
      requestId: crypto.randomUUID(),
      financialReview: financialReview.value,
      financialReviewSha256: financialReview.sha256,
      invoiceSnapshot: invoiceSnapshot.value,
      invoiceSnapshotSha256: invoiceSnapshot.sha256,
      timeEntrySnapshot: timeEntrySnapshot.value,
      timeEntrySnapshotSha256: timeEntrySnapshot.sha256,
      dispositionDecision: dispositionDecision.value,
      dispositionDecisionSha256: dispositionDecision.sha256,
      reviewBrief: reviewBrief.value,
    };
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared a verified ${verification.approvalReady}-ready, ${verification.blocked}-blocked, ${verification.manualReview}-manual financial-exception Hub review bundle. No financial action or external write was performed.\n`);
  } catch {
    process.stderr.write('Financial-exception migration review bundle preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
