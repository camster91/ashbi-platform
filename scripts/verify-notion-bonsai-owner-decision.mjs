#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiOwnerDecision } from '../src/services/notionBonsaiOwnerDecision.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const reviewPath = option('--review');
const recordPath = option('--owner-decision');
const mappingPath = option('--mapping-decision');
if (!reviewPath || !recordPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-owner-decision -- --review <review.json> --owner-decision <owner.json> [--mapping-decision <approved.json>]\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingBytes = mappingPath ? fs.readFileSync(path.resolve(mappingPath)) : null;
    const result = verifyNotionBonsaiOwnerDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
      mappingDecisionRecord: mappingBytes ? JSON.parse(mappingBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingBytes ? digest(mappingBytes) : null,
    });
    process.stdout.write(result.valid
      ? `Owner decision record is valid with ${result.pending} pending decision(s).\n`
      : `Owner decision record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Owner decision verification failed.\n');
    process.exitCode = 2;
  }
}
