#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiNativeProjectLinkDecision } from '../src/services/notionBonsaiNativeProjectLinkDecision.service.js';

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const [reviewPath, recordPath] = process.argv.slice(2);
if (!reviewPath || !recordPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-native-project-link-decision -- <review.json> <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const result = verifyNotionBonsaiNativeProjectLinkDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Native project-link decision record is valid with ${result.pending} pending decision(s).\n`
      : `Native project-link decision record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Native project-link decision verification failed.\n');
    process.exitCode = 2;
  }
}
