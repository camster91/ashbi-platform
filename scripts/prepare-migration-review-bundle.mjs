#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiNativeProjectLinkReviewBrief } from '../src/services/notionBonsaiNativeProjectLinkReviewBrief.service.js';

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
const mappingPath = option('--mapping-decision');
const supplementalPath = option('--supplemental-evidence');
const briefPath = option('--review-brief');
const outputPath = option('--output');

if (!reviewPath || !mappingPath || !briefPath || !outputPath) {
  process.stderr.write('Usage: npm run prepare:migration-review-bundle -- --review <review.json> --mapping-decision <mapping.json> [--supplemental-evidence <evidence.json>] --review-brief <brief.json> --output <new-bundle.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const review = readArtifact(reviewPath);
    const mapping = readArtifact(mappingPath);
    const supplemental = supplementalPath ? readArtifact(supplementalPath) : null;
    const brief = readArtifact(briefPath);
    const verification = verifyNotionBonsaiNativeProjectLinkReviewBrief({
      review: review.value,
      reviewSha256: review.sha256,
      mappingDecision: mapping.value,
      mappingDecisionSha256: mapping.sha256,
      supplementalEvidence: supplemental?.value ?? null,
      supplementalEvidenceSha256: supplemental?.sha256 ?? null,
      record: brief.value,
    });
    if (!verification.valid) throw new Error('Review evidence is invalid');

    const bundle = {
      format: 'ashbi-hub-migration-review-import',
      version: 1,
      requestId: crypto.randomUUID(),
      review: review.value,
      reviewSha256: review.sha256,
      mappingDecision: mapping.value,
      mappingDecisionSha256: mapping.sha256,
      supplementalEvidence: supplemental?.value ?? null,
      supplementalEvidenceSha256: supplemental?.sha256 ?? null,
      reviewBrief: brief.value,
    };
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared a verified ${verification.approvalReady}-candidate Hub review bundle. No decisions or external writes were performed.\n`);
  } catch {
    process.stderr.write('Migration review bundle preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
