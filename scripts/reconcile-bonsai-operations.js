#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import csvParser from 'csv-parser';
import { reconcileBonsaiOperations } from '../src/services/bonsaiOperationsReconciliation.service.js';

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
const clientsPath = option('--bonsai-clients');
const connectionsPath = option('--bonsai-connections');
const invoicesPath = option('--bonsai-invoices');
const projectsPath = option('--bonsai-projects');
const timeEntriesPath = option('--bonsai-time-entries');
const expensesPath = option('--bonsai-expenses');
const workspacePath = option('--workspace-export');
const completedAt = option('--completed-at');
const outputPath = option('--output');

if (!organizationId || (!clientsPath && !connectionsPath) || (clientsPath && connectionsPath)
  || !projectsPath || !workspacePath || !completedAt || !outputPath || (connectionsPath && !invoicesPath)) {
  console.error('Usage: npm run reconcile:bonsai-operations -- --organization-id <id> (--bonsai-connections <connections.csv> --bonsai-invoices <invoices.csv> | --bonsai-clients <legacy-clients.csv>) --bonsai-projects <projects.csv> [--bonsai-time-entries <time-entries.csv> --bonsai-expenses <expenses.csv>] --workspace-export <workspace.json> --completed-at <ISO> --output <new-report.json>');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const clientsBytes = clientsPath ? fs.readFileSync(path.resolve(clientsPath)) : null;
    const connectionsBytes = connectionsPath ? fs.readFileSync(path.resolve(connectionsPath)) : null;
    const invoicesBytes = invoicesPath ? fs.readFileSync(path.resolve(invoicesPath)) : null;
    const projectsBytes = fs.readFileSync(path.resolve(projectsPath));
    const workspaceBytes = fs.readFileSync(path.resolve(workspacePath));
    const workspaceExport = JSON.parse(workspaceBytes.toString('utf8'));
    if (workspaceExport.version === 3 && (!timeEntriesPath || !expensesPath)) {
      throw new TypeError('Version 3 reconciliation requires --bonsai-time-entries and --bonsai-expenses');
    }
    const timeEntriesBytes = timeEntriesPath ? fs.readFileSync(path.resolve(timeEntriesPath)) : null;
    const expensesBytes = expensesPath ? fs.readFileSync(path.resolve(expensesPath)) : null;
    const report = reconcileBonsaiOperations({
      organizationId,
      completedAt,
      bonsaiClientsSha256: clientsBytes ? sha256(clientsBytes) : undefined,
      bonsaiConnectionsSha256: connectionsBytes ? sha256(connectionsBytes) : undefined,
      bonsaiConnectionInvoicesSha256: invoicesBytes ? sha256(invoicesBytes) : undefined,
      bonsaiProjectsSha256: sha256(projectsBytes),
      bonsaiTimeEntriesSha256: timeEntriesBytes ? sha256(timeEntriesBytes) : undefined,
      bonsaiExpensesSha256: expensesBytes ? sha256(expensesBytes) : undefined,
      workspaceArtifactSha256: sha256(workspaceBytes),
      bonsaiClientRows: clientsBytes ? await parseCsv(clientsBytes) : undefined,
      bonsaiConnectionRows: connectionsBytes ? await parseCsv(connectionsBytes) : undefined,
      bonsaiInvoiceRows: invoicesBytes ? await parseCsv(invoicesBytes) : undefined,
      bonsaiProjectRows: await parseCsv(projectsBytes),
      bonsaiTimeEntryRows: timeEntriesBytes ? await parseCsv(timeEntriesBytes) : undefined,
      bonsaiExpenseRows: expensesBytes ? await parseCsv(expensesBytes) : undefined,
      workspaceExport,
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
        format: 'ashbi-bonsai-operations-reconciliation', version: 1, complete: false,
        reasonCode: 'RECONCILIATION_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    console.error(`Reconciliation failed: ${error.message}`);
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
