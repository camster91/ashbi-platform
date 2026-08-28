#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiNativeProjectLinkReviewBrief } from '../src/services/notionBonsaiNativeProjectLinkReviewBrief.service.js';

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const [reviewPath, mappingDecisionPath, briefPath] = process.argv.slice(2);
if (!reviewPath || !mappingDecisionPath || !briefPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-native-project-link-review-brief -- <review.json> <mapping-decision.json> <brief.json>\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingDecisionBytes = fs.readFileSync(path.resolve(mappingDecisionPath));
    const result = verifyNotionBonsaiNativeProjectLinkReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      mappingDecision: JSON.parse(mappingDecisionBytes.toString('utf8')),
      mappingDecisionSha256: digest(mappingDecisionBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(briefPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Native project-link review brief is valid with ${result.approvalReady} approval-ready and ${result.manualReview} manual-review candidate(s).\n`
      : `Native project-link review brief is invalid with ${result.findings.length} finding(s).\n`);
    if (!result.valid) process.exitCode = 1;
  } catch {
    process.stderr.write('Native project-link review brief verification failed.\n');
    process.exitCode = 2;
  }
}
