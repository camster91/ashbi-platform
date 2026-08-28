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
const approveAll = process.argv.includes('--approve-all');
const confirm = process.argv.includes('--confirm');
const mappingPath = option('--mapping-decision');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');

if (!reviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-owner-decision -- --review <review.json> --prepared-at <ISO> --output <new-owner-decision.json> [--approve-all --mapping-decision <approved.json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (approveAll && !confirm) {
  process.stderr.write('A finalized owner decision requires --confirm.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const mappingBytes = mappingPath ? fs.readFileSync(path.resolve(mappingPath)) : null;
    const record = prepareNotionBonsaiOwnerDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      preparedAt,
      decision: approveAll ? 'APPROVED' : 'PENDING',
      mappingDecisionRecord: mappingBytes ? JSON.parse(mappingBytes.toString('utf8')) : null,
      mappingDecisionSha256: mappingBytes ? digest(mappingBytes) : null,
      approver,
      decidedAt,
      reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(record.complete
      ? `Recorded ${record.summary.approved} source-backed owner approval(s) without applying them.\n`
      : `Prepared ${record.summary.pending} pending source-backed owner decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai owner decision preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
