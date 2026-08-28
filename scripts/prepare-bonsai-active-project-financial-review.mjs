#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiActiveProjectFinancialReview } from '../src/services/bonsaiActiveProjectFinancialReview.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
const triagePath = option('--active-project-triage');
const invoicePath = option('--invoice-index');
const timePath = option('--time-entry-index');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!triagePath || !invoicePath || !timePath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:bonsai-active-project-financial-review -- --active-project-triage <triage.json> --invoice-index <invoices.json> --time-entry-index <time.json> --prepared-at <ISO> --output <new-review.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const triageBytes = fs.readFileSync(path.resolve(triagePath));
    const invoiceBytes = fs.readFileSync(path.resolve(invoicePath));
    const timeBytes = fs.readFileSync(path.resolve(timePath));
    const review = prepareBonsaiActiveProjectFinancialReview({
      activeProjectTriage: JSON.parse(triageBytes.toString('utf8')),
      invoiceSnapshot: JSON.parse(invoiceBytes.toString('utf8')),
      timeEntrySnapshot: JSON.parse(timeBytes.toString('utf8')),
      activeProjectTriageSha256: digest(triageBytes),
      invoiceSnapshotSha256: digest(invoiceBytes),
      timeEntrySnapshotSha256: digest(timeBytes),
      preparedAt,
    });
    fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared financial safety evidence for ${review.summary.activeProjects} active project(s) without changing Bonsai.\n`);
  } catch {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({ format: 'ashbi-bonsai-active-project-financial-review', version: 1, complete: false, reasonCode: 'REVIEW_PREPARATION_FAILED' }, null, 2)}\n`, 'utf8');
    }
    process.stderr.write('Bonsai active project financial review preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
