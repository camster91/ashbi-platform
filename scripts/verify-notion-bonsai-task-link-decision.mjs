#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiTaskLinkDecision } from '../src/services/notionBonsaiTaskLinkDecision.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const recordPath = option('--task-link-decision');
const mappingPath = option('--mapping-decision');
if (!reviewPath || !recordPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-task-link-decision -- --review <review.json> --task-link-decision <decision.json> [--mapping-decision <mapping.json>]\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingBytes = mappingPath ? fs.readFileSync(path.resolve(mappingPath)) : null;
    const result = verifyNotionBonsaiTaskLinkDecision({
      review: JSON.parse(reviewBytes.toString('utf8')), reviewSha256: digest(reviewBytes),
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
      mappingDecision: mappingBytes ? JSON.parse(mappingBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingBytes ? digest(mappingBytes) : null,
    });
    process.stdout.write(result.valid
      ? `Task-link decision record is valid with ${result.pending} pending decision(s).\n`
      : `Task-link decision record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Notion/Bonsai task-link decision verification failed.\n');
    process.exitCode = 2;
  }
}
