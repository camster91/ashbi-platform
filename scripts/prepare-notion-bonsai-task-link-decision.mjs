#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiTaskLinkDecision } from '../src/services/notionBonsaiTaskLinkDecision.service.js';

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const decisionsPath = option('--decisions');
const mappingPath = option('--mapping-decision');
const outputPath = option('--output');
const preparedAt = option('--prepared-at');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');
if (!reviewPath || !outputPath || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-task-link-decision -- --review <review.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <json> --mapping-decision <json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording task-link decisions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (mappingPath || confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision or mapping evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingBytes = mappingPath ? fs.readFileSync(path.resolve(mappingPath)) : null;
    const decisionInput = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')) : { decisions: [] };
    const record = prepareNotionBonsaiTaskLinkDecision({
      review: JSON.parse(reviewBytes.toString('utf8')), reviewSha256: digest(reviewBytes), preparedAt,
      decisions: decisionInput.decisions,
      mappingDecision: mappingBytes ? JSON.parse(mappingBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingBytes ? digest(mappingBytes) : null,
      approver, decidedAt, reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.approved + record.summary.rejected} and retained ${record.summary.pending} pending task-link decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai task-link decision preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
