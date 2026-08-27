#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import csvParser from 'csv-parser';
import { Readable } from 'node:stream';
import { reconcileBonsaiTasks } from '../src/services/bonsaiTaskReconciliation.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function parseCsv(bytes) {
  const rows = [];
  for await (const row of Readable.from(bytes).pipe(csvParser())) rows.push(row);
  return rows;
}

const organizationId = option('--organization-id');
const tasksPath = option('--bonsai-tasks');
const historicalTasksPath = option('--bonsai-task-history');
const projectsPath = option('--bonsai-projects');
const workspacePath = option('--workspace-export');
const completedAt = option('--completed-at');
const outputPath = option('--output');

if (!organizationId || !tasksPath || !historicalTasksPath || !projectsPath || !workspacePath || !completedAt || !outputPath) {
  console.error('Usage: npm run reconcile:bonsai-tasks -- --organization-id <id> --bonsai-tasks <tasks.json> --bonsai-task-history <task-export.csv> --bonsai-projects <projects.csv> --workspace-export <workspace.json> --completed-at <ISO> --output <new-report.json>');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const tasksBytes = fs.readFileSync(path.resolve(tasksPath));
    const historicalTasksBytes = fs.readFileSync(path.resolve(historicalTasksPath));
    const projectsBytes = fs.readFileSync(path.resolve(projectsPath));
    const workspaceBytes = fs.readFileSync(path.resolve(workspacePath));
    const report = reconcileBonsaiTasks({
      organizationId,
      completedAt,
      bonsaiTasksSha256: sha256(tasksBytes),
      bonsaiHistoricalTasksSha256: sha256(historicalTasksBytes),
      bonsaiProjectsSha256: sha256(projectsBytes),
      workspaceArtifactSha256: sha256(workspaceBytes),
      bonsaiTaskSnapshot: JSON.parse(tasksBytes.toString('utf8')),
      bonsaiHistoricalTaskRows: await parseCsv(historicalTasksBytes),
      bonsaiProjectRows: await parseCsv(projectsBytes),
      workspaceExport: JSON.parse(workspaceBytes.toString('utf8')),
    });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(report.complete
      ? 'Task reconciliation passed with zero findings.'
      : `Task reconciliation retained ${report.unresolvedFindings} finding(s) for review.`);
    process.exitCode = report.complete ? 0 : 1;
  } catch (error) {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({
        format: 'ashbi-bonsai-task-reconciliation', version: 1, complete: false,
        reasonCode: 'RECONCILIATION_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    console.error(`Task reconciliation failed: ${error.message}`);
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
