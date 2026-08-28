#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiProjectDispositionReviewBrief } from '../src/services/notionBonsaiProjectDispositionReviewBrief.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readArtifact(filePath) {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return {
    value: JSON.parse(bytes.toString('utf8')),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

const reviewPath = option('--review');
const projectLinkPath = option('--project-link-decision');
const dispositionPath = option('--project-disposition-decision');
const supplementalPath = option('--supplemental-evidence');
const briefPath = option('--review-brief');
const outputPath = option('--output');

if (!reviewPath || !projectLinkPath || !dispositionPath || !briefPath || !outputPath) {
  process.stderr.write('Usage: npm run prepare:project-disposition-migration-review-bundle -- --review <review.json> --project-link-decision <project-link.json> --project-disposition-decision <pending-disposition.json> [--supplemental-evidence <evidence.json>] --review-brief <brief.json> --output <new-bundle.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const review = readArtifact(reviewPath);
    const projectLink = readArtifact(projectLinkPath);
    const disposition = readArtifact(dispositionPath);
    const supplemental = supplementalPath ? readArtifact(supplementalPath) : null;
    const brief = readArtifact(briefPath);
    const verification = verifyNotionBonsaiProjectDispositionReviewBrief({
      review: review.value,
      reviewSha256: review.sha256,
      projectLinkDecision: projectLink.value,
      projectLinkDecisionSha256: projectLink.sha256,
      projectDispositionDecision: disposition.value,
      projectDispositionDecisionSha256: disposition.sha256,
      supplementalEvidence: supplemental?.value ?? null,
      supplementalEvidenceSha256: supplemental?.sha256 ?? null,
      record: brief.value,
    });
    if (!verification.valid) throw new Error('Review evidence is invalid');

    const bundle = {
      format: 'ashbi-hub-project-disposition-review-import',
      version: 1,
      requestId: crypto.randomUUID(),
      review: review.value,
      reviewSha256: review.sha256,
      projectLinkDecision: projectLink.value,
      projectLinkDecisionSha256: projectLink.sha256,
      dispositionDecision: disposition.value,
      dispositionDecisionSha256: disposition.sha256,
      supplementalEvidence: supplemental?.value ?? null,
      supplementalEvidenceSha256: supplemental?.sha256 ?? null,
      reviewBrief: brief.value,
    };
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared a verified ${verification.approvalReady}-ready, ${verification.blocked}-blocked project-disposition Hub review bundle. No decisions or external writes were performed.\n`);
  } catch {
    process.stderr.write('Project-disposition migration review bundle preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
