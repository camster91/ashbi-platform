#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiActiveProjectOutcomeReviewBrief } from '../src/services/bonsaiActiveProjectOutcomeReviewBrief.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function readArtifact(filePath) { const bytes = fs.readFileSync(path.resolve(filePath)); return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }
const paths = {
  triage: option('--active-project-triage'), financialReview: option('--financial-review'),
  nativeProjectReview: option('--native-project-review'), projectLinkDecision: option('--project-link-decision'),
  projectDispositionDecision: option('--project-disposition-decision'), decision: option('--active-project-disposition-decision'),
};
const preparedAt = option('--prepared-at');
const outputPath = option('--output');
if (Object.values(paths).some(value => !value) || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:bonsai-active-project-outcome-review-brief -- --active-project-triage <triage.json> --financial-review <financial.json> --native-project-review <review.json> --project-link-decision <link.json> --project-disposition-decision <project-disposition.json> --active-project-disposition-decision <pending-active.json> --prepared-at <ISO> --output <new-brief.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const evidence = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, readArtifact(value)]));
    const record = prepareBonsaiActiveProjectOutcomeReviewBrief({
      ...Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, value.value])),
      triageSha256: evidence.triage.sha256, financialReviewSha256: evidence.financialReview.sha256,
      nativeProjectReviewSha256: evidence.nativeProjectReview.sha256, projectLinkDecisionSha256: evidence.projectLinkDecision.sha256,
      projectDispositionDecisionSha256: evidence.projectDispositionDecision.sha256, decisionSha256: evidence.decision.sha256,
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${record.summary.approvalReady} approval-ready, ${record.summary.blocked} blocked, and ${record.summary.manualReview} manual-review active-project outcome recommendation(s). No outcome or external write was performed.\n`);
  } catch {
    process.stderr.write('Active-project outcome review brief preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
