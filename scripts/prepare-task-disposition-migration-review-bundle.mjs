#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiTaskDispositionReviewBrief } from '../src/services/notionBonsaiTaskDispositionReviewBrief.service.js';

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
const taskLinkPath = option('--task-link-decision');
const mappingPath = option('--mapping-decision');
const dispositionPath = option('--task-disposition-decision');
const briefPath = option('--review-brief');
const outputPath = option('--output');

if (!reviewPath || !taskLinkPath || !dispositionPath || !briefPath || !outputPath) {
  process.stderr.write('Usage: npm run prepare:task-disposition-migration-review-bundle -- --review <review.json> --task-link-decision <task-link.json> [--mapping-decision <mapping.json>] --task-disposition-decision <pending-disposition.json> --review-brief <brief.json> --output <new-bundle.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const review = readArtifact(reviewPath);
    const taskLink = readArtifact(taskLinkPath);
    const mapping = mappingPath ? readArtifact(mappingPath) : null;
    const disposition = readArtifact(dispositionPath);
    const brief = readArtifact(briefPath);
    const verification = verifyNotionBonsaiTaskDispositionReviewBrief({
      review: review.value,
      reviewSha256: review.sha256,
      taskLinkDecision: taskLink.value,
      taskLinkDecisionSha256: taskLink.sha256,
      mappingDecision: mapping?.value ?? null,
      mappingDecisionSha256: mapping?.sha256 ?? null,
      decision: disposition.value,
      decisionSha256: disposition.sha256,
      record: brief.value,
    });
    if (!verification.valid) throw new Error('Review evidence is invalid');

    const bundle = {
      format: 'ashbi-hub-task-disposition-review-import',
      version: 1,
      requestId: crypto.randomUUID(),
      review: review.value,
      reviewSha256: review.sha256,
      taskLinkDecision: taskLink.value,
      taskLinkDecisionSha256: taskLink.sha256,
      mappingDecision: mapping?.value ?? null,
      mappingDecisionSha256: mapping?.sha256 ?? null,
      dispositionDecision: disposition.value,
      dispositionDecisionSha256: disposition.sha256,
      reviewBrief: brief.value,
    };
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared a verified ${verification.approvalReady}-candidate task-disposition Hub review bundle. No decisions or external writes were performed.\n`);
  } catch {
    process.stderr.write('Task-disposition migration review bundle preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
