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
const approveAll = process.argv.includes('--approve-all');
const rejectAll = process.argv.includes('--reject-all');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');

if (!reviewPath || !preparedAt || !outputPath || (approveAll && rejectAll)) {
  process.stderr.write('Usage: npm run prepare:notion-bonsai-mapping-decision -- --review <review.json> --prepared-at <ISO> --output <new-decision.json> [--approve-all|--reject-all --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if ((approveAll || rejectAll) && !confirm) {
  process.stderr.write('A finalized mapping decision requires --confirm.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const record = prepareNotionBonsaiMappingDecision({
      review: JSON.parse(reviewBytes.toString('utf8')),
      reviewSha256: digest(reviewBytes),
      preparedAt,
      decision: approveAll ? 'APPROVED' : rejectAll ? 'REJECTED' : 'PENDING',
      approver,
      decidedAt,
      reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(record.complete
      ? `Recorded ${record.summary.total} finalized mapping decision(s) without applying them.\n`
      : `Prepared ${record.summary.pending} pending mapping decision(s) without applying them.\n`);
  } catch {
    process.stderr.write('Notion/Bonsai mapping decision preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
