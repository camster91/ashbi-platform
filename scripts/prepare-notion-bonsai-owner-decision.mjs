#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionBonsaiOwnerDecision } from '../src/services/notionBonsaiOwnerDecision.service.js';

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
const mappingPath = option('--mapping-decision');
const taskLinkPath = option('--task-link-decision');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');

if (!reviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-owner-decision -- --review <review.json> --prepared-at <ISO> --output <new-owner-decision.json> [--decisions <json> --mapping-decision <approved.json> --task-link-decision <approved.json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording owner decisions requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || mappingPath || taskLinkPath || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingBytes = mappingPath ? fs.readFileSync(path.resolve(mappingPath)) : null;
    const taskLinkBytes = taskLinkPath ? fs.readFileSync(path.resolve(taskLinkPath)) : null;
    const decisions = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')).decisions : [];
    const record = prepareNotionBonsaiOwnerDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      preparedAt,
      decisions,
      mappingDecisionRecord: mappingBytes ? JSON.parse(mappingBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingBytes ? digest(mappingBytes) : null,
      taskLinkDecisionRecord: taskLinkBytes ? JSON.parse(taskLinkBytes.toString('utf8')) : null,
      taskLinkDecisionSha256: taskLinkBytes ? digest(taskLinkBytes) : null,
      approver,
      decidedAt,
      reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.approved + record.summary.rejected} and retained ${record.summary.pending} pending source-backed owner decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai owner decision preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
