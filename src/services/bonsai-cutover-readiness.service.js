import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REVENUE_EVIDENCE_COLLECTIONS, verifyRevenueEvidenceExport } from './revenueEvidenceExport.service.js';
import { verifyWorkspaceExport, workspaceExportCollections } from './workspace-export-integrity.service.js';

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
  'bonsai-clients-csv',
  'bonsai-projects-csv',
  'bonsai-invoices-csv',
  'bonsai-import-dry-run',
  'bonsai-import-confirmed',
  'notion-source-export',
  'notion-import-dry-run',
  'notion-import-confirmed',
  'parallel-reconciliation',
  'operations-reconciliation',
  'stripe-sandbox',
  'email-sandbox',
  'revenue-evidence-export',
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

function readContainedJsonArtifact(artifacts, id, manifestDirectory) {
  if (!Array.isArray(artifacts) || !manifestDirectory) return null;
  const artifact = artifacts.find(item => item?.id === id);
  if (!artifact) return null;
  const root = path.resolve(manifestDirectory);
  const artifactPath = path.resolve(root, String(artifact.path ?? ''));
  if (artifactPath !== root && !artifactPath.startsWith(`${root}${path.sep}`)) return null;
  try {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch {
    return null;
  }
}

function revenueEvidenceIsValid({ artifacts, manifestDirectory, organizationId, parallelEndedAt, evidenceCompletedAt }) {
  if (!artifactInventoryIsComplete(artifacts) || !manifestDirectory) return false;
  try {
    const payload = readContainedJsonArtifact(artifacts, 'revenue-evidence-export', manifestDirectory);
    if (!payload) return false;
    const exportedAt = timestamp(payload.exportedAt);
    return typeof organizationId === 'string'
      && organizationId.trim().length > 0
      && payload.organizationId === organizationId
      && verifyRevenueEvidenceExport(payload).valid
      && exportedAt !== null
      && parallelEndedAt !== null
      && evidenceCompletedAt !== null
      && exportedAt >= parallelEndedAt
      && exportedAt <= evidenceCompletedAt;
  } catch {
    return false;
  }
}

function parallelRevenueIsBound({ artifacts, manifestDirectory, organizationId, reconciliation, evidenceCompletedAt }) {
  const parallelReport = readContainedJsonArtifact(artifacts, 'parallel-reconciliation', manifestDirectory);
  const revenuePayload = readContainedJsonArtifact(artifacts, 'revenue-evidence-export', manifestDirectory);
  const revenueArtifact = Array.isArray(artifacts)
    ? artifacts.find(item => item?.id === 'revenue-evidence-export')
    : null;
  const bonsaiInvoicesArtifact = Array.isArray(artifacts)
    ? artifacts.find(item => item?.id === 'bonsai-invoices-csv')
    : null;
  if (!parallelReport || !revenuePayload || !revenueArtifact || !bonsaiInvoicesArtifact) return false;
  const completedAt = timestamp(parallelReport.completedAt);
  const exportedAt = timestamp(revenuePayload.exportedAt);
  const countsMatch = REVENUE_EVIDENCE_COLLECTIONS.every(collection => (
    Number.isInteger(parallelReport.revenueEvidence?.collectionCounts?.[collection])
      && parallelReport.revenueEvidence.collectionCounts[collection]
        === revenuePayload.manifest?.collections?.[collection]?.count
  ));
  return parallelReport.format === 'ashbi-parallel-reconciliation'
    && parallelReport.version === 1
    && parallelReport.complete === true
    && parallelReport.organizationId === organizationId
    && parallelReport.unresolvedFindings === reconciliation.unresolvedFindings
    && parallelReport.unresolvedFindings === 0
    && parallelReport.currenciesSeparated === reconciliation.currenciesSeparated
    && parallelReport.currenciesSeparated === true
    && parallelReport.sourceEvidence?.invoicesSha256 === bonsaiInvoicesArtifact.sha256
    && Number.isInteger(parallelReport.sourceEvidence?.invoiceRows)
    && parallelReport.sourceEvidence.invoiceRows >= 0
    && parallelReport.revenueEvidence?.artifactSha256 === revenueArtifact.sha256
    && parallelReport.revenueEvidence?.recordsSha256 === revenuePayload.manifest?.recordsSha256
    && countsMatch
    && completedAt !== null
    && exportedAt !== null
    && evidenceCompletedAt !== null
    && completedAt >= exportedAt
    && completedAt <= evidenceCompletedAt;
}

function operationsReconciliationIsBound({ artifacts, manifestDirectory, organizationId, reconciliation, evidenceCompletedAt }) {
  const operationsReport = readContainedJsonArtifact(artifacts, 'operations-reconciliation', manifestDirectory);
  const workspacePayload = readContainedJsonArtifact(artifacts, 'workspace-export', manifestDirectory);
  const artifact = id => Array.isArray(artifacts) ? artifacts.find(item => item?.id === id) : null;
  const clientsArtifact = artifact('bonsai-clients-csv');
  const projectsArtifact = artifact('bonsai-projects-csv');
  const workspaceArtifact = artifact('workspace-export');
  if (!operationsReport || !workspacePayload || !clientsArtifact || !projectsArtifact || !workspaceArtifact) return false;
  const completedAt = timestamp(operationsReport.completedAt);
  const exportedAt = timestamp(workspacePayload.exportedAt);
  const countsMatch = workspaceExportCollections(workspacePayload.version).every(collection => (
    Number.isInteger(operationsReport.workspaceEvidence?.collectionCounts?.[collection])
      && operationsReport.workspaceEvidence.collectionCounts[collection]
        === workspacePayload.manifest?.collections?.[collection]?.count
  ));
  return operationsReport.format === 'ashbi-bonsai-operations-reconciliation'
    && operationsReport.version === 1
    && operationsReport.complete === true
    && operationsReport.organizationId === organizationId
    && operationsReport.unresolvedFindings === reconciliation.unresolvedFindings
    && operationsReport.unresolvedFindings === 0
    && workspacePayload.organization?.id === organizationId
    && workspacePayload.version === 3
    && verifyWorkspaceExport(workspacePayload).valid
    && operationsReport.sourceEvidence?.clientsSha256 === clientsArtifact.sha256
    && Number.isInteger(operationsReport.sourceEvidence?.clientRows)
    && operationsReport.sourceEvidence.clientRows >= 0
    && operationsReport.sourceEvidence?.projectsSha256 === projectsArtifact.sha256
    && Number.isInteger(operationsReport.sourceEvidence?.projectRows)
    && operationsReport.sourceEvidence.projectRows >= 0
    && operationsReport.workspaceEvidence?.artifactSha256 === workspaceArtifact.sha256
    && operationsReport.workspaceEvidence?.recordsSha256 === workspacePayload.manifest?.recordsSha256
    && countsMatch
    && completedAt !== null
    && exportedAt !== null
    && evidenceCompletedAt !== null
    && completedAt >= exportedAt
    && completedAt <= evidenceCompletedAt;
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
      'revenue-evidence',
      revenueEvidenceIsValid({
        artifacts: manifest.artifacts,
        manifestDirectory,
        organizationId: manifest.organizationId,
        parallelEndedAt: endedAt,
        evidenceCompletedAt,
      }),
      'The final tenant revenue artifact is internally valid and postdates the parallel run.',
      'Export and verify tenant-matched revenue evidence after the parallel run and before evidence completion.',
    ),
    check(
      'parallel-revenue-binding',
      parallelRevenueIsBound({
        artifacts: manifest.artifacts,
        manifestDirectory,
        organizationId: manifest.organizationId,
        reconciliation,
        evidenceCompletedAt,
      }),
      'Parallel reconciliation is bound to the exact tenant revenue artifact and collection counts.',
      'Reconcile and record the exact tenant revenue artifact checksum, record checksum, and collection counts.',
    ),
    check(
      'operations-reconciliation-binding',
      operationsReconciliationIsBound({
        artifacts: manifest.artifacts,
        manifestDirectory,
        organizationId: manifest.organizationId,
        reconciliation,
        evidenceCompletedAt,
      }),
      'Client and project reconciliation is bound to the exact Bonsai sources and tenant workspace export.',
      'Reconcile the exact Bonsai client/project sources against the tenant workspace export and bind every checksum and collection count.',
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
