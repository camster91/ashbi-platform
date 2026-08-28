#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionBonsaiTaskDispositionDecision } from '../src/services/notionBonsaiTaskDispositionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const taskLinkDecisionPath = option('--task-link-decision');
const mappingDecisionPath = option('--mapping-decision');
const recordPath = option('--task-disposition-decision');
if (!reviewPath || !taskLinkDecisionPath || !recordPath) {
  process.stderr.write('Usage: npm run verify:notion-bonsai-task-disposition-decision -- --review <review.json> --task-link-decision <task-link-decision.json> [--mapping-decision <mapping-decision.json>] --task-disposition-decision <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const taskLinkDecisionBytes = fs.readFileSync(path.resolve(taskLinkDecisionPath));
    const mappingDecisionBytes = mappingDecisionPath ? fs.readFileSync(path.resolve(mappingDecisionPath)) : null;
    const result = verifyNotionBonsaiTaskDispositionDecision({
      review: JSON.parse(reviewBytes.toString('utf8')), reviewSha256: digest(reviewBytes),
      taskLinkDecision: JSON.parse(taskLinkDecisionBytes.toString('utf8')),
      taskLinkDecisionSha256: digest(taskLinkDecisionBytes),
      mappingDecision: mappingDecisionBytes ? JSON.parse(mappingDecisionBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingDecisionBytes ? digest(mappingDecisionBytes) : null,
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Task disposition record is valid with ${result.pending} pending decision(s).\n`
      : `Task disposition record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Notion/Bonsai task disposition verification failed.\n');
    process.exitCode = 2;
  }
}
