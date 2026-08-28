#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyNotionOperatingSnapshot } from '../src/services/notionOperatingSnapshot.service.js';

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write('Usage: npm run verify:notion-operating-snapshot -- <notion-projects-tasks.json>\n');
  process.exitCode = 2;
} else {
  try {
    const bytes = fs.readFileSync(path.resolve(inputPath));
    const report = verifyNotionOperatingSnapshot(JSON.parse(bytes.toString('utf8')));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.valid ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify({
      valid: false,
      findings: [{ code: 'SNAPSHOT_READ_FAILED' }],
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
