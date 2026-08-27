import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ARTIFACT_IDS = Object.freeze([
  'strategy-approval',
  'ashbi-ca-deployment',
  'hub-deployment',
  'controlled-journey',
  'growth-cadence',
  'notion-confirmed-import',
  'notion-idempotent-rerun',
  'bonsai-cutover-manifest',
  'final-launch-approval',
]);

const REQUIRED_STRATEGY_DECISIONS = Object.freeze([
  'companyCharter', 'ownershipCharter', 'serviceCatalogue', 'messagingMatrix',
]);

const REQUIRED_JOURNEY_RECORDS = Object.freeze([
  'lead', 'client', 'opportunity', 'proposal', 'contract', 'project', 'invoice', 'payment',
]);

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function containedPath(directory, relativePath) {
  if (!directory || !relativePath || path.isAbsolute(relativePath)) return null;
  try {
    const base = fs.realpathSync(path.resolve(directory));
    const resolved = fs.realpathSync(path.resolve(base, relativePath));
    const relative = path.relative(base, resolved);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
  } catch {
    return null;
  }
}

function artifactMap(artifacts) {
  const map = new Map();
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact?.id && !map.has(artifact.id)) map.set(artifact.id, artifact);
    else if (artifact?.id) map.set(artifact.id, null);
  }
  return map;
}

function verifyArtifact(artifact, directory) {
  if (!artifact || !/^[a-f0-9]{64}$/i.test(text(artifact.sha256))) return false;
  const resolved = containedPath(directory, artifact.path);
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return false;
  const digest = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  return digest === normalized(artifact.sha256);
}

function readJsonArtifact(artifacts, id, directory) {
  const artifact = artifacts.get(id);
  if (!verifyArtifact(artifact, directory)) return null;
  try {
    return JSON.parse(fs.readFileSync(containedPath(directory, artifact.path), 'utf8'));
  } catch {
    return null;
  }
}

function approvalsContain(payload, person) {
  return Array.isArray(payload?.approvals) && payload.approvals.some(approval => (
    normalized(approval?.approver) === normalized(person)
      && approval?.decision === 'APPROVED'
      && timestamp(approval?.approvedAt) !== null
  ));
}

function strategyIsApproved(payload, evidenceCompletedAt) {
  if (payload?.format !== 'ashbi-strategy-approval' || payload?.version !== 1 || payload?.complete !== true) return false;
  if (!text(payload.strategyVersion) || !REQUIRED_STRATEGY_DECISIONS.every(key => payload.decisions?.[key] === 'APPROVED')) return false;
  if (!approvalsContain(payload, 'Cameron') || !approvalsContain(payload, 'Bianca')) return false;
  return payload.approvals.every((approval) => {
    const approvedAt = timestamp(approval.approvedAt);
    return approvedAt !== null && approvedAt <= evidenceCompletedAt;
  });
}

function deploymentIsValid(payload, { application, url, strategyVersion, evidenceCompletedAt }) {
  const verifiedAt = timestamp(payload?.verifiedAt);
  return payload?.format === 'ashbi-deployment-evidence'
    && payload?.version === 1
    && payload?.complete === true
    && payload?.application === application
    && payload?.url === url
    && /^[a-f0-9]{7,40}$/i.test(text(payload?.revision))
    && /^[a-f0-9]{7,40}$/i.test(text(payload?.rollbackRevision))
    && normalized(payload?.revision) !== normalized(payload?.rollbackRevision)
    && payload?.strategyVersion === strategyVersion
    && payload?.smokePassed === true
    && payload?.rollbackVerified === true
    && verifiedAt !== null
    && verifiedAt <= evidenceCompletedAt;
}

function journeyIsValid(payload, { organizationId, publicRevision, hubRevision, evidenceCompletedAt }) {
  const completedAt = timestamp(payload?.completedAt);
  return payload?.format === 'ashbi-controlled-journey-evidence'
    && payload?.version === 1
    && payload?.complete === true
    && payload?.organizationId === organizationId
    && payload?.environmentKind === 'sandbox'
    && normalized(payload?.publicSiteRevision) === normalized(publicRevision)
    && normalized(payload?.hubRevision) === normalized(hubRevision)
    && ['CAD', 'USD'].includes(payload?.currency)
    && payload?.stripeMode === 'test'
    && payload?.emailMode === 'sandbox'
    && payload?.reconciliationPassed === true
    && payload?.duplicateWrites === 0
    && payload?.manualDatabaseCorrections === 0
    && REQUIRED_JOURNEY_RECORDS.every(key => text(payload?.recordIds?.[key]).length >= 3)
    && completedAt !== null
    && completedAt <= evidenceCompletedAt;
}

