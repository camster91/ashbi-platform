#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiMappingDecision } from '../src/services/notionBonsaiMappingDecision.service.js';

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const [reviewPath, recordPath] = process.argv.slice(2);
if (!reviewPath || !recordPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-mapping-decision -- <review.json> <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const result = verifyNotionBonsaiMappingDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Mapping decision record is valid with ${result.pending} pending decision(s).\n`
      : `Mapping decision record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Mapping decision verification failed.\n');
    process.exitCode = 2;
  }
}
