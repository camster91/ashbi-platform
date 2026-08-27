import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateBonsaiCutoverReadiness } from '../../services/bonsai-cutover-readiness.service.js';
import { buildRevenueEvidenceManifest, REVENUE_EVIDENCE_COLLECTIONS } from '../../services/revenueEvidenceExport.service.js';
import {
  buildWorkspaceExportManifest,
  WORKSPACE_EXPORT_COLLECTIONS,
  WORKSPACE_EXPORT_V3_COLLECTIONS,
} from '../../services/workspace-export-integrity.service.js';

const REQUIRED_ARTIFACTS = [
  'bonsai-source-export',
  'bonsai-clients-csv',
  'bonsai-projects-csv',
  'bonsai-tasks-json',
  'bonsai-time-entries-csv',
  'bonsai-expenses-csv',
  'bonsai-invoices-csv',
  'bonsai-import-dry-run',
  'bonsai-import-confirmed',
  'notion-source-export',
  'notion-import-dry-run',
  'notion-import-confirmed',
  'parallel-reconciliation',
  'operations-reconciliation',
  'tasks-reconciliation',
  'stripe-sandbox',
  'email-sandbox',
  'revenue-evidence-export',
  'workspace-export',
  'database-backup',
  'restore-drill',
  'financial-approval',
];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-cutover-'));
  const bonsaiInvoicesContent = Buffer.from('invoice_number,status,currency,total_amount\nINV-001,paid,CAD,113.00\n');
  const bonsaiClientsContent = Buffer.from('Client,Contact Email\nAcme,owner@acme.ca\n');
  const bonsaiProjectsContent = Buffer.from('project_id,title,client_or_company_name,status\n123,Acme Website,Acme,active\n');
  const bonsaiTasksPayload = {
    format: 'bonsai-task-snapshot', version: 1, scope: 'all', complete: true,
    capturedAt: '2026-08-15T18:15:00.000Z', tasks: [],
  };
  const bonsaiTasksContent = Buffer.from(JSON.stringify(bonsaiTasksPayload));
  const bonsaiTimeEntriesContent = Buffer.from('client_name,project_title,owner_name,date,formatted_time\nAcme,Acme Website,Cameron,2026-08-01,01:00:00\n');
  const bonsaiExpensesContent = Buffer.from('name,amount_after_tax,currency,date\nFigma,20.00,CAD,2026-08-02\n');
  const bonsaiInvoicesSha256 = crypto.createHash('sha256').update(bonsaiInvoicesContent).digest('hex');
  const bonsaiClientsSha256 = crypto.createHash('sha256').update(bonsaiClientsContent).digest('hex');
  const bonsaiProjectsSha256 = crypto.createHash('sha256').update(bonsaiProjectsContent).digest('hex');
  const bonsaiTasksSha256 = crypto.createHash('sha256').update(bonsaiTasksContent).digest('hex');
  const bonsaiTimeEntriesSha256 = crypto.createHash('sha256').update(bonsaiTimeEntriesContent).digest('hex');
  const bonsaiExpensesSha256 = crypto.createHash('sha256').update(bonsaiExpensesContent).digest('hex');
  const emptyRecords = Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [collection, []]));
  const revenueManifest = buildRevenueEvidenceManifest(emptyRecords);
  const revenuePayload = {
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    exportedAt: '2026-08-15T18:00:00.000Z',
    records: emptyRecords,
    manifest: revenueManifest,
  };
  const revenueContent = Buffer.from(JSON.stringify(revenuePayload));
  const revenueArtifactSha256 = crypto.createHash('sha256').update(revenueContent).digest('hex');
  const workspaceRecords = Object.fromEntries(WORKSPACE_EXPORT_V3_COLLECTIONS.map(collection => [collection, []]));
  const workspaceManifest = buildWorkspaceExportManifest(workspaceRecords, { version: 3 });
  const workspacePayload = {
    format: 'ashbi-workspace-export', version: 3, exportedAt: '2026-08-15T18:00:00.000Z',
    organization: { id: 'org-1', name: 'Ashbi', slug: 'ashbi' }, records: workspaceRecords, manifest: workspaceManifest,
  };
  const workspaceContent = Buffer.from(JSON.stringify(workspacePayload));
  const workspaceArtifactSha256 = crypto.createHash('sha256').update(workspaceContent).digest('hex');
  const parallelPayload = {
    format: 'ashbi-parallel-reconciliation',
    version: 1,
    complete: true,
    organizationId: 'org-1',
    completedAt: '2026-08-15T19:00:00.000Z',
    unresolvedFindings: 0,
    currenciesSeparated: true,
    sourceEvidence: { invoicesSha256: bonsaiInvoicesSha256, invoiceRows: 1 },
    revenueEvidence: {
      artifactSha256: revenueArtifactSha256,
      recordsSha256: revenueManifest.recordsSha256,
      collectionCounts: Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(
        collection => [collection, revenueManifest.collections[collection].count],
      )),
    },
  };
  const operationsPayload = {
    format: 'ashbi-bonsai-operations-reconciliation', version: 2, complete: true,
    organizationId: 'org-1', completedAt: '2026-08-15T19:00:00.000Z', unresolvedFindings: 0,
    sourceEvidence: {
      clientsSha256: bonsaiClientsSha256, clientRows: 1,
      projectsSha256: bonsaiProjectsSha256, projectRows: 1,
      timeEntriesSha256: bonsaiTimeEntriesSha256, timeEntryRows: 1,
      expensesSha256: bonsaiExpensesSha256, expenseRows: 1,
    },
    workspaceEvidence: {
      artifactSha256: workspaceArtifactSha256,
      recordsSha256: workspaceManifest.recordsSha256,
      collectionCounts: Object.fromEntries(WORKSPACE_EXPORT_V3_COLLECTIONS.map(
        collection => [collection, workspaceManifest.collections[collection].count],
      )),
    },
  };
  const tasksPayload = {
    format: 'ashbi-bonsai-task-reconciliation', version: 1, complete: true,
    organizationId: 'org-1', completedAt: '2026-08-15T19:00:00.000Z', unresolvedFindings: 0,
    summary: { sourceTasks: 0, hubBonsaiTasks: 0, matchedTasks: 0 }, findings: [],
    sourceEvidence: {
      tasksSha256: bonsaiTasksSha256, taskRows: 0,
      capturedAt: bonsaiTasksPayload.capturedAt, scope: 'all',
    },
    workspaceEvidence: {
      artifactSha256: workspaceArtifactSha256,
      recordsSha256: workspaceManifest.recordsSha256,
      collectionCounts: Object.fromEntries(WORKSPACE_EXPORT_V3_COLLECTIONS.map(
        collection => [collection, workspaceManifest.collections[collection].count],
      )),
    },
  };
  const artifacts = REQUIRED_ARTIFACTS.map((id) => {
    const relativePath = `${id}.json`;
    const content = id === 'revenue-evidence-export'
      ? revenueContent
      : id === 'workspace-export'
        ? workspaceContent
        : id === 'bonsai-clients-csv'
          ? bonsaiClientsContent
          : id === 'bonsai-projects-csv'
            ? bonsaiProjectsContent
            : id === 'bonsai-tasks-json'
              ? bonsaiTasksContent
            : id === 'bonsai-time-entries-csv'
              ? bonsaiTimeEntriesContent
              : id === 'bonsai-expenses-csv'
                ? bonsaiExpensesContent
      : id === 'bonsai-invoices-csv'
        ? bonsaiInvoicesContent
        : Buffer.from(JSON.stringify(id === 'parallel-reconciliation'
          ? parallelPayload
          : id === 'operations-reconciliation'
            ? operationsPayload
            : id === 'tasks-reconciliation'
              ? tasksPayload
            : { id, synthetic: true }));
    fs.writeFileSync(path.join(directory, relativePath), content);
    return { id, path: relativePath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  const manifest = {
    schemaVersion: 1,
    organizationId: 'org-1',
    targetEnvironment: 'hub.ashbi.ca',
    revision: '68be6ed',
    evidenceCompletedAt: '2026-08-15T20:00:00.000Z',
    parallelRun: {
      startedAt: '2026-08-01T12:00:00.000Z',
      endedAt: '2026-08-15T12:00:00.000Z',
      agreedMinimumDays: 14,
      bonsaiAvailable: true,
    },
    reconciliation: {
      recordTypes: ['clients', 'projects', 'tasks', 'proposals', 'contracts', 'invoices', 'payments', 'timeEntries', 'expenses'],
      unresolvedFindings: 0,
      currenciesSeparated: true,
      unresolvedLegacyCurrencyRows: 0,
      unresolvedLegacyPaymentRows: 0,
    },
    providerValidation: {
      stripeSandboxPassed: true,
      emailSandboxPassed: true,
      proposalToPaymentPassed: true,
    },
    recovery: {
      databaseBackupVerified: true,
      workspaceExportVerified: true,
      isolatedRestorePassed: true,
    },
    approval: {
      approver: 'Cameron',
      decision: 'APPROVED',
      scope: 'BONSAI_FINANCIAL_CUTOVER',
      approvedAt: '2026-08-16T12:00:00.000Z',
      reference: 'approval-2026-08-16-bonsai-cutover',
    },
    artifacts,
  };
  return { directory, manifest };
}

test('cutover evaluator passes a complete untampered manifest after the agreed parallel run', () => {
  const { directory, manifest } = fixture();
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, true);
    assert.equal(report.checks.every((check) => check.ok), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects any unresolved reconciliation finding', () => {
  const { directory, manifest } = fixture();
  manifest.reconciliation.unresolvedFindings = 1;
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'zero-discrepancies').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects approval recorded before evidence completion', () => {
  const { directory, manifest } = fixture();
  manifest.approval.approvedAt = '2026-08-14T12:00:00.000Z';
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'financial-approval').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects a placeholder deployment revision', () => {
  const { directory, manifest } = fixture();
  manifest.revision = 'REPLACE_WITH_DEPLOYED_REVISION';
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'target-revision').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects a changed evidence artifact', () => {
  const { directory, manifest } = fixture();
  fs.appendFileSync(path.join(directory, manifest.artifacts[0].path), 'changed');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'artifact-integrity').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator requires internally valid tenant-bound revenue evidence', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'revenue-evidence-export');
  const payload = JSON.parse(fs.readFileSync(path.join(directory, artifact.path), 'utf8'));
  payload.organizationId = 'another-org';
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(path.join(directory, artifact.path), content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'revenue-evidence').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects a missing revenue evidence artifact', () => {
  const { directory, manifest } = fixture();
  manifest.artifacts = manifest.artifacts.filter(item => item.id !== 'revenue-evidence-export');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'artifact-inventory').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator binds parallel reconciliation to the exact revenue export', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'parallel-reconciliation');
  const reportPath = path.join(directory, artifact.path);
  const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  payload.revenueEvidence.recordsSha256 = 'f'.repeat(64);
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(reportPath, content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'parallel-revenue-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator binds parallel reconciliation to the exact Bonsai invoice source', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'parallel-reconciliation');
  const reportPath = path.join(directory, artifact.path);
  const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  payload.sourceEvidence.invoicesSha256 = 'e'.repeat(64);
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(reportPath, content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'parallel-revenue-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator binds operating reconciliation to the exact Bonsai client source', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'operations-reconciliation');
  const reportPath = path.join(directory, artifact.path);
  const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  payload.sourceEvidence.clientsSha256 = 'd'.repeat(64);
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(reportPath, content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'operations-reconciliation-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects legacy workspace evidence that omits time and expenses', () => {
  const { directory, manifest } = fixture();
  const workspaceArtifact = manifest.artifacts.find(item => item.id === 'workspace-export');
  const workspacePath = path.join(directory, workspaceArtifact.path);
  const workspacePayload = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
  workspacePayload.version = 2;
  workspacePayload.records = Object.fromEntries(WORKSPACE_EXPORT_COLLECTIONS.map(
    collection => [collection, workspacePayload.records[collection]],
  ));
  workspacePayload.manifest = buildWorkspaceExportManifest(workspacePayload.records);
  const workspaceContent = Buffer.from(JSON.stringify(workspacePayload));
  fs.writeFileSync(workspacePath, workspaceContent);
  workspaceArtifact.sha256 = crypto.createHash('sha256').update(workspaceContent).digest('hex');

  const operationsArtifact = manifest.artifacts.find(item => item.id === 'operations-reconciliation');
  const operationsPath = path.join(directory, operationsArtifact.path);
  const operationsPayload = JSON.parse(fs.readFileSync(operationsPath, 'utf8'));
  operationsPayload.workspaceEvidence.artifactSha256 = workspaceArtifact.sha256;
  operationsPayload.workspaceEvidence.recordsSha256 = workspacePayload.manifest.recordsSha256;
  operationsPayload.workspaceEvidence.collectionCounts = Object.fromEntries(WORKSPACE_EXPORT_COLLECTIONS.map(
    collection => [collection, workspacePayload.manifest.collections[collection].count],
  ));
  const operationsContent = Buffer.from(JSON.stringify(operationsPayload));
  fs.writeFileSync(operationsPath, operationsContent);
  operationsArtifact.sha256 = crypto.createHash('sha256').update(operationsContent).digest('hex');

  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'operations-reconciliation-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator rejects an operating report that omits time and expense source binding', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'operations-reconciliation');
  const reportPath = path.join(directory, artifact.path);
  const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  payload.version = 1;
  delete payload.sourceEvidence.timeEntriesSha256;
  delete payload.sourceEvidence.timeEntryRows;
  delete payload.sourceEvidence.expensesSha256;
  delete payload.sourceEvidence.expenseRows;
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(reportPath, content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'operations-reconciliation-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator binds task reconciliation to the exact complete Bonsai task snapshot', () => {
  const { directory, manifest } = fixture();
  const artifact = manifest.artifacts.find(item => item.id === 'tasks-reconciliation');
  const reportPath = path.join(directory, artifact.path);
  const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  payload.sourceEvidence.tasksSha256 = 'f'.repeat(64);
  const content = Buffer.from(JSON.stringify(payload));
  fs.writeFileSync(reportPath, content);
  artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'task-reconciliation-binding').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover evaluator never reads evidence outside the manifest directory', () => {
  const { directory, manifest } = fixture();
  manifest.artifacts[0].path = '../outside.json';
  try {
    const report = evaluateBonsaiCutoverReadiness({ manifest, manifestDirectory: directory });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check) => check.id === 'artifact-integrity').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cutover command is read-only and package-addressable', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'check-bonsai-cutover-readiness.mjs'), 'utf8');
  const packageJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
  const migrationRunbook = fs.readFileSync(path.join(process.cwd(), 'docs', 'bonsai-migration.md'), 'utf8');
  const examplePath = path.join(process.cwd(), 'docs', 'bonsai-cutover-manifest.example.json');
  const reconciliationExamplePath = path.join(process.cwd(), 'docs', 'parallel-reconciliation.example.json');
  const operationsExamplePath = path.join(process.cwd(), 'docs', 'operations-reconciliation.example.json');
  const tasksExamplePath = path.join(process.cwd(), 'docs', 'task-reconciliation.example.json');
  assert.doesNotMatch(script, /writeFile|appendFile|rmSync|unlink|fetch\(|prisma|stripe\.|mailgun\./i);
  assert.match(packageJson, /"check:bonsai-cutover": "node scripts\/check-bonsai-cutover-readiness\.mjs"/);
  assert.match(migrationRunbook, /npm run check:bonsai-cutover -- --manifest/);
  assert.equal(fs.existsSync(examplePath), true);
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(example.approval.decision, 'PENDING');
  assert.deepEqual(example.artifacts.map((artifact) => artifact.id), REQUIRED_ARTIFACTS);
  const reconciliationExample = JSON.parse(fs.readFileSync(reconciliationExamplePath, 'utf8'));
  assert.equal(reconciliationExample.format, 'ashbi-parallel-reconciliation');
  assert.deepEqual(Object.keys(reconciliationExample.revenueEvidence.collectionCounts), REVENUE_EVIDENCE_COLLECTIONS);
  const operationsExample = JSON.parse(fs.readFileSync(operationsExamplePath, 'utf8'));
  assert.equal(operationsExample.format, 'ashbi-bonsai-operations-reconciliation');
  assert.deepEqual(Object.keys(operationsExample.workspaceEvidence.collectionCounts), WORKSPACE_EXPORT_V3_COLLECTIONS);
  const tasksExample = JSON.parse(fs.readFileSync(tasksExamplePath, 'utf8'));
  assert.equal(tasksExample.format, 'ashbi-bonsai-task-reconciliation');
  assert.deepEqual(Object.keys(tasksExample.workspaceEvidence.collectionCounts), WORKSPACE_EXPORT_V3_COLLECTIONS);
});
