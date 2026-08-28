#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../src/services/notionBonsaiNativeProjectLinkDecision.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const reviewPath = option('--review');
const decisionsPath = option('--decisions');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');

if (!reviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-native-project-link-decision -- --review <review.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <decisions.json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording project-link decisions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const decisionInput = decisionsPath
      ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8'))
      : { decisions: [] };
    const record = prepareNotionBonsaiNativeProjectLinkDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      preparedAt,
      decisions: decisionInput.decisions,
      approver,
      decidedAt,
      reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.approved + record.summary.rejected} and retained ${record.summary.pending} pending project-link decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Native Notion/Bonsai project-link decision preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
