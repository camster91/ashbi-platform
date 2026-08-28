import { verifyNotionOperatingSnapshot } from './notionOperatingSnapshot.service.js';
import { verifyNotionBonsaiNativeProjectLinkDecision } from './notionBonsaiNativeProjectLinkDecision.service.js';
import { verifyNotionBonsaiProjectDispositionDecision } from './notionBonsaiProjectDispositionDecision.service.js';
import { verifyNotionBonsaiTaskLinkDecision } from './notionBonsaiTaskLinkDecision.service.js';
import { verifyNotionBonsaiTaskDispositionDecision } from './notionBonsaiTaskDispositionDecision.service.js';
import { verifyOperatingDestinationInventory } from './operatingDestinationInventory.service.js';

const FORMAT = 'ashbi-notion-operating-migration-plan';
const VERSION = 1;
const PROJECT_STATUSES = new Set(['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED', 'ON_HOLD', 'CANCELLED']);
const TASK_STATUS = Object.freeze({ 'To do': 'PENDING', Doing: 'IN_PROGRESS', Review: 'IN_PROGRESS', Done: 'COMPLETED' });

function text(value) { return String(value ?? '').trim(); }
function hash(value) { return /^[a-f0-9]{64}$/i.test(String(value ?? '')) ? String(value).toLowerCase() : null; }
function key(sourceSystem, entityType, sourceId) { return `${sourceSystem}:${entityType}:${text(sourceId)}`; }
function actionId(kind, sourceId) { return `${kind.toLowerCase()}:${encodeURIComponent(text(sourceId))}`; }
function uniqueFinding(findings, code, details = {}) {
  const value = { code, ...details };
  if (!findings.some(item => JSON.stringify(item) === JSON.stringify(value))) findings.push(value);
}

function decisionVerification(options, findings) {
  const snapshot = verifyNotionOperatingSnapshot(options.notionSnapshot);
  if (!snapshot.valid) uniqueFinding(findings, 'INVALID_NOTION_SNAPSHOT', { findings: snapshot.findings });
  const notionHash = hash(options.notionSnapshotSha256);
  if (!notionHash) uniqueFinding(findings, 'INVALID_NOTION_SNAPSHOT_CHECKSUM');
  if (options.taskReview?.sourceEvidence?.notionSnapshotSha256 !== notionHash
    || options.nativeProjectReview?.sourceEvidence?.notionSnapshotSha256 !== notionHash) {
    uniqueFinding(findings, 'NOTION_SNAPSHOT_BINDING_MISMATCH');
  }

  const projectLink = verifyNotionBonsaiNativeProjectLinkDecision({
    review: options.nativeProjectReview,
    reviewSha256: options.nativeProjectReviewSha256,
    record: options.projectLinkDecision,
  });
  if (!projectLink.valid) uniqueFinding(findings, 'INVALID_PROJECT_LINK_DECISION', { findings: projectLink.findings });
  else if (!projectLink.complete) uniqueFinding(findings, 'PENDING_PROJECT_LINK_DECISIONS', { count: projectLink.pending });

  const projectDisposition = verifyNotionBonsaiProjectDispositionDecision({
    review: options.nativeProjectReview,
    reviewSha256: options.nativeProjectReviewSha256,
    projectLinkDecision: options.projectLinkDecision,
    projectLinkDecisionSha256: options.projectLinkDecisionSha256,
    record: options.projectDispositionDecision,
  });
  if (!projectDisposition.valid) uniqueFinding(findings, 'INVALID_PROJECT_DISPOSITION_DECISION', { findings: projectDisposition.findings });
  else if (!projectDisposition.complete) uniqueFinding(findings, 'PENDING_PROJECT_DISPOSITIONS', { count: projectDisposition.pending });

  const mappingRequired = Boolean(options.taskLinkDecision?.sourceEvidence?.mappingDecisionSha256);
  const taskLink = verifyNotionBonsaiTaskLinkDecision({
    review: options.taskReview,
    reviewSha256: options.taskReviewSha256,
    record: options.taskLinkDecision,
    mappingDecision: mappingRequired ? options.mappingDecision : null,
    mappingDecisionSha256: mappingRequired ? options.mappingDecisionSha256 : null,
  });
  if (!taskLink.valid) uniqueFinding(findings, 'INVALID_TASK_LINK_DECISION', { findings: taskLink.findings });
  else if (!taskLink.complete) uniqueFinding(findings, 'PENDING_TASK_LINK_DECISIONS', { count: taskLink.pending });

  const taskDisposition = verifyNotionBonsaiTaskDispositionDecision({
    review: options.taskReview,
    reviewSha256: options.taskReviewSha256,
    taskLinkDecision: options.taskLinkDecision,
    taskLinkDecisionSha256: options.taskLinkDecisionSha256,
    mappingDecision: mappingRequired ? options.mappingDecision : null,
    mappingDecisionSha256: mappingRequired ? options.mappingDecisionSha256 : null,
    record: options.taskDispositionDecision,
  });
  if (!taskDisposition.valid) uniqueFinding(findings, 'INVALID_TASK_DISPOSITION_DECISION', { findings: taskDisposition.findings });
  else if (!taskDisposition.complete) uniqueFinding(findings, 'PENDING_TASK_DISPOSITIONS', { count: taskDisposition.pending });

  const hashes = {
    notionSnapshotSha256: notionHash,
    nativeProjectReviewSha256: hash(options.nativeProjectReviewSha256),
    projectLinkDecisionSha256: hash(options.projectLinkDecisionSha256),
    projectDispositionDecisionSha256: hash(options.projectDispositionDecisionSha256),
    taskReviewSha256: hash(options.taskReviewSha256),
    taskLinkDecisionSha256: hash(options.taskLinkDecisionSha256),
    taskDispositionDecisionSha256: hash(options.taskDispositionDecisionSha256),
    destinationInventorySha256: hash(options.destinationInventorySha256),
  };
  for (const [name, value] of Object.entries(hashes)) if (!value) uniqueFinding(findings, 'INVALID_ARTIFACT_CHECKSUM', { artifact: name });
  return hashes;
}