function growthCadenceIsValid(payload, organizationId, evidenceCompletedAt) {
  if (payload?.format !== 'ashbi-growth-cadence-evidence' || payload?.version !== 1 || payload?.complete !== true) return false;
  if (payload.organizationId !== organizationId) return false;
  const startedAt = timestamp(payload?.baseline?.startedAt);
  const endedAt = timestamp(payload?.baseline?.endedAt);
  if (startedAt === null || endedAt === null || endedAt - startedAt < 30 * 24 * 60 * 60 * 1000) return false;
  if (endedAt > evidenceCompletedAt || payload.baseline.sourceCoverageReviewed !== true
    || payload.baseline.currenciesSeparated !== true || payload.baseline.missingAttributionDisclosed !== true) return false;
  const reviews = Array.isArray(payload.weeklyReviews) ? [...payload.weeklyReviews] : [];
  if (reviews.length < 4) return false;
  reviews.sort((left, right) => text(left.weekStart).localeCompare(text(right.weekStart)));
  for (let index = 0; index < reviews.length; index += 1) {
    const review = reviews[index];
    const weekStart = timestamp(`${review.weekStart}T00:00:00.000Z`);
    const dueDate = timestamp(review.dueDate);
    const completedAt = timestamp(review.completedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(review.weekStart)) || weekStart === null
      || new Date(weekStart).getUTCDay() !== 1 || !text(review.actionTaskId)
      || !text(review.ownerId) || dueDate === null || completedAt === null
      || dueDate < weekStart || completedAt < weekStart
      || dueDate >= weekStart + 7 * 24 * 60 * 60 * 1000
      || completedAt >= weekStart + 7 * 24 * 60 * 60 * 1000
      || completedAt > evidenceCompletedAt) return false;
    if (index > 0) {
      const previous = timestamp(`${reviews[index - 1].weekStart}T00:00:00.000Z`);
      if (weekStart - previous !== 7 * 24 * 60 * 60 * 1000) return false;
    }
  }
  return true;
}

function notionEvidenceIsValid(confirmed, rerun, organizationId, evidenceCompletedAt) {
  const base = report => report?.format === 'ashbi-notion-markdown-import-report'
    && report?.version === 3
    && report?.complete === true
    && Array.isArray(report?.errors)
    && report.errors.length === 0
    && /^[a-f0-9]{64}$/i.test(text(report?.sourceFingerprint))
    && /^[a-f0-9]{64}$/i.test(text(report?.planFingerprint))
    && timestamp(report?.generatedAt) !== null
    && timestamp(report.generatedAt) <= evidenceCompletedAt;
  return base(confirmed)
    && base(rerun)
    && confirmed.mode === 'live'
    && rerun.mode === 'dry-run'
    && confirmed.organization?.id === organizationId
    && confirmed.organization?.id === rerun.organization?.id
    && confirmed.project?.id === rerun.project?.id
    && confirmed.sourceFingerprint === rerun.sourceFingerprint
    && rerun.notes?.planned === 0
    && rerun.notes?.conflicts === 0
    && rerun.notes?.skipped === 0;
}

function finalApprovalIsValid(payload, evidenceCompletedAt) {
  const approvedAt = timestamp(payload?.approvedAt);
  return payload?.format === 'ashbi-unified-launch-approval'
    && payload?.version === 1
    && payload?.decision === 'APPROVED'
    && payload?.scope === 'UNIFIED_PLATFORM_PUBLIC_LAUNCH'
    && normalized(payload?.approver) === 'cameron'
    && text(payload?.reference) !== ''
    && approvedAt !== null
    && approvedAt >= evidenceCompletedAt;
}

