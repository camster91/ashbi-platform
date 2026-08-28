#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiTaskDispositionReviewBrief } from '../src/services/notionBonsaiTaskDispositionReviewBrief.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

const reviewPath = option('--review');
const decisionPath = option('--task-disposition-decision');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!reviewPath || !decisionPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-task-disposition-review-brief -- --review <review.json> --task-disposition-decision <pending-decision.json> --prepared-at <ISO> --output <new-brief.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const decisionBytes = fs.readFileSync(path.resolve(decisionPath));
    const record = prepareNotionBonsaiTaskDispositionReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      decision: JSON.parse(decisionBytes.toString('utf8')),
      decisionSha256: digest(decisionBytes),
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${record.summary.approvalReady} approval-ready and ${record.summary.manualReview} manual-review task disposition recommendation(s) without recording decisions.\n`);
  } catch {
    process.stderr.write('Task disposition review brief preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