function inventory(options, findings) {
  const verification = verifyOperatingDestinationInventory(options.destinationInventory);
  if (!verification.valid) uniqueFinding(findings, 'INVALID_DESTINATION_INVENTORY', { findings: verification.findings });
  const organizationId = text(options.destinationInventory?.organizationId);
  if (!organizationId || text(options.organizationId) !== organizationId) uniqueFinding(findings, 'DESTINATION_INVENTORY_ORGANIZATION_MISMATCH');
  const records = new Map((options.destinationInventory?.sourceRecords ?? [])
    .map(record => [key(record?.sourceSystem, record?.entityType, record?.sourceId), record]));
  const clients = new Map((options.destinationInventory?.clients ?? []).map(client => [client.id, client]));
  const projects = new Map((options.destinationInventory?.projects ?? []).map(project => [project.id, project]));
  const tasks = new Map((options.destinationInventory?.tasks ?? []).map(task => [task.id, task]));
  return { organizationId, records, clients, projects, tasks };
}

function existingResolution({ sourceId, entityType, expectedOutcome, expectedDestinationId, sourceFingerprint, state, findings }) {
  const record = state.records.get(key('NOTION', entityType, sourceId));
  if (!record) return null;
  if (record.sourceFingerprint !== sourceFingerprint || record.outcome !== expectedOutcome
    || (expectedDestinationId !== undefined && record.destinationId !== expectedDestinationId)) {
    uniqueFinding(findings, 'SOURCE_REGISTRY_CONFLICT', { sourceSystem: 'NOTION', entityType, sourceId });
    return { conflict: true };
  }
  if (['IMPORTED', 'LINKED'].includes(expectedOutcome) && !text(record.destinationId)) {
    uniqueFinding(findings, 'SOURCE_REGISTRY_DESTINATION_REQUIRED', { entityType, sourceId });
    return { conflict: true };
  }
  return { destinationId: record.destinationId ?? null, existing: true };
}

