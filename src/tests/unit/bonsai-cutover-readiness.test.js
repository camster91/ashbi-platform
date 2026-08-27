import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateBonsaiCutoverReadiness } from '../../services/bonsai-cutover-readiness.service.js';

const REQUIRED_ARTIFACTS = [
  'bonsai-source-export',
  'bonsai-import-dry-run',
  'bonsai-import-confirmed',
  'notion-source-export',
  'notion-import-dry-run',
  'notion-import-confirmed',
  'parallel-reconciliation',
  'stripe-sandbox',
  'email-sandbox',
  'workspace-export',
  'database-backup',
  'restore-drill',
  'financial-approval',
];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-cutover-'));
  const artifacts = REQUIRED_ARTIFACTS.map((id) => {
    const relativePath = `${id}.json`;
    const content = Buffer.from(JSON.stringify({ id, synthetic: true }));
    fs.writeFileSync(path.join(directory, relativePath), content);
    return { id, path: relativePath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  const manifest = {
    schemaVersion: 1,
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
  assert.doesNotMatch(script, /writeFile|appendFile|rmSync|unlink|fetch\(|prisma|stripe\.|mailgun\./i);
  assert.match(packageJson, /"check:bonsai-cutover": "node scripts\/check-bonsai-cutover-readiness\.mjs"/);
  assert.match(migrationRunbook, /npm run check:bonsai-cutover -- --manifest/);
  assert.equal(fs.existsSync(examplePath), true);
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(example.approval.decision, 'PENDING');
  assert.deepEqual(example.artifacts.map((artifact) => artifact.id), REQUIRED_ARTIFACTS);
});
