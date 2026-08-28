#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiTaskDispositionReviewBrief } from '../src/services/notionBonsaiTaskDispositionReviewBrief.service.js';

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const [reviewPath, taskLinkDecisionPath, decisionPath, briefPath, mappingDecisionPath] = process.argv.slice(2);

if (!reviewPath || !taskLinkDecisionPath || !decisionPath || !briefPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-task-disposition-review-brief -- <review.json> <task-link-decision.json> <pending-decision.json> <brief.json> [mapping-decision.json]\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const taskLinkDecisionBytes = fs.readFileSync(path.resolve(taskLinkDecisionPath));
    const mappingDecisionBytes = mappingDecisionPath ? fs.readFileSync(path.resolve(mappingDecisionPath)) : null;
    const decisionBytes = fs.readFileSync(path.resolve(decisionPath));
    const result = verifyNotionBonsaiTaskDispositionReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      taskLinkDecision: JSON.parse(taskLinkDecisionBytes.toString('utf8')),
      taskLinkDecisionSha256: digest(taskLinkDecisionBytes),
      mappingDecision: mappingDecisionBytes ? JSON.parse(mappingDecisionBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingDecisionBytes ? digest(mappingDecisionBytes) : null,
      decision: JSON.parse(decisionBytes.toString('utf8')),
      decisionSha256: digest(decisionBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(briefPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Task disposition review brief is valid with ${result.approvalReady} approval-ready and ${result.manualReview} manual-review candidate(s).\n`
      : `Task disposition review brief is invalid with ${result.findings.length} finding(s).\n`);
    if (!result.valid) process.exitCode = 1;
  } catch {
    process.stderr.write('Task disposition review brief verification failed.\n');
    process.exitCode = 2;
  }
}
