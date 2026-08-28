#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiProjectDispositionReviewBrief } from '../src/services/notionBonsaiProjectDispositionReviewBrief.service.js';

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const [reviewPath, linkPath, dispositionPath, briefPath, supplementalEvidencePath] = process.argv.slice(2);
if (!reviewPath || !linkPath || !dispositionPath || !briefPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-project-disposition-review-brief -- <review.json> <link-decision.json> <pending-disposition.json> <brief.json> [live-evidence.json]\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const linkBytes = fs.readFileSync(path.resolve(linkPath));
    const dispositionBytes = fs.readFileSync(path.resolve(dispositionPath));
    const supplementalEvidenceBytes = supplementalEvidencePath
      ? fs.readFileSync(path.resolve(supplementalEvidencePath))
      : null;
    const result = verifyNotionBonsaiProjectDispositionReviewBrief({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      projectLinkDecision: JSON.parse(linkBytes.toString('utf8')),
      projectLinkDecisionSha256: digest(linkBytes),
      projectDispositionDecision: JSON.parse(dispositionBytes.toString('utf8')),
      projectDispositionDecisionSha256: digest(dispositionBytes),
      supplementalEvidence: supplementalEvidenceBytes
        ? JSON.parse(supplementalEvidenceBytes.toString('utf8'))
        : null,
      supplementalEvidenceSha256: supplementalEvidenceBytes ? digest(supplementalEvidenceBytes) : null,
      record: JSON.parse(fs.readFileSync(path.resolve(briefPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Project disposition review brief is valid with ${result.approvalReady} approval-ready, ${result.blocked} blocked, and ${result.manualReview} manual-review candidate(s).\n`
      : `Project disposition review brief is invalid with ${result.findings.length} finding(s).\n`);
    if (!result.valid) process.exitCode = 1;
  } catch {
    process.stderr.write('Project disposition review brief verification failed.\n');
    process.exitCode = 2;
  }
}
