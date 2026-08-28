#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiActiveProjectOutcomeReviewBrief } from '../src/services/bonsaiActiveProjectOutcomeReviewBrief.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function readArtifact(filePath) { const bytes = fs.readFileSync(path.resolve(filePath)); return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }
const paths = {
  triage: option('--active-project-triage'), financialReview: option('--financial-review'),
  nativeProjectReview: option('--native-project-review'), projectLinkDecision: option('--project-link-decision'),
  projectDispositionDecision: option('--project-disposition-decision'), dispositionDecision: option('--active-project-disposition-decision'),
  reviewBrief: option('--review-brief'),
};
const outputPath = option('--output');
if (Object.values(paths).some(value => !value) || !outputPath) {
  process.stderr.write('Usage: npm run prepare:active-project-outcome-migration-review-bundle -- --active-project-triage <triage.json> --financial-review <financial.json> --native-project-review <review.json> --project-link-decision <link.json> --project-disposition-decision <project-disposition.json> --active-project-disposition-decision <pending-active.json> --review-brief <brief.json> --output <new-bundle.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const evidence = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, readArtifact(value)]));
    const verification = verifyBonsaiActiveProjectOutcomeReviewBrief({
      triage: evidence.triage.value, triageSha256: evidence.triage.sha256,
      financialReview: evidence.financialReview.value, financialReviewSha256: evidence.financialReview.sha256,
      nativeProjectReview: evidence.nativeProjectReview.value, nativeProjectReviewSha256: evidence.nativeProjectReview.sha256,
      projectLinkDecision: evidence.projectLinkDecision.value, projectLinkDecisionSha256: evidence.projectLinkDecision.sha256,
      projectDispositionDecision: evidence.projectDispositionDecision.value, projectDispositionDecisionSha256: evidence.projectDispositionDecision.sha256,
      decision: evidence.dispositionDecision.value, decisionSha256: evidence.dispositionDecision.sha256,
      record: evidence.reviewBrief.value,
    });
    if (!verification.valid) throw new Error('Review evidence is invalid');
    const bundle = {
      format: 'ashbi-hub-active-project-outcome-review-import',
      version: 1,
      requestId: crypto.randomUUID(),
      triage: evidence.triage.value,
      triageSha256: evidence.triage.sha256,
      financialReview: evidence.financialReview.value,
      financialReviewSha256: evidence.financialReview.sha256,
      nativeProjectReview: evidence.nativeProjectReview.value,
      nativeProjectReviewSha256: evidence.nativeProjectReview.sha256,
      projectLinkDecision: evidence.projectLinkDecision.value,
      projectLinkDecisionSha256: evidence.projectLinkDecision.sha256,
      projectDispositionDecision: evidence.projectDispositionDecision.value,
      projectDispositionDecisionSha256: evidence.projectDispositionDecision.sha256,
      dispositionDecision: evidence.dispositionDecision.value,
      dispositionDecisionSha256: evidence.dispositionDecision.sha256,
      reviewBrief: evidence.reviewBrief.value,
    };
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared a verified ${verification.approvalReady}-ready, ${verification.blocked}-blocked, ${verification.manualReview}-manual active-project outcome Hub review bundle. No project outcome or external write was performed.\n`);
  } catch {
    process.stderr.write('Active-project outcome migration review bundle preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
