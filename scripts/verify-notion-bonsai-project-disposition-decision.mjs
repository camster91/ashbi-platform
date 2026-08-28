#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiProjectDispositionDecision } from '../src/services/notionBonsaiProjectDispositionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const linkPath = option('--project-link-decision');
const decisionPath = option('--project-disposition-decision');
if (!reviewPath || !linkPath || !decisionPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-project-disposition-decision -- --review <review.json> --project-link-decision <link-decision.json> --project-disposition-decision <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const linkBytes = fs.readFileSync(path.resolve(linkPath));
    const result = verifyNotionBonsaiProjectDispositionDecision({
      review: JSON.parse(reviewBytes.toString('utf8')), reviewSha256: digest(reviewBytes),
      projectLinkDecision: JSON.parse(linkBytes.toString('utf8')), projectLinkDecisionSha256: digest(linkBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(decisionPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Project disposition record is valid with ${result.pending} pending decision(s).\n`
      : `Project disposition record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Notion/Bonsai project disposition verification failed.\n');
    process.exitCode = 2;
  }
}
