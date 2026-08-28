#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiTaskDispositionDecision } from '../src/services/notionBonsaiTaskDispositionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const reviewPath = option('--review');
const decisionsPath = option('--decisions');
const outputPath = option('--output');
const preparedAt = option('--prepared-at');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');
if (!reviewPath || !outputPath || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-task-disposition-decision -- --review <review.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording task dispositions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const input = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')) : { decisions: [] };
    const record = prepareNotionBonsaiTaskDispositionDecision({
      review: JSON.parse(reviewBytes.toString('utf8')), reviewSha256: digest(reviewBytes), preparedAt,
      decisions: input.decisions, approver, decidedAt, reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.decided} and retained ${record.summary.pending} pending task disposition(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai task disposition preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
