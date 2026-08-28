#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiNativeProjectLinkReviewBrief } from '../src/services/notionBonsaiNativeProjectLinkReviewBrief.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const reviewPath = option('--review');
const mappingDecisionPath = option('--mapping-decision');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!reviewPath || !mappingDecisionPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-native-project-link-review-brief -- --review <review.json> --mapping-decision <mapping.json> --prepared-at <ISO> --output <new-brief.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingDecisionBytes = fs.readFileSync(path.resolve(mappingDecisionPath));
    const record = prepareNotionBonsaiNativeProjectLinkReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      mappingDecision: JSON.parse(mappingDecisionBytes.toString('utf8')),
      mappingDecisionSha256: digest(mappingDecisionBytes),
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${record.summary.approvalReady} approval-ready and ${record.summary.manualReview} manual-review project-link recommendation(s) without recording decisions.\n`);
  } catch {
    process.stderr.write('Native project-link review brief preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
