#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { reconcileBonsaiTasks } from '../src/services/bonsaiTaskReconciliation.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const organizationId = option('--organization-id');
const tasksPath = option('--bonsai-tasks');
const workspacePath = option('--workspace-export');
const completedAt = option('--completed-at');
const outputPath = option('--output');

if (!organizationId || !tasksPath || !workspacePath || !completedAt || !outputPath) {
  console.error('Usage: npm run reconcile:bonsai-tasks -- --organization-id <id> --bonsai-tasks <tasks.json> --workspace-export <workspace.json> --completed-at <ISO> --output <new-report.json>');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const tasksBytes = fs.readFileSync(path.resolve(tasksPath));
    const workspaceBytes = fs.readFileSync(path.resolve(workspacePath));
    const report = reconcileBonsaiTasks({
      organizationId,
      completedAt,
      bonsaiTasksSha256: sha256(tasksBytes),
      workspaceArtifactSha256: sha256(workspaceBytes),
      bonsaiTaskSnapshot: JSON.parse(tasksBytes.toString('utf8')),
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
