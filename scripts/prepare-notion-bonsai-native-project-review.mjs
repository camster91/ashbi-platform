#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiNativeProjectReview } from '../src/services/notionBonsaiNativeProjectReview.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const notionPath = option('--notion');
const bonsaiPath = option('--bonsai-projects');
const taskReviewPath = option('--task-review');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!notionPath || !bonsaiPath || !taskReviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-native-project-review -- --notion <notion.json> --bonsai-projects <bonsai-projects.json> --task-review <task-review.json> --prepared-at <ISO> --output <new-review.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const notionBytes = fs.readFileSync(path.resolve(notionPath));
    const bonsaiBytes = fs.readFileSync(path.resolve(bonsaiPath));
    const taskReviewBytes = fs.readFileSync(path.resolve(taskReviewPath));
    const review = prepareNotionBonsaiNativeProjectReview({
      notionSnapshot: JSON.parse(notionBytes.toString('utf8')),
      bonsaiProjectSnapshot: JSON.parse(bonsaiBytes.toString('utf8')),
      taskReview: JSON.parse(taskReviewBytes.toString('utf8')),
      notionSnapshotSha256: digest(notionBytes),
      bonsaiProjectSnapshotSha256: digest(bonsaiBytes),
      taskReviewSha256: digest(taskReviewBytes),
      preparedAt,
    });
    fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared native project review for ${review.summary.notionProjects} Notion and ${review.summary.bonsaiProjects} Bonsai project(s) without applying changes.\n`);
  } catch {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({ format: 'ashbi-notion-bonsai-native-project-review', version: 1, complete: false, reasonCode: 'REVIEW_PREPARATION_FAILED' }, null, 2)}\n`, 'utf8');
    }
    process.stderr.write('Native Notion/Bonsai project review preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
