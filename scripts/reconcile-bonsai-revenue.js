#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import csvParser from 'csv-parser';
import { reconcileBonsaiRevenue } from '../src/services/bonsaiRevenueReconciliation.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseCsv(bytes) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(bytes)
      .pipe(csvParser())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

const organizationId = option('--organization-id');
const bonsaiPath = option('--bonsai-invoices');
const revenuePath = option('--revenue-export');
const completedAt = option('--completed-at');
const outputPath = option('--output');

if (!organizationId || !bonsaiPath || !revenuePath || !completedAt || !outputPath) {
  console.error('Usage: npm run reconcile:bonsai-revenue -- --organization-id <id> --bonsai-invoices <invoices.csv> --revenue-export <revenue.json> --completed-at <ISO> --output <new-report.json>');
  process.exitCode = 2;
} else {
  let output;
  try {
    const resolvedOutput = path.resolve(outputPath);
    output = fs.openSync(resolvedOutput, 'wx', 0o600);
    const bonsaiBytes = fs.readFileSync(path.resolve(bonsaiPath));
    const revenueBytes = fs.readFileSync(path.resolve(revenuePath));
    const report = reconcileBonsaiRevenue({
      organizationId,
      completedAt,
      bonsaiInvoicesSha256: sha256(bonsaiBytes),
      revenueArtifactSha256: sha256(revenueBytes),
      bonsaiRows: await parseCsv(bonsaiBytes),
      revenueExport: JSON.parse(revenueBytes.toString('utf8')),
    });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(report.unresolvedFindings === 0
      ? 'Reconciliation passed with zero findings.'
      : `Reconciliation retained ${report.unresolvedFindings} finding(s) for review.`);
    process.exitCode = report.unresolvedFindings === 0 ? 0 : 1;
  } catch (error) {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({
        format: 'ashbi-parallel-reconciliation',
        version: 1,
        complete: false,
        reasonCode: 'RECONCILIATION_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    console.error(`Reconciliation failed: ${error.message}`);
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