export function evaluateUnifiedLaunchReadiness({
  manifest = {},
  manifestDirectory,
  bonsaiCutoverReport = {},
  bonsaiCutoverOrganizationId,
} = {}) {
  const evidenceCompletedAt = timestamp(manifest.evidenceCompletedAt);
  const organizationId = text(manifest.organizationId);
  const artifacts = artifactMap(manifest.artifacts);
  const artifactInventoryValid = REQUIRED_ARTIFACT_IDS.every(id => artifacts.has(id) && verifyArtifact(artifacts.get(id), manifestDirectory));
  const strategy = readJsonArtifact(artifacts, 'strategy-approval', manifestDirectory);
  const publicDeployment = readJsonArtifact(artifacts, 'ashbi-ca-deployment', manifestDirectory);
  const hubDeployment = readJsonArtifact(artifacts, 'hub-deployment', manifestDirectory);
  const journey = readJsonArtifact(artifacts, 'controlled-journey', manifestDirectory);
  const growth = readJsonArtifact(artifacts, 'growth-cadence', manifestDirectory);
  const notionConfirmed = readJsonArtifact(artifacts, 'notion-confirmed-import', manifestDirectory);
  const notionRerun = readJsonArtifact(artifacts, 'notion-idempotent-rerun', manifestDirectory);
  const finalApproval = readJsonArtifact(artifacts, 'final-launch-approval', manifestDirectory);
  const strategyApproved = evidenceCompletedAt !== null && strategyIsApproved(strategy, evidenceCompletedAt);
  const publicDeploymentValid = strategyApproved && deploymentIsValid(publicDeployment, {
    application: 'ashbi.ca', url: 'https://ashbi.ca', strategyVersion: strategy.strategyVersion, evidenceCompletedAt,
  });
  const hubDeploymentValid = strategyApproved && deploymentIsValid(hubDeployment, {
    application: 'hub.ashbi.ca', url: 'https://hub.ashbi.ca', strategyVersion: strategy.strategyVersion, evidenceCompletedAt,
  });
  const checks = [
    check('manifest-schema', manifest.schemaVersion === 1 && organizationId !== '' && evidenceCompletedAt !== null,
      'The unified launch manifest has a valid schema and evidence timestamp.',
      'Provide schema version 1 and a valid evidence completion timestamp.'),
    check('artifact-integrity', artifactInventoryValid,
      'Every required launch artifact is contained and checksum-valid.',
      'One or more required launch artifacts are missing, duplicated, outside the evidence directory, or changed.'),
    check('strategy-approval', strategyApproved,
      'Bianca and Cameron approved the shared strategy and service language.',
      'The company strategy, ownership, catalogue, messaging, or both partner approvals remain pending.'),
    check('public-site-deployment', publicDeploymentValid,
      'Ashbi.ca is verified on the approved strategy revision with rollback evidence.',
      'Ashbi.ca deployment, strategy binding, smoke evidence, or rollback evidence is incomplete.'),
    check('hub-deployment', hubDeploymentValid,
      'The Hub is verified on the approved strategy revision with rollback evidence.',
      'The Hub deployment, strategy binding, smoke evidence, or rollback evidence is incomplete.'),
    check('controlled-journey', publicDeploymentValid && hubDeploymentValid && journeyIsValid(journey, {
      organizationId, publicRevision: publicDeployment?.revision, hubRevision: hubDeployment?.revision, evidenceCompletedAt,
    }),
    'A complete sandbox inquiry-to-payment journey reconciled without duplicate writes or database correction.',
    'The controlled inquiry-to-payment journey is incomplete, unreconciled, or not bound to both deployed revisions.'),
    check('notion-migration', evidenceCompletedAt !== null && notionEvidenceIsValid(notionConfirmed, notionRerun, organizationId, evidenceCompletedAt),
      'The confirmed Notion import and idempotent rerun reconcile to the same source and destination.',
      'Notion confirmed-import or idempotent-rerun evidence is incomplete or inconsistent.'),
    check('bonsai-cutover', bonsaiCutoverOrganizationId === organizationId
      && bonsaiCutoverReport?.ready === true
      && Array.isArray(bonsaiCutoverReport?.checks)
      && bonsaiCutoverReport.checks.length > 0
      && bonsaiCutoverReport.checks.every(item => item.ok === true),
    'The nested Bonsai cutover manifest passes every operating, provider, recovery, and financial gate.',
    'The actual nested Bonsai cutover evaluation does not pass.'),
    check('growth-cadence', evidenceCompletedAt !== null && growthCadenceIsValid(growth, organizationId, evidenceCompletedAt),
      'A 30-day baseline and at least four consecutive weekly growth reviews are evidenced.',
      'The marketing baseline or repeatable weekly growth cadence is incomplete.'),
    check('final-launch-approval', evidenceCompletedAt !== null && finalApprovalIsValid(finalApproval, evidenceCompletedAt),
      'Cameron approved the exact post-evidence unified public launch.',
      'The exact post-evidence unified public-launch approval remains pending.'),
  ];
  return { ready: checks.every(item => item.ok), checks };
}

export { REQUIRED_ARTIFACT_IDS as UNIFIED_LAUNCH_ARTIFACT_IDS };
