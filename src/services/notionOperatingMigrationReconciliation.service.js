import { verifyOperatingDestinationInventory } from './operatingDestinationInventory.service.js';

const FORMAT = 'ashbi-notion-operating-migration-reconciliation';
const VERSION = 1;
const HASH = /^[a-f0-9]{64}$/i;

function text(value) { return String(value ?? '').trim(); }
function hash(value) { return HASH.test(String(value ?? '')) ? String(value).toLowerCase() : null; }
function time(value) { const parsed = Date.parse(String(value ?? '')); return Number.isFinite(parsed) ? parsed : null; }
function sourceKey(value) { return `${value?.sourceSystem}:${value?.entityType}:${text(value?.sourceId)}`; }
function finding(findings, code, details = {}) {
  const value = { code, ...details };
  if (!findings.some(item => JSON.stringify(item) === JSON.stringify(value))) findings.push(value);
}
function mapBy(rows, selector) { return new Map((Array.isArray(rows) ? rows : []).map(row => [selector(row), row])); }
function exactSubset(before, after, selector) {
  const later = mapBy(after, selector);
  return before.every(row => JSON.stringify(later.get(selector(row))) === JSON.stringify(row));
}

function resolveCreatedDestination({ createAction, registrationByRef, afterRecords, afterEntities, beforeEntities, entityType, findings }) {
  const registration = registrationByRef.get(createAction.actionId);
  const record = registration ? afterRecords.get(sourceKey(registration)) : null;
  const destination = record ? afterEntities.get(record.destinationId) : null;
  if (!registration || registration.entityType !== entityType || registration.sourceId !== createAction.sourceId
    || !record || beforeEntities.has(record.destinationId) || !destination) {
    finding(findings, 'CREATED_DESTINATION_NOT_PROVEN', { actionId: createAction.actionId });
    return null;
  }
  return { registration, record, destination };
}

