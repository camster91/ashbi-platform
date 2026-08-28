#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiProjectSnapshot } from '../src/services/bonsaiProjectSnapshot.service.js';

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write('Usage: npm run verify:bonsai-project-snapshot -- <bonsai-projects.json>\n');
  process.exitCode = 2;
} else {
  try {
    const report = verifyBonsaiProjectSnapshot(JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.migrationReady ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ valid: false, findings: [{ code: 'SNAPSHOT_READ_FAILED' }] }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