function bonsaiDestination({ entityType, sourceId, fingerprint, state, findings }) {
  const record = state.records.get(key('BONSAI', entityType, sourceId));
  const destination = entityType === 'PROJECT' ? state.projects.get(record?.destinationId) : state.tasks.get(record?.destinationId);
  if (!record || !['IMPORTED', 'LINKED'].includes(record.outcome) || record.sourceFingerprint !== fingerprint || !destination) {
    uniqueFinding(findings, 'BONSAI_DESTINATION_NOT_PROVEN', { entityType, sourceId });
    return null;
  }
  return destination;
}

function registerAction(actions, { entityType, sourceId, outcome, destinationId = null, destinationRef = null,
  sourceFingerprint, decisionCandidateId, decisionFingerprint }) {
  actions.push({
    actionId: actionId(`register-${entityType}`, sourceId), kind: `REGISTER_${entityType}_SOURCE`,
    sourceSystem: 'NOTION', entityType, sourceId, outcome, destinationId, destinationRef,
    sourceFingerprint, decisionCandidateId, decisionFingerprint,
  });
}

function planProjects(options, hashes, state, actions, findings) {
  const projectRows = new Map((options.notionSnapshot?.projects ?? []).map(row => [row.url, row]));
  const projectBindings = options.notionProjectBindings ?? {};
  const resolutions = new Map();
  const candidates = (options.projectDispositionDecision?.candidates ?? []).filter(item => item.sourceKind === 'NOTION_PROJECT');
  for (const candidate of candidates) {
    const sourceId = candidate.notionSourceId;
    const row = projectRows.get(sourceId);
    if (!row) { uniqueFinding(findings, 'NOTION_PROJECT_MISSING', { sourceId }); continue; }
    if (candidate.disposition === 'RESOLVED_BY_APPROVED_LINK') {
      const link = (options.projectLinkDecision?.candidates ?? []).find(item => item.candidateId === candidate.projectLinkCandidateId
        && item.decision === 'APPROVED' && item.notionSourceId === sourceId);
      if (!link) { uniqueFinding(findings, 'APPROVED_PROJECT_LINK_MISSING', { sourceId }); continue; }
      const destination = bonsaiDestination({
        entityType: 'PROJECT', sourceId: String(link.bonsaiProjectId),
        fingerprint: options.nativeProjectReview?.sourceEvidence?.bonsaiProjectSnapshotSha256,
        state, findings,
      });
      if (!destination) continue;
      const existing = existingResolution({ sourceId, entityType: 'PROJECT', expectedOutcome: 'LINKED',
        expectedDestinationId: destination.id, sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (!existing) registerAction(actions, { entityType: 'PROJECT', sourceId, outcome: 'LINKED', destinationId: destination.id,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.projectDispositionDecisionSha256 });
      resolutions.set(sourceId, { destinationId: destination.id });
    } else if (candidate.disposition === 'MIGRATE_TO_HUB') {
      const binding = projectBindings[sourceId];
      if (!text(binding?.clientId) || !state.clients.has(binding?.clientId) || !PROJECT_STATUSES.has(binding?.status)) {
        uniqueFinding(findings, 'NOTION_PROJECT_BINDING_REQUIRED', { sourceId });
        continue;
      }
      const existing = existingResolution({ sourceId, entityType: 'PROJECT', expectedOutcome: 'IMPORTED',
        sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (existing?.conflict) continue;
      if (existing) {
        const destination = state.projects.get(existing.destinationId);
        if (!destination || destination.name !== row.Project || destination.clientId !== binding.clientId || destination.status !== binding.status) {
          uniqueFinding(findings, 'IMPORTED_PROJECT_DESTINATION_MISMATCH', { sourceId, destinationId: existing.destinationId });
        } else resolutions.set(sourceId, { destinationId: existing.destinationId });
        continue;
      }
      const createId = actionId('create-project', sourceId);
      actions.push({ actionId: createId, kind: 'CREATE_PROJECT', sourceSystem: 'NOTION', sourceId,
        values: { organizationId: state.organizationId, clientId: binding.clientId, name: row.Project, status: binding.status,
          sourceMetadata: { notionStatus: row.Status, notionCreatedTime: row.createdTime } } });
      registerAction(actions, { entityType: 'PROJECT', sourceId, outcome: 'IMPORTED', destinationRef: createId,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.projectDispositionDecisionSha256 });
      resolutions.set(sourceId, { destinationRef: createId });
    } else if (['RETAIN_NOTION_SOURCE', 'EXCLUDE_WITH_EVIDENCE'].includes(candidate.disposition)) {
      const outcome = candidate.disposition === 'RETAIN_NOTION_SOURCE' ? 'RETAINED_SOURCE' : 'EXCLUDED';
      const existing = existingResolution({ sourceId, entityType: 'PROJECT', expectedOutcome: outcome,
        expectedDestinationId: null, sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (!existing) registerAction(actions, { entityType: 'PROJECT', sourceId, outcome,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.projectDispositionDecisionSha256 });
    } else uniqueFinding(findings, 'UNSUPPORTED_NOTION_PROJECT_DISPOSITION', { sourceId, disposition: candidate.disposition });
  }
  if (candidates.length !== projectRows.size) uniqueFinding(findings, 'NOTION_PROJECT_COVERAGE_MISMATCH', { expected: projectRows.size, actual: candidates.length });
  return resolutions;
}

function planTasks(options, hashes, state, projectResolutions, actions, findings) {
  const taskRows = new Map((options.notionSnapshot?.tasks ?? []).map(row => [row.url, row]));
  const candidates = (options.taskDispositionDecision?.candidates ?? []).filter(item => item.sourceKind === 'NOTION_TASK');
  for (const candidate of candidates) {
    const sourceId = candidate.notionSourceId;
    const row = taskRows.get(sourceId);
    if (!row) { uniqueFinding(findings, 'NOTION_TASK_MISSING', { sourceId }); continue; }
    const relatedProjectId = (() => { try { return JSON.parse(row.Project)?.[0] ?? null; } catch { return null; } })();
    const project = projectResolutions.get(relatedProjectId);
    if (candidate.disposition === 'RESOLVED_BY_APPROVED_LINK') {
      const link = (options.taskLinkDecision?.candidates ?? []).find(item => item.candidateId === candidate.taskLinkCandidateId
        && item.decision === 'APPROVED' && item.notionSourceId === sourceId);
      if (!link) { uniqueFinding(findings, 'APPROVED_TASK_LINK_MISSING', { sourceId }); continue; }
      const destination = bonsaiDestination({ entityType: 'TASK', sourceId: link.bonsaiSourceId,
        fingerprint: options.taskReview?.sourceEvidence?.bonsaiSnapshotSha256, state, findings });
      if (!destination) continue;
      if (!project?.destinationId || destination.projectId !== project.destinationId) {
        uniqueFinding(findings, 'LINKED_TASK_PROJECT_MISMATCH', { sourceId, destinationId: destination.id });
        continue;
      }
      const existing = existingResolution({ sourceId, entityType: 'TASK', expectedOutcome: 'LINKED',
        expectedDestinationId: destination.id, sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (!existing) registerAction(actions, { entityType: 'TASK', sourceId, outcome: 'LINKED', destinationId: destination.id,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.taskDispositionDecisionSha256 });
    } else if (candidate.disposition === 'MIGRATE_TO_HUB') {
      if (!project || (!project.destinationId && !project.destinationRef)) {
        uniqueFinding(findings, 'TASK_PROJECT_DESTINATION_UNRESOLVED', { sourceId, projectSourceId: relatedProjectId });
        continue;
      }
      const existing = existingResolution({ sourceId, entityType: 'TASK', expectedOutcome: 'IMPORTED',
        sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (existing?.conflict) continue;
      if (existing) {
        const destination = state.tasks.get(existing.destinationId);
        const expectedProjectId = project.destinationId;
        if (!destination || !expectedProjectId || destination.projectId !== expectedProjectId
          || destination.title !== row.Task || destination.status !== TASK_STATUS[row.Status]) {
          uniqueFinding(findings, 'IMPORTED_TASK_DESTINATION_MISMATCH', { sourceId, destinationId: existing.destinationId });
        }
        continue;
      }
      const createId = actionId('create-task', sourceId);
      actions.push({ actionId: createId, kind: 'CREATE_TASK', sourceSystem: 'NOTION', sourceId,
        projectId: project.destinationId ?? null, projectRef: project.destinationRef ?? null,
        values: { title: row.Task, status: TASK_STATUS[row.Status], priority: 'NORMAL',
          sourceMetadata: { notionStatus: row.Status, notionCreatedTime: row.createdTime } } });
      registerAction(actions, { entityType: 'TASK', sourceId, outcome: 'IMPORTED', destinationRef: createId,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.taskDispositionDecisionSha256 });
    } else if (['RETAIN_NOTION_SOURCE', 'EXCLUDE_WITH_EVIDENCE'].includes(candidate.disposition)) {
      const outcome = candidate.disposition === 'RETAIN_NOTION_SOURCE' ? 'RETAINED_SOURCE' : 'EXCLUDED';
      const existing = existingResolution({ sourceId, entityType: 'TASK', expectedOutcome: outcome,
        expectedDestinationId: null, sourceFingerprint: hashes.notionSnapshotSha256, state, findings });
      if (!existing) registerAction(actions, { entityType: 'TASK', sourceId, outcome,
        sourceFingerprint: hashes.notionSnapshotSha256, decisionCandidateId: candidate.candidateId,
        decisionFingerprint: hashes.taskDispositionDecisionSha256 });
    } else uniqueFinding(findings, 'UNSUPPORTED_NOTION_TASK_DISPOSITION', { sourceId, disposition: candidate.disposition });
  }
  if (candidates.length !== taskRows.size) uniqueFinding(findings, 'NOTION_TASK_COVERAGE_MISMATCH', { expected: taskRows.size, actual: candidates.length });
}

export function prepareNotionOperatingMigrationPlan(options) {
  const findings = [];
  const hashes = decisionVerification(options, findings);
  const state = inventory(options, findings);
  const prepared = Date.parse(String(options.preparedAt ?? ''));
  if (!Number.isFinite(prepared)) uniqueFinding(findings, 'INVALID_PREPARED_AT');
  const actions = [];
  if (findings.length === 0) {
    const projectResolutions = planProjects(options, hashes, state, actions, findings);
    planTasks(options, hashes, state, projectResolutions, actions, findings);
  }
  if (findings.length > 0) actions.length = 0;
  return {
    format: FORMAT, version: VERSION, status: findings.length === 0 ? 'READY' : 'BLOCKED',
    preparedAt: Number.isFinite(prepared) ? new Date(prepared).toISOString() : null,
    organizationId: state.organizationId || null, actions,
    summary: {
      actions: actions.length,
      createProjects: actions.filter(item => item.kind === 'CREATE_PROJECT').length,
      createTasks: actions.filter(item => item.kind === 'CREATE_TASK').length,
      registerProjectSources: actions.filter(item => item.kind === 'REGISTER_PROJECT_SOURCE').length,
      registerTaskSources: actions.filter(item => item.kind === 'REGISTER_TASK_SOURCE').length,
      findings: findings.length,
    },
    findings,
    sourceEvidence: hashes,
    safeguards: {
      externalWritesPerformed: false, sourceRecordsChanged: false, projectsOrTasksChanged: false,
      ownerAssignmentsChanged: false, sourceRecordsDeleted: false, financialRecordsChanged: false,
      migrationOrCutoverAuthorized: false,
    },
  };
}

export function verifyNotionOperatingMigrationPlan({ record, ...options }) {
  let expected;
  try {
    expected = prepareNotionOperatingMigrationPlan({ ...options, preparedAt: record?.preparedAt });
  } catch {
    return { valid: false, ready: false, findings: ['INVALID_PLAN_SOURCE_EVIDENCE'] };
  }
  const findings = [];
  if (record?.format !== FORMAT || record?.version !== VERSION) findings.push('INVALID_PLAN_SCHEMA');
  if (JSON.stringify(record) !== JSON.stringify(expected)) findings.push('PLAN_MISMATCH');
  return {
    valid: findings.length === 0,
    ready: findings.length === 0 && expected.status === 'READY',
    actions: findings.length === 0 ? expected.actions.length : 0,
    findings,
  };
}

export { FORMAT as NOTION_OPERATING_MIGRATION_PLAN_FORMAT };
