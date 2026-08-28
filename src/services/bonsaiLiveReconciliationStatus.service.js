import { verifyNotionBonsaiMappingDecision } from './notionBonsaiMappingDecision.service.js';
import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiOwnerDecision } from './notionBonsaiOwnerDecision.service.js';
import { verifyNotionBonsaiTaskLinkDecision } from './notionBonsaiTaskLinkDecision.service.js';
import { verifyNotionBonsaiTaskDispositionDecision } from './notionBonsaiTaskDispositionDecision.service.js';
import { verifyNotionBonsaiProjectDispositionDecision } from './notionBonsaiProjectDispositionDecision.service.js';
import { verifyBonsaiActiveProjectDispositionDecision } from './bonsaiActiveProjectDispositionDecision.service.js';
import { verifyBonsaiFinancialExceptionDecision } from './bonsaiFinancialExceptionDecision.service.js';

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

function requireFormat(document, format, name, version = 1) {
  if (document?.format !== format || document?.version !== version) throw new TypeError(`A supported ${name} is required`);
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
  taskLinkDecision,
  taskDispositionDecision,
  ownerDecision,
  nativeProjectReview,
  projectLinkDecision,
  projectDispositionDecision,
  activeProjectTriage,
  financialReview,
  activeProjectDispositionDecision,
  invoiceSnapshot,
  timeEntrySnapshot,
  financialExceptionDecision,
  taskReviewSha256,
  mappingDecisionSha256,
  taskLinkDecisionSha256,
  taskDispositionDecisionSha256,
  ownerDecisionSha256,
  nativeProjectReviewSha256,
  projectLinkDecisionSha256,
  projectDispositionDecisionSha256,
  activeProjectTriageSha256,
  financialReviewSha256,
  activeProjectDispositionDecisionSha256,
  invoiceSnapshotSha256,
  timeEntrySnapshotSha256,
  financialExceptionDecisionSha256,
  preparedAt,
}) {
  requireFormat(taskReview, 'ashbi-notion-bonsai-task-review', 'task review');
  requireFormat(mappingDecision, 'ashbi-notion-bonsai-mapping-decision', 'mapping decision');
  requireFormat(taskLinkDecision, 'ashbi-notion-bonsai-task-link-decision', 'task-link decision');
  requireFormat(taskDispositionDecision, 'ashbi-notion-bonsai-task-disposition-decision', 'task-disposition decision');
  requireFormat(ownerDecision, 'ashbi-notion-bonsai-owner-decision', 'owner decision', 2);
  requireFormat(nativeProjectReview, 'ashbi-notion-bonsai-native-project-review', 'native project review');
  requireFormat(projectLinkDecision, 'ashbi-notion-bonsai-native-project-link-decision', 'project-link decision');
  requireFormat(projectDispositionDecision, 'ashbi-notion-bonsai-project-disposition-decision', 'project-disposition decision', 2);
  requireFormat(activeProjectTriage, 'ashbi-bonsai-active-project-triage', 'active project triage');
  requireFormat(financialReview, 'ashbi-bonsai-active-project-financial-review', 'active project financial review');
  requireFormat(activeProjectDispositionDecision, 'ashbi-bonsai-active-project-disposition-decision', 'active project disposition decision');
  requireFormat(invoiceSnapshot, 'bonsai-invoice-index-snapshot', 'invoice index');
  requireFormat(timeEntrySnapshot, 'bonsai-time-entry-index-snapshot', 'time-entry index');
  requireFormat(financialExceptionDecision, 'ashbi-bonsai-financial-exception-decision', 'financial exception decision');

  const hashes = {
    taskReviewSha256: sha256(taskReviewSha256, 'taskReviewSha256'),
    mappingDecisionSha256: sha256(mappingDecisionSha256, 'mappingDecisionSha256'),
    taskLinkDecisionSha256: sha256(taskLinkDecisionSha256, 'taskLinkDecisionSha256'),
    taskDispositionDecisionSha256: sha256(taskDispositionDecisionSha256, 'taskDispositionDecisionSha256'),
    ownerDecisionSha256: sha256(ownerDecisionSha256, 'ownerDecisionSha256'),
    nativeProjectReviewSha256: sha256(nativeProjectReviewSha256, 'nativeProjectReviewSha256'),
    projectLinkDecisionSha256: sha256(projectLinkDecisionSha256, 'projectLinkDecisionSha256'),
    projectDispositionDecisionSha256: sha256(projectDispositionDecisionSha256, 'projectDispositionDecisionSha256'),
    activeProjectTriageSha256: sha256(activeProjectTriageSha256, 'activeProjectTriageSha256'),
    financialReviewSha256: sha256(financialReviewSha256, 'financialReviewSha256'),
    activeProjectDispositionDecisionSha256: sha256(activeProjectDispositionDecisionSha256, 'activeProjectDispositionDecisionSha256'),
    invoiceSnapshotSha256: sha256(invoiceSnapshotSha256, 'invoiceSnapshotSha256'),
    timeEntrySnapshotSha256: sha256(timeEntrySnapshotSha256, 'timeEntrySnapshotSha256'),
    financialExceptionDecisionSha256: sha256(financialExceptionDecisionSha256, 'financialExceptionDecisionSha256'),
  };
  sameHash(mappingDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Mapping decision');
  sameHash(taskLinkDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Task-link decision');
  sameHash(taskDispositionDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Task-disposition decision');
  sameHash(ownerDecision.sourceEvidence?.reviewSha256, hashes.taskReviewSha256, 'Owner decision');
  if (taskLinkDecision.sourceEvidence?.mappingDecisionSha256) sameHash(taskLinkDecision.sourceEvidence.mappingDecisionSha256, hashes.mappingDecisionSha256, 'Task-link mapping decision');
  if (ownerDecision.sourceEvidence?.mappingDecisionSha256) sameHash(ownerDecision.sourceEvidence.mappingDecisionSha256, hashes.mappingDecisionSha256, 'Owner mapping decision');
  if (ownerDecision.sourceEvidence?.taskLinkDecisionSha256) sameHash(ownerDecision.sourceEvidence.taskLinkDecisionSha256, hashes.taskLinkDecisionSha256, 'Owner task-link decision');
  sameHash(nativeProjectReview.sourceEvidence?.taskReviewSha256, hashes.taskReviewSha256, 'Native project review');
  sameHash(projectLinkDecision.sourceEvidence?.reviewSha256, hashes.nativeProjectReviewSha256, 'Project-link decision');
  sameHash(projectDispositionDecision.sourceEvidence?.reviewSha256, hashes.nativeProjectReviewSha256, 'Project-disposition decision');
  sameHash(projectDispositionDecision.sourceEvidence?.projectLinkDecisionSha256, hashes.projectLinkDecisionSha256, 'Project-disposition link decision');
  sameHash(activeProjectTriage.sourceEvidence?.nativeProjectReviewSha256, hashes.nativeProjectReviewSha256, 'Active project triage');
  sameHash(financialReview.sourceEvidence?.activeProjectTriageSha256, hashes.activeProjectTriageSha256, 'Financial review');
  sameHash(activeProjectDispositionDecision.sourceEvidence?.activeProjectTriageSha256, hashes.activeProjectTriageSha256, 'Active project disposition triage');
  sameHash(activeProjectDispositionDecision.sourceEvidence?.financialReviewSha256, hashes.financialReviewSha256, 'Active project disposition financial review');
  sameHash(activeProjectDispositionDecision.sourceEvidence?.projectDispositionDecisionSha256, hashes.projectDispositionDecisionSha256, 'Active project disposition source decision');
  sameHash(financialReview.sourceEvidence?.invoiceSnapshotSha256, hashes.invoiceSnapshotSha256, 'Financial review invoice index');
  sameHash(financialReview.sourceEvidence?.timeEntrySnapshotSha256, hashes.timeEntrySnapshotSha256, 'Financial review time-entry index');
  sameHash(financialExceptionDecision.sourceEvidence?.financialReviewSha256, hashes.financialReviewSha256, 'Financial exception review');
  sameHash(financialExceptionDecision.sourceEvidence?.invoiceSnapshotSha256, hashes.invoiceSnapshotSha256, 'Financial exception invoice index');
  sameHash(financialExceptionDecision.sourceEvidence?.timeEntrySnapshotSha256, hashes.timeEntrySnapshotSha256, 'Financial exception time-entry index');
  sameHash(taskReview.sourceEvidence?.notionSnapshotSha256, nativeProjectReview.sourceEvidence?.notionSnapshotSha256, 'Notion source');
  sameHash(taskReview.sourceEvidence?.bonsaiSnapshotSha256, activeProjectTriage.sourceEvidence?.bonsaiTaskSnapshotSha256, 'Bonsai task source');
  sameHash(nativeProjectReview.sourceEvidence?.bonsaiProjectSnapshotSha256, activeProjectTriage.sourceEvidence?.bonsaiProjectSnapshotSha256, 'Bonsai project source');

  const mappingVerification = verifyNotionBonsaiMappingDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: mappingDecision,
  });
  const ownerVerification = verifyNotionBonsaiOwnerDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: ownerDecision,
    mappingDecisionRecord: ownerDecision.sourceEvidence?.mappingDecisionSha256 ? mappingDecision : null,
    mappingDecisionSha256: ownerDecision.sourceEvidence?.mappingDecisionSha256 ? hashes.mappingDecisionSha256 : null,
    taskLinkDecisionRecord: ownerDecision.sourceEvidence?.taskLinkDecisionSha256 ? taskLinkDecision : null,
    taskLinkDecisionSha256: ownerDecision.sourceEvidence?.taskLinkDecisionSha256 ? hashes.taskLinkDecisionSha256 : null,
  });
  const taskLinkVerification = verifyNotionBonsaiTaskLinkDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: taskLinkDecision,
    mappingDecision: taskLinkDecision.sourceEvidence?.mappingDecisionSha256 ? mappingDecision : null,
    mappingDecisionSha256: taskLinkDecision.sourceEvidence?.mappingDecisionSha256 ? hashes.mappingDecisionSha256 : null,
  });
  const taskDispositionVerification = verifyNotionBonsaiTaskDispositionDecision({
    review: taskReview, reviewSha256: hashes.taskReviewSha256, record: taskDispositionDecision,
  });
  const projectLinkVerification = verifyNotionBonsaiNativeProjectLinkDecision({
    review: nativeProjectReview, reviewSha256: hashes.nativeProjectReviewSha256, record: projectLinkDecision,
  });
  const projectDispositionVerification = verifyNotionBonsaiProjectDispositionDecision({
    review: nativeProjectReview, reviewSha256: hashes.nativeProjectReviewSha256,
    projectLinkDecision, projectLinkDecisionSha256: hashes.projectLinkDecisionSha256,
    record: projectDispositionDecision,
  });
  const activeProjectDispositionVerification = verifyBonsaiActiveProjectDispositionDecision({
    triage: activeProjectTriage, triageSha256: hashes.activeProjectTriageSha256,
    financialReview, financialReviewSha256: hashes.financialReviewSha256,
    nativeProjectReview, nativeProjectReviewSha256: hashes.nativeProjectReviewSha256,
    projectLinkDecision, projectLinkDecisionSha256: hashes.projectLinkDecisionSha256,
    projectDispositionDecision, projectDispositionDecisionSha256: hashes.projectDispositionDecisionSha256,
    record: activeProjectDispositionDecision,
  });
  const financialExceptionVerification = verifyBonsaiFinancialExceptionDecision({
    financialReview, financialReviewSha256: hashes.financialReviewSha256,
    invoiceSnapshot, invoiceSnapshotSha256: hashes.invoiceSnapshotSha256,
    timeEntrySnapshot, timeEntrySnapshotSha256: hashes.timeEntrySnapshotSha256,
    record: financialExceptionDecision,
  });
  if (!mappingVerification.valid || !taskLinkVerification.valid || !taskDispositionVerification.valid || !ownerVerification.valid || !projectLinkVerification.valid || !projectDispositionVerification.valid || !activeProjectDispositionVerification.valid || !financialExceptionVerification.valid) {
    const failed = [
      !mappingVerification.valid ? `mapping:${mappingVerification.findings.join(',')}` : null,
      !taskLinkVerification.valid ? `task-link:${taskLinkVerification.findings.join(',')}` : null,
      !taskDispositionVerification.valid ? `task-disposition:${taskDispositionVerification.findings.join(',')}` : null,
      !ownerVerification.valid ? `owner:${ownerVerification.findings.join(',')}` : null,
      !projectLinkVerification.valid ? `project-link:${projectLinkVerification.findings.join(',')}` : null,
      !projectDispositionVerification.valid ? `project-disposition:${projectDispositionVerification.findings.join(',')}` : null,
      !activeProjectDispositionVerification.valid ? `active-project-disposition:${activeProjectDispositionVerification.findings.join(',')}` : null,
      !financialExceptionVerification.valid ? `financial-exception:${financialExceptionVerification.findings.join(',')}` : null,
    ].filter(Boolean).join(';');
    throw new TypeError(`A decision artifact failed source-bound verification (${failed})`);
  }

  const prepared = timestamp(preparedAt, 'preparedAt');
  const sourceTimes = [taskReview, mappingDecision, taskLinkDecision, taskDispositionDecision, ownerDecision, nativeProjectReview, projectLinkDecision, projectDispositionDecision, activeProjectTriage, financialReview, activeProjectDispositionDecision]
    .map((document, index) => timestamp(document?.preparedAt, `source preparedAt ${index}`));
  sourceTimes.push(timestamp(invoiceSnapshot?.capturedAt, 'invoice capturedAt'));
  sourceTimes.push(timestamp(timeEntrySnapshot?.capturedAt, 'time-entry capturedAt'));
  sourceTimes.push(timestamp(financialExceptionDecision?.preparedAt, 'financial exception preparedAt'));
  if (sourceTimes.some(value => prepared < value)) throw new TypeError('preparedAt must not predate source evidence');

  const sourceReviewTasks = summaryNumber(taskReview, 'bonsaiSourceReview', 'Task review');
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
  if (taskLinkVerification.pending > 0) findings.push('TASK_LINK_DECISIONS_PENDING');
  if (mappingVerification.pending > 0) findings.push('TASK_MAPPING_DECISIONS_PENDING');
  if (ownerVerification.pending > 0) findings.push('TASK_OWNER_DECISIONS_PENDING');
  if (projectLinkVerification.pending > 0) findings.push('PROJECT_LINK_DECISIONS_PENDING');
  if (taskDispositionVerification.pending > 0) findings.push('TASK_DISPOSITION_DECISIONS_PENDING');
  if (projectDispositionVerification.pending > 0) findings.push('PROJECT_DISPOSITION_DECISIONS_PENDING');
  if (activeProjectDispositionVerification.pending > 0) findings.push('ACTIVE_PROJECT_DISPOSITIONS_PENDING');
  if (financialExceptionVerification.pending > 0) findings.push('FINANCIAL_EXCEPTION_DECISIONS_PENDING');
  if (financialExceptionVerification.actionRequired > 0) findings.push('FINANCIAL_EXCEPTION_ACTIONS_PENDING');
  findings.push('DIRECT_PAYMENT_EVIDENCE_MISSING');
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
        state: 'BLOCKED', exactTaskLinksWithoutDecisionRecord: 0,
        taskLinkDecisionsPending: taskLinkVerification.pending,
        taskDispositionDecisionsPending: taskDispositionVerification.pending,
        mappingDecisionsPending: mappingVerification.pending, sourceReviewTasks,
        notionOnlyTasks, bonsaiOnlyTasks,
      },
      taskOwnership: { state: 'BLOCKED', decisionsPending: ownerVerification.pending },
      projectIdentity: {
        state: 'BLOCKED', decisionsPending: projectLinkVerification.pending,
        projectDispositionDecisionsPending: projectDispositionVerification.pending,
        unmatchedNotionProjects, unmatchedBonsaiProjects, duplicateBonsaiTitles,
      },
      activeProjectDisposition: {
        state: 'BLOCKED', activeProjects, decisionsPending: activeProjectDispositionVerification.pending,
        closureAuthorizedProjects,
      },
      financialSafety: {
        state: 'BLOCKED', projectsWithNonPaidInvoices, projectsWithUnbilledTime,
        projectlessTimeEntries, exceptionDecisionsPending: financialExceptionVerification.pending,
        exceptionActionsPending: financialExceptionVerification.actionRequired,
        contractEvidenceGaps: financialExceptionVerification.byExceptionKind.ACTIVE_PROJECT_CONTRACT_GAP,
        directPaymentEvidenceComplete: false, contractEvidenceComplete: financialExceptionVerification.complete,
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
      invoiceSnapshotSha256: hashes.invoiceSnapshotSha256,
      timeEntrySnapshotSha256: hashes.timeEntrySnapshotSha256,
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
