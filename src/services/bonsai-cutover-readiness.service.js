import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_RECORD_TYPES = [
  'clients',
  'projects',
  'tasks',
  'proposals',
  'contracts',
  'invoices',
  'payments',
  'timeEntries',
  'expenses',
];

const REQUIRED_ARTIFACT_IDS = [
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

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function timestamp(value) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function artifactInventoryIsComplete(artifacts) {
  if (!Array.isArray(artifacts)) return false;
  const ids = artifacts.map((artifact) => artifact?.id);
  return new Set(ids).size === ids.length
    && REQUIRED_ARTIFACT_IDS.every((id) => ids.includes(id));
}

function artifactsAreIntact(artifacts, manifestDirectory) {
  if (!artifactInventoryIsComplete(artifacts) || !manifestDirectory) return false;
  const root = path.resolve(manifestDirectory);
  return REQUIRED_ARTIFACT_IDS.every((id) => {
    const artifact = artifacts.find((item) => item.id === id);
    if (!artifact || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 ?? ''))) return false;
    const artifactPath = path.resolve(root, String(artifact.path ?? ''));
    if (artifactPath !== root && !artifactPath.startsWith(`${root}${path.sep}`)) return false;
    try {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
      return digest === artifact.sha256.toLowerCase();
    } catch {
      return false;
    }
  });
}

export function evaluateBonsaiCutoverReadiness({ manifest = {}, manifestDirectory } = {}) {
  const parallel = manifest.parallelRun ?? {};
  const reconciliation = manifest.reconciliation ?? {};
  const providers = manifest.providerValidation ?? {};
  const recovery = manifest.recovery ?? {};
  const approval = manifest.approval ?? {};
  const startedAt = timestamp(parallel.startedAt);
  const endedAt = timestamp(parallel.endedAt);
  const evidenceCompletedAt = timestamp(manifest.evidenceCompletedAt);
  const approvedAt = timestamp(approval.approvedAt);
  const minimumDays = Number(parallel.agreedMinimumDays);
  const actualDuration = startedAt !== null && endedAt !== null ? endedAt - startedAt : -1;
  const recordTypes = new Set(Array.isArray(reconciliation.recordTypes) ? reconciliation.recordTypes : []);
  const approvalReference = String(approval.reference ?? '').trim().toLowerCase();

  const checks = [
    check('schema-version', manifest.schemaVersion === 1, 'The manifest schema is supported.', 'Use the supported cutover manifest schema.'),
    check(
      'target-revision',
      manifest.targetEnvironment === 'hub.ashbi.ca' && /^[a-f0-9]{7,40}$/i.test(String(manifest.revision ?? '').trim()),
      'The production target and revision are explicit.',
      'Record the exact hub.ashbi.ca target and deployed revision.',
    ),
    check(
      'parallel-duration',
      Number.isInteger(minimumDays)
        && minimumDays >= 1
        && actualDuration >= minimumDays * 24 * 60 * 60 * 1000
        && evidenceCompletedAt !== null
        && endedAt !== null
        && evidenceCompletedAt >= endedAt,
      'The agreed parallel period completed before evidence was finalized.',
      'Complete the agreed parallel period and finalize its evidence afterward.',
    ),
    check(
      'bonsai-fallback',
      parallel.bonsaiAvailable === true,
      'Bonsai remained available through the parallel run.',
      'Keep Bonsai available and unchanged through the parallel run.',
    ),
    check(
      'complete-record-scope',
      REQUIRED_RECORD_TYPES.every((recordType) => recordTypes.has(recordType)),
      'Every required operating and financial record type was reconciled.',
      'Reconcile every required lead-to-payment and delivery record type.',
    ),
    check(
      'zero-discrepancies',
      reconciliation.unresolvedFindings === 0,
      'No unresolved migration or parallel-run findings remain.',
      'Resolve every migration and parallel-run discrepancy before cutover.',
    ),
    check(
      'currency-boundary',
      reconciliation.currenciesSeparated === true
        && reconciliation.unresolvedLegacyCurrencyRows === 0
        && reconciliation.unresolvedLegacyPaymentRows === 0,
      'Currency and legacy payment evidence is fully reconciled.',
      'Keep CAD and USD separate and resolve every legacy currency/payment row.',
    ),
    check(
      'provider-validation',
      providers.stripeSandboxPassed === true
        && providers.emailSandboxPassed === true
        && providers.proposalToPaymentPassed === true,
      'The complete sandbox provider journey passed.',
      'Complete Stripe, email, and proposal-to-payment sandbox validation.',
    ),
    check(
      'recovery',
      recovery.databaseBackupVerified === true
        && recovery.workspaceExportVerified === true
        && recovery.isolatedRestorePassed === true,
      'Backup, portable export, and isolated restore evidence passed.',
      'Verify the database backup, workspace export, and isolated restore drill.',
    ),
    check(
      'financial-approval',
      approval.approver === 'Cameron'
        && approval.decision === 'APPROVED'
        && approval.scope === 'BONSAI_FINANCIAL_CUTOVER'
        && approvalReference.length >= 12
        && !/pending|tbd|todo|placeholder/.test(approvalReference)
        && approvedAt !== null
        && evidenceCompletedAt !== null
        && approvedAt >= evidenceCompletedAt,
      'Cameron approved the exact financial cutover after evidence completion.',
      'Obtain Cameron’s exact action-time financial cutover approval after all evidence is complete.',
    ),
    check(
      'artifact-inventory',
      artifactInventoryIsComplete(manifest.artifacts),
      'Every required evidence artifact is inventoried.',
      'Inventory every required source, migration, provider, recovery, and approval artifact.',
    ),
    check(
      'artifact-integrity',
      artifactsAreIntact(manifest.artifacts, manifestDirectory),
      'Every required evidence artifact matches its recorded checksum.',
      'Evidence is missing, outside the manifest directory, unreadable, or does not match its checksum.',
    ),
  ];

  return { ready: checks.every((item) => item.ok), checks };
}
