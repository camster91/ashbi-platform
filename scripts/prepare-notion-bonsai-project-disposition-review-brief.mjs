#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiProjectDispositionReviewBrief } from '../src/services/notionBonsaiProjectDispositionReviewBrief.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const projectLinkDecisionPath = option('--project-link-decision');
const projectDispositionDecisionPath = option('--project-disposition-decision');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!reviewPath || !projectLinkDecisionPath || !projectDispositionDecisionPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-project-disposition-review-brief -- --review <review.json> --project-link-decision <link-decision.json> --project-disposition-decision <pending-disposition.json> --prepared-at <ISO> --output <new-brief.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const linkBytes = fs.readFileSync(path.resolve(projectLinkDecisionPath));
    const dispositionBytes = fs.readFileSync(path.resolve(projectDispositionDecisionPath));
    const record = prepareNotionBonsaiProjectDispositionReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      projectLinkDecision: JSON.parse(linkBytes.toString('utf8')),
      projectLinkDecisionSha256: digest(linkBytes),
      projectDispositionDecision: JSON.parse(dispositionBytes.toString('utf8')),
      projectDispositionDecisionSha256: digest(dispositionBytes),
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${record.summary.approvalReady} approval-ready, ${record.summary.blocked} blocked, and ${record.summary.manualReview} manual-review project disposition recommendation(s) without recording decisions.\n`);
  } catch {
    process.stderr.write('Project disposition review brief preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
