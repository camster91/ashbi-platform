#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiFinancialExceptionReviewBrief } from '../src/services/bonsaiFinancialExceptionReviewBrief.service.js';

function readArtifact(filePath) {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv.length !== 7) {
  process.stderr.write('Usage: npm run verify:bonsai-financial-exception-review-brief -- <financial-review.json> <invoice.json> <time.json> <pending-decision.json> <brief.json>\n');
  process.exitCode = 2;
} else {
  try {
    const financial = readArtifact(process.argv[2]);
    const invoice = readArtifact(process.argv[3]);
    const time = readArtifact(process.argv[4]);
    const decision = readArtifact(process.argv[5]);
    const brief = readArtifact(process.argv[6]);
    const result = verifyBonsaiFinancialExceptionReviewBrief({
      financialReview: financial.value,
      financialReviewSha256: financial.sha256,
      invoiceSnapshot: invoice.value,
      invoiceSnapshotSha256: invoice.sha256,
      timeEntrySnapshot: time.value,
      timeEntrySnapshotSha256: time.sha256,
      decision: decision.value,
      decisionSha256: decision.sha256,
      record: brief.value,
    });
    if (!result.valid) throw new Error('invalid');
    process.stdout.write(`Financial exception review brief is valid with ${result.approvalReady} approval-ready, ${result.blocked} blocked, and ${result.manualReview} manual-review candidate(s).\n`);
  } catch {
    process.stderr.write('Financial exception review brief verification failed.\n');
    process.exitCode = 2;
  }
}
