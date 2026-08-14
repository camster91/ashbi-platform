#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import csvParser from 'csv-parser';
import { buildClickUpTaskImportPlan } from '../src/services/clickup-import-plan.service.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const input = option('--input');
const summaryFile = option('--summary-file');
if (!input || !summaryFile || process.argv.includes('--confirm')) {
  console.error('Usage: node scripts/import-clickup-tasks.js --input <tasks.csv> --summary-file <new-report.json>');
  console.error('This is dry-run only. Live ClickUp writes are intentionally not implemented.');
  process.exit(2);
}

const rows = [];
fs.createReadStream(path.resolve(input))
  .pipe(csvParser())
  .on('data', (row) => rows.push(row))
  .on('error', (error) => { console.error(`ClickUp CSV could not be read: ${error.message}`); process.exitCode = 1; })
  .on('end', () => {
    const plan = buildClickUpTaskImportPlan(rows);
    const report = { format: 'ashbi-clickup-task-import-report', version: 1, mode: 'dry-run', generatedAt: new Date().toISOString(), input: { file: path.resolve(input), rows: rows.length }, summary: { planned: plan.tasks.length, errors: plan.errors.length, complete: plan.complete }, tasks: plan.tasks, errors: plan.errors };
    const target = path.resolve(summaryFile);
    try { fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); fs.chmodSync(target, 0o600); }
    catch (error) { console.error(`Report could not be written: ${error.message}`); process.exitCode = 1; return; }
    console.log(JSON.stringify(report, null, 2));
    if (!plan.complete) process.exitCode = 1;
  });
