import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateUnifiedLaunchReadiness } from '../../services/unifiedLaunchReadiness.service.js';

const passingBonsai = { ready: true, checks: [{ id: 'all', ok: true }] };
const organizationId = 'org-sandbox';

function evaluate(options) {
  return evaluateUnifiedLaunchReadiness({ ...options, bonsaiCutoverOrganizationId: organizationId });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-unified-launch-'));
  const strategy = {
    format: 'ashbi-strategy-approval', version: 1, complete: true, strategyVersion: '2026-01-01',
    decisions: {
      companyCharter: 'APPROVED', ownershipCharter: 'APPROVED',
      serviceCatalogue: 'APPROVED', messagingMatrix: 'APPROVED',
    },
    approvals: [
      { approver: 'Cameron', decision: 'APPROVED', approvedAt: '2026-01-02T12:00:00.000Z' },
      { approver: 'Bianca', decision: 'APPROVED', approvedAt: '2026-01-02T12:05:00.000Z' },
    ],
  };
  const deployment = (application, url, revision) => ({
    format: 'ashbi-deployment-evidence', version: 1, complete: true, application, url,
    revision, rollbackRevision: '1234567', strategyVersion: strategy.strategyVersion,
    smokePassed: true, rollbackVerified: true, verifiedAt: '2026-03-09T10:00:00.000Z',
  });
  const publicDeployment = deployment('ashbi.ca', 'https://ashbi.ca', 'abcdef1');
  const hubDeployment = deployment('hub.ashbi.ca', 'https://hub.ashbi.ca', 'abcdef2');
  const journey = {
    format: 'ashbi-controlled-journey-evidence', version: 2, complete: true,
    organizationId,
    environmentKind: 'sandbox', publicSiteRevision: publicDeployment.revision,
    hubRevision: hubDeployment.revision, currency: 'CAD', stripeMode: 'test', emailMode: 'sandbox',
    reconciliationPassed: true, duplicateWrites: 0, manualDatabaseCorrections: 0,
    providerEvidence: {
      stripeLivemode: false, paymentSettlementStatus: 'VERIFIED',
      emailProvider: 'MAILGUN', emailLifecycleStatus: 'RECIPIENT_SERVER_ACCEPTED',
      acceptedEmailDeliveries: 1,
    },
    sandboxReadinessChecks: [{ id: 'sandbox-flag', ok: true }],
    attestations: {
      noManualDatabaseCorrections: true, attestedBy: 'Cameron', reference: 'sandbox-run-2026-03',
    },
    completedAt: '2026-03-09T15:00:00.000Z',
    generatedAt: '2026-03-09T15:05:00.000Z',
    recordIds: Object.fromEntries(
      ['lead', 'client', 'opportunity', 'proposal', 'contract', 'project', 'task', 'invoice', 'payment', 'report']
        .map(key => [key, `${key}-synthetic`]),
    ),
  };
  const growth = {
    format: 'ashbi-growth-cadence-evidence', version: 1, complete: true,
    organizationId,
    baseline: {
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-02-01T00:00:00.000Z',
      sourceCoverageReviewed: true, currenciesSeparated: true, missingAttributionDisclosed: true,
    },
    weeklyReviews: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((weekStart, index) => ({
      weekStart, actionTaskId: `growth-task-${index}`, ownerId: 'owner-synthetic',
      dueDate: `${weekStart}T17:00:00.000Z`, completedAt: `${weekStart}T18:00:00.000Z`,
    })),
  };
  const notionBase = {
    format: 'ashbi-notion-markdown-import-report', version: 3, complete: true,
    generatedAt: '2026-03-08T12:00:00.000Z', organization: { id: 'org-sandbox' },
    project: { id: 'project-sandbox' }, sourceFingerprint: 'a'.repeat(64),
    planFingerprint: 'b'.repeat(64), errors: [],
  };
  const notionConfirmed = { ...notionBase, mode: 'live', notes: { planned: 4, conflicts: 0, skipped: 0 } };
  const notionRerun = { ...notionBase, mode: 'dry-run', notes: { planned: 0, conflicts: 0, skipped: 0 } };
  const approval = {
    format: 'ashbi-unified-launch-approval', version: 1, decision: 'APPROVED',
    scope: 'UNIFIED_PLATFORM_PUBLIC_LAUNCH', approver: 'Cameron',
    approvedAt: '2026-03-11T12:00:00.000Z', reference: 'approval-synthetic',
  };
  const payloads = {
    'strategy-approval': strategy,
    'ashbi-ca-deployment': publicDeployment,
    'hub-deployment': hubDeployment,
    'controlled-journey': journey,
    'growth-cadence': growth,
    'notion-confirmed-import': notionConfirmed,
    'notion-idempotent-rerun': notionRerun,
    'bonsai-cutover-manifest': {},
    'final-launch-approval': approval,
  };
  const artifacts = Object.entries(payloads).map(([id, payload]) => {
    const content = Buffer.from(JSON.stringify(payload));
    const relativePath = `${id}.json`;
    fs.writeFileSync(path.join(directory, relativePath), content);
    return { id, path: relativePath, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  const manifest = { schemaVersion: 1, organizationId, evidenceCompletedAt: '2026-03-10T12:00:00.000Z', artifacts };
  function replace(id, payload) {
    const artifact = artifacts.find(item => item.id === id);
    const content = Buffer.from(JSON.stringify(payload));
    fs.writeFileSync(path.join(directory, artifact.path), content);
    artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  }
  return { directory, manifest, payloads, replace };
}

test('unified launch evaluator passes only the complete evidence-bound company journey', () => {
  const { directory, manifest } = fixture();
  try {
    const report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
    assert.equal(report.ready, true);
    assert.equal(report.checks.length, 10);
    assert.equal(report.checks.every(item => item.ok), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unified launch evaluator rejects missing partner strategy approval', () => {
  const { directory, manifest, payloads, replace } = fixture();
  payloads['strategy-approval'].approvals = payloads['strategy-approval'].approvals.slice(0, 1);
  replace('strategy-approval', payloads['strategy-approval']);
  try {
    const report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find(item => item.id === 'strategy-approval').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unified launch evaluator independently rejects journey, Notion, Bonsai, growth, and final approval gaps', () => {
  const cases = [
    ['controlled-journey', payload => { payload.duplicateWrites = 1; }, 'controlled-journey', passingBonsai],
    ['controlled-journey', payload => { delete payload.recordIds.task; }, 'controlled-journey', passingBonsai],
    ['controlled-journey', payload => { delete payload.recordIds.report; }, 'controlled-journey', passingBonsai],
    ['controlled-journey', payload => { payload.completedAt = '2026-03-08T15:00:00.000Z'; }, 'controlled-journey', passingBonsai],
    ['notion-idempotent-rerun', payload => { payload.notes.planned = 1; }, 'notion-migration', passingBonsai],
    ['growth-cadence', payload => { payload.weeklyReviews.pop(); }, 'growth-cadence', passingBonsai],
    ['growth-cadence', payload => { payload.weeklyReviews[0].dueDate = '2026-01-12T17:00:00.000Z'; }, 'growth-cadence', passingBonsai],
    ['final-launch-approval', payload => { payload.approvedAt = '2026-03-01T00:00:00.000Z'; }, 'final-launch-approval', passingBonsai],
    [null, () => {}, 'bonsai-cutover', { ready: false, checks: [{ id: 'blocked', ok: false }] }],
  ];
  for (const [artifactId, mutate, checkId, bonsaiCutoverReport] of cases) {
    const { directory, manifest, payloads, replace } = fixture();
    try {
      if (artifactId) {
        mutate(payloads[artifactId]);
        replace(artifactId, payloads[artifactId]);
      }
      const report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport });
      assert.equal(report.ready, false, checkId);
      assert.equal(report.checks.find(item => item.id === checkId).ok, false, checkId);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('unified launch evaluator rejects evidence from a different organization at every tenant-bound gate', () => {
  const cases = [
    ['controlled-journey', payload => { payload.organizationId = 'org-other'; }, 'controlled-journey'],
    ['growth-cadence', payload => { payload.organizationId = 'org-other'; }, 'growth-cadence'],
    ['notion-confirmed-import', payload => { payload.organization.id = 'org-other'; }, 'notion-migration'],
  ];
  for (const [artifactId, mutate, checkId] of cases) {
    const { directory, manifest, payloads, replace } = fixture();
    try {
      mutate(payloads[artifactId]);
      replace(artifactId, payloads[artifactId]);
      const report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
      assert.equal(report.ready, false, checkId);
      assert.equal(report.checks.find(item => item.id === checkId).ok, false, checkId);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  const { directory, manifest } = fixture();
  try {
    const report = evaluateUnifiedLaunchReadiness({
      manifest,
      manifestDirectory: directory,
      bonsaiCutoverReport: passingBonsai,
      bonsaiCutoverOrganizationId: 'org-other',
    });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find(item => item.id === 'bonsai-cutover').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unified launch evaluator rejects changed and escaping artifacts', () => {
  const { directory, manifest } = fixture();
  try {
    fs.appendFileSync(path.join(directory, manifest.artifacts[0].path), 'changed');
    let report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
    assert.equal(report.checks.find(item => item.id === 'artifact-integrity').ok, false);
    manifest.artifacts[0].path = '../outside.json';
    report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
    assert.equal(report.checks.find(item => item.id === 'artifact-integrity').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unified launch evaluator rejects a checksum-valid symlink that escapes the evidence directory', () => {
  const { directory, manifest } = fixture();
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-unified-outside-'));
  try {
    const artifact = manifest.artifacts.find(item => item.id === 'final-launch-approval');
    const target = path.join(directory, artifact.path);
    const outside = path.join(outsideDirectory, 'approval.json');
    const content = Buffer.from(JSON.stringify({ approved: true }));
    fs.writeFileSync(outside, content);
    fs.rmSync(target);
    fs.symlinkSync(outside, target, 'file');
    artifact.sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const report = evaluate({ manifest, manifestDirectory: directory, bonsaiCutoverReport: passingBonsai });
    assert.equal(report.checks.find(item => item.id === 'artifact-integrity').ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test('unified launch command evaluates the actual nested Bonsai manifest and is package-addressable', () => {
  const { directory, manifest } = fixture();
  try {
    const manifestPath = path.join(directory, 'unified-launch.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [
      'scripts/check-unified-launch-readiness.mjs', '--manifest', manifestPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find(item => item.id === 'bonsai-cutover').ok, false);
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['check:unified-launch'], 'node scripts/check-unified-launch-readiness.mjs');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
