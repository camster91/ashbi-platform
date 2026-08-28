#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiFinancialIndexSnapshots } from '../src/services/bonsaiFinancialIndexSnapshot.service.js';

const invoicePath = process.argv[2];
const timePath = process.argv[3];
if (!invoicePath || !timePath) {
  process.stderr.write('Usage: npm run verify:bonsai-financial-index -- <invoice-index.json> <time-entry-index.json>\n');
  process.exitCode = 2;
} else {
  try {
    const report = verifyBonsaiFinancialIndexSnapshots(
      JSON.parse(fs.readFileSync(path.resolve(invoicePath), 'utf8')),
      JSON.parse(fs.readFileSync(path.resolve(timePath), 'utf8')),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.valid ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ valid: false, findings: [{ code: 'SNAPSHOT_READ_FAILED' }] }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
