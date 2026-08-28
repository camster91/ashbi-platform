import { verifyNotionBonsaiMappingDecision } from './notionBonsaiMappingDecision.service.js';
import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiOwnerDecision } from './notionBonsaiOwnerDecision.service.js';

const FORMAT = 'ashbi-bonsai-live-reconciliation-status';

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}

function timestamp(value, name) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}

function requireFormat(document, format, name) {
  if (document?.format !== format || document?.version !== 1) throw new TypeError(`A supported ${name} is required`);
}

function sameHash(actual, expected, name) {
  if (text(actual).toLowerCase() !== expected) throw new TypeError(`${name} is bound to another evidence generation`);
}

function summaryNumber(document, field, name) {
  const value = document?.summary?.[field];
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} summary is invalid`);
  return value;
}

export function prepareBonsaiLiveReconciliationStatus({
  taskReview,
  mappingDecision,
  ownerDecision,
  nativeProjectReview,
  projectLinkDecision,
  activeProjectTriage,
  financialReview,
  taskReviewSha256,
  mappingDecisionSha256,
  ownerDecisionSha256,
  nativeProjectReviewSha256,
  projectLinkDecisionSha256,
  activeProjectTriageSha256,
  financialReviewSha256,
  preparedAt,
}) {
  requireFormat(taskReview, 'ashbi-notion-bonsai-task-review', 'task review');
  requireFormat(mappingDecision, 'ashbi-notion-bonsai-mapping-decision', 'mapping decision');
  requireFormat(ownerDecision, 'ashbi-notion-bonsai-owner-decision', 'owner decision');
  requireFormat(nativeProjectReview, 'ashbi-notion-bonsai-native-project-review', 'native project review');
  requireFormat(projectLinkDecision, 'ashbi-notion-bonsai-native-project-link-decision', 'project-link decision');
  requireFormat(activeProjectTriage, 'ashbi-bonsai-active-project-triage', 'active project triage');
  requireFormat(financialReview, 'ashbi-bonsai-active-project-financial-review', 'active project financial review');

  const hashes = {
    taskReviewSha256: sha256(taskReviewSha256, 'taskReviewSha256'),
    mappingDecisionSha256: sha256(mappingDecisionSha256, 'mappingDecisionSha256'),
    ownerDecisionSha256: sha256(ownerDecisionSha256, 'ownerDecisionSha256'),
    nativeProjectReviewSha256: sha256(nativeProjectReviewSha256, 'nativeProjectReviewSha256'),
    projectLinkDecisionSha256: sha256(projectLinkDecisionSha256, 'projectLinkDecisionSha256'),
    activeProjectTriageSha256: sha256(activeProjectTriageSha256, 'activeProjectTriageSha256'),
    financialReviewSha256: sha256(financialReviewSha256, 'financialReviewSha256'),
  };
  sameHash(mappingDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Mapping decision');
  sameHash(ownerDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Owner decision');
  sameHash(nativeProjectReview.sourceEvidence?.taskReviewSha256, hashes.taskReviewSha256, 'Native project review');
  sameHash(projectLinkDecision.sourceEvidence?.reviewSha256, hashes.nativeProjectReviewSha256, 'Project-link decision');
  sameHash(activeProjectTriage.sourceEvidence?.nativeProjectReviewSha256, hashes.nativeProjectReviewSha256, 'Active project triage');
  sameHash(financialReview.sourceEvidence?.activeProjectTriageSha256, hashes.activeProjectTriageSha256, 'Financial review');
  sameHash(taskReview.sourceEvidence?.notionSnapshotSha256, nativeProjectReview.sourceEvidence?.notionSnapshotSha256, 'Notion source');
  sameHash(taskReview.sourceEvidence?.bonsaiSnapshotSha256, activeProjectTriage.sourceEvidence?.bonsaiTaskSnapshotSha256, 'Bonsai task source');
  sameHash(nativeProjectReview.sourceEvidence?.bonsaiProjectSnapshotSha256, activeProjectTriage.sourceEvidence?.bonsaiProjectSnapshotSha256, 'Bonsai project source');

  const mappingVerification = verifyNotionBonsaiMappingDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: mappingDecision,
  });
  const ownerVerification = verifyNotionBonsaiOwnerDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: ownerDecision,
  });
  const projectLinkVerification = verifyNotionBonsaiNativeProjectLinkDecision({
    review: nativeProjectReview, reviewSha256: hashes.nativeProjectReviewSha256, record: projectLinkDecision,
  });
  if (!mappingVerification.valid || !ownerVerification.valid || !projectLinkVerification.valid) {
    const failed = [
      !mappingVerification.valid ? `mapping:${mappingVerification.findings.join(',')}` : null,
      !ownerVerification.valid ? `owner:${ownerVerification.findings.join(',')}` : null,
      !projectLinkVerification.valid ? `project-link:${projectLinkVerification.findings.join(',')}` : null,
    ].filter(Boolean).join(';');
    throw new TypeError(`A decision artifact failed source-bound verification (${failed})`);
  }

  const prepared = timestamp(preparedAt, 'preparedAt');
  const sourceTimes = [taskReview, mappingDecision, ownerDecision, nativeProjectReview, projectLinkDecision, activeProjectTriage, financialReview]
    .map((document, index) => timestamp(document?.preparedAt, `source preparedAt ${index}`));
  if (sourceTimes.some(value => prepared < value)) throw new TypeError('preparedAt must not predate source evidence');

  const sourceReviewTasks = summaryNumber(taskReview, 'bonsaiSourceReview', 'Task review');
  const exactTaskLinks = summaryNumber(taskReview, 'exactTaskLinks', 'Task review');
  const notionOnlyTasks = summaryNumber(taskReview, 'notionOnly', 'Task review');
  const bonsaiOnlyTasks = summaryNumber(taskReview, 'bonsaiOnly', 'Task review');
  const unmatchedNotionProjects = summaryNumber(nativeProjectReview, 'unmatchedNotionProjects', 'Native project review');
  const unmatchedBonsaiProjects = summaryNumber(nativeProjectReview, 'unmatchedBonsaiProjects', 'Native project review');
  const duplicateBonsaiTitles = summaryNumber(nativeProjectReview, 'duplicateBonsaiTitles', 'Native project review');
  const activeProjects = summaryNumber(activeProjectTriage, 'activeProjects', 'Active project triage');
  const closureAuthorizedProjects = summaryNumber(financialReview, 'closureAuthorizedProjects', 'Financial review');
  const projectlessTimeEntries = summaryNumber(financialReview, 'projectlessTimeEntries', 'Financial review');
  const projectsWithNonPaidInvoices = summaryNumber(financialReview, 'projectsWithNonPaidInvoices', 'Financial review');
  const projectsWithUnbilledTime = summaryNumber(financialReview, 'projectsWithUnbilledTime', 'Financial review');

  const findings = [];
  if (sourceReviewTasks > 0) findings.push('BONSAI_TASK_SOURCE_REVIEW_REQUIRED');
  if (exactTaskLinks > 0) findings.push('EXACT_TASK_LINK_DECISION_RECORD_MISSING');
  if (mappingVerification.pending > 0) findings.push('TASK_MAPPING_DECISIONS_PENDING');
  if (ownerVerification.pending > 0) findings.push('TASK_OWNER_DECISIONS_PENDING');
  if (projectLinkVerification.pending > 0) findings.push('PROJECT_LINK_DECISIONS_PENDING');
  if (notionOnlyTasks > 0 || bonsaiOnlyTasks > 0) findings.push('SOURCE_ONLY_TASK_DISPOSITIONS_PENDING');
  if (unmatchedNotionProjects > 0 || unmatchedBonsaiProjects > 0) findings.push('SOURCE_ONLY_PROJECT_DISPOSITIONS_PENDING');
  if (duplicateBonsaiTitles > 0) findings.push('DUPLICATE_BONSAI_PROJECT_TITLES_PENDING');
  if (activeProjects > closureAuthorizedProjects) findings.push('ACTIVE_PROJECT_DISPOSITIONS_PENDING');
  if (projectsWithNonPaidInvoices > 0) findings.push('NON_PAID_INVOICE_RECORDS_REQUIRE_REVIEW');
  if (projectsWithUnbilledTime > 0) findings.push('UNBILLED_TIME_REQUIRES_REVIEW');
  if (projectlessTimeEntries > 0) findings.push('PROJECTLESS_TIME_ENTRY_REQUIRES_REVIEW');
  findings.push('DIRECT_PAYMENT_EVIDENCE_MISSING');
  findings.push('COMPLETE_CONTRACT_EVIDENCE_MISSING');
  findings.push('PARALLEL_RUN_AND_BACKUP_EVIDENCE_MISSING');
  findings.push('FINANCIAL_CUTOVER_APPROVAL_MISSING');

  return {
    format: FORMAT,
    version: 1,
    complete: false,
    reasonCode: 'LIVE_RECONCILIATION_AND_CUTOVER_GATES_PENDING',
    preparedAt: new Date(prepared).toISOString(),
    sourceGenerationAligned: true,
    readyForMigration: false,
    readyForBonsaiRetirement: false,
    gates: {
      sourceGeneration: { state: 'PASS', findingCount: 0 },
      taskIdentity: {
        state: 'BLOCKED', exactTaskLinksWithoutDecisionRecord: exactTaskLinks,
        mappingDecisionsPending: mappingVerification.pending, sourceReviewTasks,
        notionOnlyTasks, bonsaiOnlyTasks,
      },
      taskOwnership: { state: 'BLOCKED', decisionsPending: ownerVerification.pending },
      projectIdentity: {
        state: 'BLOCKED', decisionsPending: projectLinkVerification.pending,
        unmatchedNotionProjects, unmatchedBonsaiProjects, duplicateBonsaiTitles,
      },
      activeProjectDisposition: {
        state: 'BLOCKED', activeProjects, closureAuthorizedProjects,
      },
      financialSafety: {
        state: 'BLOCKED', projectsWithNonPaidInvoices, projectsWithUnbilledTime,
        projectlessTimeEntries, directPaymentEvidenceComplete: false, contractEvidenceComplete: false,
      },
      retirement: {
        state: 'BLOCKED', backupEvidenceComplete: false, parallelRunComplete: false,
        reconciliationComplete: false, explicitFinancialCutoverApproval: false,
      },
    },
    findings,
    safeguards: {
      externalWritesPerformed: false,
      decisionsApplied: false,
      tasksOrOwnersChanged: false,
      projectsChanged: false,
      financialRecordsChanged: false,
      migrationAuthorized: false,
      bonsaiRetirementAuthorized: false,
    },
    sourceEvidence: {
      ...hashes,
      notionSnapshotSha256: text(taskReview.sourceEvidence.notionSnapshotSha256).toLowerCase(),
      bonsaiTaskSnapshotSha256: text(taskReview.sourceEvidence.bonsaiSnapshotSha256).toLowerCase(),
      bonsaiProjectSnapshotSha256: text(nativeProjectReview.sourceEvidence.bonsaiProjectSnapshotSha256).toLowerCase(),
      projectGroupSnapshotSha256: text(activeProjectTriage.sourceEvidence.projectGroupSnapshotSha256).toLowerCase(),
      invoiceSnapshotSha256: text(financialReview.sourceEvidence.invoiceSnapshotSha256).toLowerCase(),
      timeEntrySnapshotSha256: text(financialReview.sourceEvidence.timeEntrySnapshotSha256).toLowerCase(),
    },
  };
}

export function verifyBonsaiLiveReconciliationStatus(options) {
  try {
    const expected = prepareBonsaiLiveReconciliationStatus({ ...options, preparedAt: options.record?.preparedAt });
    return {
      valid: JSON.stringify(options.record) === JSON.stringify(expected),
      sourceGenerationAligned: expected.sourceGenerationAligned,
      readyForMigration: expected.readyForMigration,
      readyForBonsaiRetirement: expected.readyForBonsaiRetirement,
      findings: JSON.stringify(options.record) === JSON.stringify(expected) ? [] : ['STATUS_RECORD_MISMATCH'],
    };
  } catch {
    return {
      valid: false, sourceGenerationAligned: false, readyForMigration: false,
      readyForBonsaiRetirement: false, findings: ['STATUS_VERIFICATION_FAILED'],
    };
  }
}

export { FORMAT as BONSAI_LIVE_RECONCILIATION_STATUS_FORMAT };
