#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiMappingDecision } from '../src/services/notionBonsaiMappingDecision.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const reviewPath = option('--review');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');
const decisionsPath = option('--decisions');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');

if (!reviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-mapping-decision -- --review <review.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording mapping decisions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const decisions = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')).decisions : [];
    const record = prepareNotionBonsaiMappingDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      preparedAt,
      decisions,
      approver,
      decidedAt,
      reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.approved + record.summary.rejected} and retained ${record.summary.pending} pending mapping decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai mapping decision preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
