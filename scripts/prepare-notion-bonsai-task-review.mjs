#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiTaskReview } from '../src/services/notionBonsaiTaskReview.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const notionPath = option('--notion');
const bonsaiPath = option('--bonsai');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!notionPath || !bonsaiPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-task-review -- --notion <notion.json> --bonsai <bonsai.json> --prepared-at <ISO> --output <new-review.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const notionBytes = fs.readFileSync(path.resolve(notionPath));
    const bonsaiBytes = fs.readFileSync(path.resolve(bonsaiPath));
    const review = prepareNotionBonsaiTaskReview({
      notionSnapshot: JSON.parse(notionBytes.toString('utf8')),
      bonsaiSnapshot: JSON.parse(bonsaiBytes.toString('utf8')),
      notionSnapshotSha256: digest(notionBytes),
      bonsaiSnapshotSha256: digest(bonsaiBytes),
      preparedAt,
    });
    fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${review.summary.reviewItems} reconciliation review item(s) without applying changes.\n`);
  } catch {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({
        format: 'ashbi-notion-bonsai-task-review',
        version: 1,
        complete: false,
        reasonCode: 'REVIEW_PREPARATION_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    process.stderr.write('Notion/Bonsai task review preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