export function prepareNotionOperatingMigrationReconciliation(options) {
  const findings = [];
  const beforeVerification = verifyOperatingDestinationInventory(options.beforeInventory);
  const afterVerification = verifyOperatingDestinationInventory(options.afterInventory);
  if (!beforeVerification.valid) finding(findings, 'INVALID_BEFORE_INVENTORY', { findings: beforeVerification.findings });
  if (!afterVerification.valid) finding(findings, 'INVALID_AFTER_INVENTORY', { findings: afterVerification.findings });
  const organizationId = text(options.organizationId);
  if (!organizationId || options.beforeInventory?.organizationId !== organizationId
    || options.afterInventory?.organizationId !== organizationId || options.plan?.organizationId !== organizationId
    || options.result?.organizationId !== organizationId) finding(findings, 'ORGANIZATION_MISMATCH');

  const hashes = {
    notionSnapshotSha256: hash(options.notionSnapshotSha256),
    beforeInventorySha256: hash(options.beforeInventorySha256),
    afterInventorySha256: hash(options.afterInventorySha256),
    planSha256: hash(options.planSha256),
    resultSha256: hash(options.resultSha256),
  };
  for (const [artifact, value] of Object.entries(hashes)) if (!value) finding(findings, 'INVALID_ARTIFACT_CHECKSUM', { artifact });
  const plan = options.plan ?? {};
  const result = options.result ?? {};
  if (plan.format !== 'ashbi-notion-operating-migration-plan' || plan.version !== 1 || plan.status !== 'READY'
    || !Array.isArray(plan.actions) || plan.summary?.actions !== plan.actions?.length || plan.findings?.length !== 0
    || plan.sourceEvidence?.notionSnapshotSha256 !== hashes.notionSnapshotSha256
    || plan.sourceEvidence?.destinationInventorySha256 !== hashes.beforeInventorySha256) {
    finding(findings, 'INVALID_READY_PLAN');
  }
  const executedAt = time(result.executedAt);
  const reconciledAt = time(options.reconciledAt);
  const beforeCapturedAt = time(options.beforeInventory?.capturedAt);
  const afterCapturedAt = time(options.afterInventory?.capturedAt);
  if (result.format !== 'ashbi-notion-operating-migration-result' || result.version !== 1 || result.status !== 'COMPLETED'
    || result.complete !== true || result.planSha256 !== hashes.planSha256 || result.result?.executedAt !== result.executedAt
    || result.result?.actionsApplied !== plan.actions?.length || result.sandboxTarget?.environmentKind !== 'sandbox'
    || !text(result.sandboxTarget?.targetFingerprint)) finding(findings, 'INVALID_EXECUTION_RESULT');
  if (beforeCapturedAt === null || executedAt === null || afterCapturedAt === null || reconciledAt === null
    || beforeCapturedAt > executedAt || executedAt > afterCapturedAt || afterCapturedAt > reconciledAt) {
    finding(findings, 'INVALID_EVIDENCE_TIMELINE');
  }

  const before = options.beforeInventory ?? {};
  const after = options.afterInventory ?? {};
  const beforeClients = mapBy(before.clients, item => item.id);
  const beforeProjects = mapBy(before.projects, item => item.id);
  const beforeTasks = mapBy(before.tasks, item => item.id);
  const beforeRecords = mapBy(before.sourceRecords, sourceKey);
  const afterProjects = mapBy(after.projects, item => item.id);
  const afterTasks = mapBy(after.tasks, item => item.id);
  const afterRecords = mapBy(after.sourceRecords, sourceKey);
  if (!exactSubset(before.clients ?? [], after.clients ?? [], item => item.id)
    || !exactSubset(before.projects ?? [], after.projects ?? [], item => item.id)
    || !exactSubset(before.tasks ?? [], after.tasks ?? [], item => item.id)
    || !exactSubset(before.sourceRecords ?? [], after.sourceRecords ?? [], sourceKey)) {
    finding(findings, 'BASELINE_DESTINATION_CHANGED');
  }
  const createProjects = (plan.actions ?? []).filter(item => item.kind === 'CREATE_PROJECT');
  const createTasks = (plan.actions ?? []).filter(item => item.kind === 'CREATE_TASK');
  const registrations = (plan.actions ?? []).filter(item => String(item.kind).startsWith('REGISTER_'));
  const supportedKinds = new Set(['CREATE_PROJECT', 'CREATE_TASK', 'REGISTER_PROJECT_SOURCE', 'REGISTER_TASK_SOURCE']);
  const actionIds = (plan.actions ?? []).map(item => text(item.actionId));
  const registrationKeys = registrations.map(sourceKey);
  const destinationRefs = registrations.filter(item => text(item.destinationRef)).map(item => item.destinationRef);
  if ((plan.actions ?? []).some(item => !supportedKinds.has(item.kind) || item.sourceSystem !== 'NOTION' || !text(item.sourceId))
    || actionIds.some(id => !id) || new Set(actionIds).size !== actionIds.length
    || new Set(registrationKeys).size !== registrationKeys.length
    || new Set(destinationRefs).size !== destinationRefs.length) {
    finding(findings, 'INVALID_PLAN_ACTIONS');
  }
  const registrationByRef = mapBy(registrations.filter(item => text(item.destinationRef)), item => item.destinationRef);
  const expectedNewProjectIds = new Set();
  const expectedNewTaskIds = new Set();
  const expectedNewSourceKeys = new Set(registrations.map(sourceKey));

  for (const action of registrations) {
    const record = afterRecords.get(sourceKey(action));
    const destinationId = text(action.destinationId) || record?.destinationId || null;
    if (!record || record.organizationId !== organizationId || record.outcome !== action.outcome
      || record.sourceFingerprint !== action.sourceFingerprint || record.decisionCandidateId !== action.decisionCandidateId
      || record.decisionFingerprint !== action.decisionFingerprint
      || (text(action.destinationId) && record.destinationId !== action.destinationId)
      || (['IMPORTED', 'LINKED'].includes(action.outcome) && !destinationId)
      || (!['IMPORTED', 'LINKED'].includes(action.outcome) && record.destinationId !== null)) {
      finding(findings, 'SOURCE_REGISTRATION_MISMATCH', { actionId: action.actionId });
    }
  }
  for (const action of createProjects) {
    const resolved = resolveCreatedDestination({ createAction: action, registrationByRef, afterRecords,
      afterEntities: afterProjects, beforeEntities: beforeProjects, entityType: 'PROJECT', findings });
    if (!resolved) continue;
    expectedNewProjectIds.add(resolved.destination.id);
    if (resolved.destination.organizationId !== organizationId || resolved.destination.clientId !== action.values?.clientId
      || resolved.destination.name !== action.values?.name || resolved.destination.status !== action.values?.status) {
      finding(findings, 'CREATED_PROJECT_MISMATCH', { actionId: action.actionId });
    }
  }
  for (const action of createTasks) {
    const resolved = resolveCreatedDestination({ createAction: action, registrationByRef, afterRecords,
      afterEntities: afterTasks, beforeEntities: beforeTasks, entityType: 'TASK', findings });
    if (!resolved) continue;
    expectedNewTaskIds.add(resolved.destination.id);
    const projectRegistration = text(action.projectRef) ? registrationByRef.get(action.projectRef) : null;
    const expectedProjectId = text(action.projectId) || afterRecords.get(sourceKey(projectRegistration))?.destinationId;
    if (resolved.destination.organizationId !== organizationId || resolved.destination.projectId !== expectedProjectId
      || resolved.destination.title !== action.values?.title || resolved.destination.status !== action.values?.status) {
      finding(findings, 'CREATED_TASK_MISMATCH', { actionId: action.actionId });
    }
  }

  const actualNewProjectIds = new Set((after.projects ?? []).filter(item => !beforeProjects.has(item.id)).map(item => item.id));
  const actualNewTaskIds = new Set((after.tasks ?? []).filter(item => !beforeTasks.has(item.id)).map(item => item.id));
  const actualNewSourceKeys = new Set((after.sourceRecords ?? []).filter(item => !beforeRecords.has(sourceKey(item))).map(sourceKey));
  const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));
  if (!sameSet(expectedNewProjectIds, actualNewProjectIds)) finding(findings, 'UNPLANNED_PROJECT_CHANGE');
  if (!sameSet(expectedNewTaskIds, actualNewTaskIds)) finding(findings, 'UNPLANNED_TASK_CHANGE');
  if (!sameSet(expectedNewSourceKeys, actualNewSourceKeys)) finding(findings, 'UNPLANNED_SOURCE_IDENTITY_CHANGE');
  if ((after.clients ?? []).length !== beforeClients.size) finding(findings, 'CLIENT_INVENTORY_CHANGED');

  const expectedCounts = {
    actionsApplied: plan.actions?.length ?? 0,
    projectsCreated: createProjects.length,
    tasksCreated: createTasks.length,
    projectSourcesRegistered: registrations.filter(item => item.entityType === 'PROJECT').length,
    taskSourcesRegistered: registrations.filter(item => item.entityType === 'TASK').length,
  };
  for (const [name, value] of Object.entries(expectedCounts)) {
    if (result.result?.[name] !== value) finding(findings, 'EXECUTION_COUNT_MISMATCH', { field: name });
  }
  if (result.result?.externalWritesPerformed !== false || result.result?.notionOrBonsaiRecordsChanged !== false
    || result.result?.ownersOrFinancialRecordsChanged !== false) finding(findings, 'INVALID_EXECUTION_SAFEGUARDS');

  return {
    format: FORMAT, version: VERSION, complete: findings.length === 0,
    status: findings.length === 0 ? 'RECONCILED' : 'BLOCKED', organizationId,
    reconciledAt: reconciledAt === null ? null : new Date(reconciledAt).toISOString(),
    sourceEvidence: { ...hashes, sandboxTargetFingerprint: text(result.sandboxTarget?.targetFingerprint) || null },
    summary: { ...expectedCounts, findings: findings.length },
    findings,
    safeguards: {
      externalWritesPerformed: false, sourceSystemsChanged: false, ownersChanged: false,
      financialRecordsChanged: false, cutoverAuthorized: false,
    },
  };
}

export function verifyNotionOperatingMigrationReconciliation({ record, ...options }) {
  const expected = prepareNotionOperatingMigrationReconciliation({ ...options, reconciledAt: record?.reconciledAt });
  const findings = [];
  if (record?.format !== FORMAT || record?.version !== VERSION) findings.push('INVALID_RECONCILIATION_SCHEMA');
  if (JSON.stringify(record) !== JSON.stringify(expected)) findings.push('RECONCILIATION_MISMATCH');
  return { valid: findings.length === 0, complete: findings.length === 0 && expected.complete, findings };
}

export { FORMAT as NOTION_OPERATING_MIGRATION_RECONCILIATION_FORMAT };
