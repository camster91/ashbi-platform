#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compareNotionBonsaiTasks } from '../src/services/notionBonsaiTaskComparison.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const notionPath = option('--notion');
const bonsaiPath = option('--bonsai');
const completedAt = option('--completed-at');
const outputPath = option('--output');
if (!notionPath || !bonsaiPath || !completedAt || !outputPath) {
  process.stderr.write('Usage: npm run compare:notion-bonsai-tasks -- --notion <notion.json> --bonsai <bonsai.json> --completed-at <ISO> --output <new-report.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const notionBytes = fs.readFileSync(path.resolve(notionPath));
    const bonsaiBytes = fs.readFileSync(path.resolve(bonsaiPath));
    const report = compareNotionBonsaiTasks({
      notionSnapshot: JSON.parse(notionBytes.toString('utf8')),
      bonsaiSnapshot: JSON.parse(bonsaiBytes.toString('utf8')),
      notionSnapshotSha256: digest(notionBytes),
      bonsaiSnapshotSha256: digest(bonsaiBytes),
      completedAt,
    });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(report.complete
      ? 'Notion/Bonsai task comparison passed with zero findings.\n'
      : `Notion/Bonsai task comparison retained ${report.summary.unresolvedFindings} finding(s).\n`);
    process.exitCode = report.complete ? 0 : 1;
  } catch {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({
        format: 'ashbi-notion-bonsai-task-comparison',
        version: 1,
        complete: false,
        reasonCode: 'COMPARISON_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    process.stderr.write('Notion/Bonsai task comparison failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
