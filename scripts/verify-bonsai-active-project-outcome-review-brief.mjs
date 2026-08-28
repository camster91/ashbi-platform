#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiActiveProjectOutcomeReviewBrief } from '../src/services/bonsaiActiveProjectOutcomeReviewBrief.service.js';

function readArtifact(filePath) { const bytes = fs.readFileSync(path.resolve(filePath)); return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }
if (process.argv.length !== 9) {
  process.stderr.write('Usage: npm run verify:bonsai-active-project-outcome-review-brief -- <triage.json> <financial.json> <native-review.json> <project-link.json> <project-disposition.json> <pending-active.json> <brief.json>\n');
  process.exitCode = 2;
} else {
  try {
    const [triage, financialReview, nativeProjectReview, projectLinkDecision, projectDispositionDecision, decision, brief] = process.argv.slice(2).map(readArtifact);
    const result = verifyBonsaiActiveProjectOutcomeReviewBrief({
      triage: triage.value, triageSha256: triage.sha256,
      financialReview: financialReview.value, financialReviewSha256: financialReview.sha256,
      nativeProjectReview: nativeProjectReview.value, nativeProjectReviewSha256: nativeProjectReview.sha256,
      projectLinkDecision: projectLinkDecision.value, projectLinkDecisionSha256: projectLinkDecision.sha256,
      projectDispositionDecision: projectDispositionDecision.value, projectDispositionDecisionSha256: projectDispositionDecision.sha256,
      decision: decision.value, decisionSha256: decision.sha256, record: brief.value,
    });
    if (!result.valid) throw new Error('invalid');
    process.stdout.write(`Active-project outcome review brief is valid with ${result.approvalReady} approval-ready, ${result.blocked} blocked, and ${result.manualReview} manual-review candidate(s).\n`);
  } catch {
    process.stderr.write('Active-project outcome review brief verification failed.\n');
    process.exitCode = 2;
  }
}
