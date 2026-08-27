import crypto from 'node:crypto';

export const WORKSPACE_EXPORT_COLLECTIONS = Object.freeze([
  'clients', 'contacts', 'projects', 'tasks', 'notes', 'milestones',
]);
export const WORKSPACE_EXPORT_V3_COLLECTIONS = Object.freeze([
  ...WORKSPACE_EXPORT_COLLECTIONS, 'users', 'timeEntries', 'expenses',
]);

export function workspaceExportCollections(version) {
  return version === 3 ? WORKSPACE_EXPORT_V3_COLLECTIONS : WORKSPACE_EXPORT_COLLECTIONS;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function collectionRecords(records, collection) {
  return Array.isArray(records?.[collection]) ? records[collection] : [];
}

export function buildWorkspaceExportManifest(records, { version = 2 } = {}) {
  const includedCollections = workspaceExportCollections(version);
  const collections = Object.fromEntries(includedCollections.map((collection) => {
    const entries = collectionRecords(records, collection);
    return [collection, { count: entries.length, sha256: sha256(entries) }];
  }));
  return {
    version: 1,
    collections,
    recordsSha256: sha256(Object.fromEntries(includedCollections.map((collection) => [collection, collectionRecords(records, collection)]))),
  };
}

function ids(records, collection) {
  return new Set(collectionRecords(records, collection).map((record) => record?.id).filter((id) => typeof id === 'string'));
}

function verifyUniqueIds(findings, records, collections) {
  for (const collection of collections) {
    const seen = new Set();
    for (const record of collectionRecords(records, collection)) {
      if (typeof record?.id !== 'string') continue;
      if (seen.has(record.id)) {
        findings.push({ code: 'DUPLICATE_RECORD_ID', collection, id: record.id });
      } else {
        seen.add(record.id);
      }
    }
  }
}

function verifyReference(findings, records, collection, field, ownerCode, parentCollection) {
  const allowed = ids(records, parentCollection);
  for (const record of collectionRecords(records, collection)) {
    const value = record?.[field];
    if (typeof value === 'string' && !allowed.has(value)) {
      findings.push({ code: ownerCode, id: record.id, [field]: value });
    }
  }
}

export function verifyWorkspaceExport(exportPayload) {
  const records = exportPayload?.records;
  const findings = [];
  if (exportPayload?.format !== 'ashbi-workspace-export' || ![2, 3].includes(exportPayload?.version) || !records || typeof records !== 'object') {
    return { valid: false, findings: [{ code: 'EXPORT_FORMAT_INVALID' }], manifest: null };
  }

  const collections = workspaceExportCollections(exportPayload.version);
  const expectedManifest = buildWorkspaceExportManifest(records, { version: exportPayload.version });
  for (const collection of collections) {
    const actual = exportPayload.manifest?.collections?.[collection];
    const expected = expectedManifest.collections[collection];
    if (!actual || actual.count !== expected.count || actual.sha256 !== expected.sha256) {
      findings.push({ code: 'MANIFEST_MISMATCH', collection });
    }
  }
  if (findings.length === 0 && exportPayload.manifest?.recordsSha256 !== expectedManifest.recordsSha256) {
    findings.push({ code: 'RECORDS_CHECKSUM_MISMATCH' });
  }

  verifyUniqueIds(findings, records, collections);
  verifyReference(findings, records, 'contacts', 'clientId', 'CONTACT_CLIENT_MISSING', 'clients');
  verifyReference(findings, records, 'projects', 'clientId', 'PROJECT_CLIENT_MISSING', 'clients');
  verifyReference(findings, records, 'tasks', 'projectId', 'TASK_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'notes', 'projectId', 'NOTE_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'milestones', 'projectId', 'MILESTONE_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'tasks', 'parentId', 'TASK_PARENT_MISSING', 'tasks');
  verifyReference(findings, records, 'notes', 'parentId', 'NOTE_PARENT_MISSING', 'notes');
  if (exportPayload.version === 3) {
    verifyReference(findings, records, 'timeEntries', 'projectId', 'TIME_ENTRY_PROJECT_MISSING', 'projects');
    verifyReference(findings, records, 'timeEntries', 'userId', 'TIME_ENTRY_USER_MISSING', 'users');
    verifyReference(findings, records, 'timeEntries', 'taskId', 'TIME_ENTRY_TASK_MISSING', 'tasks');
    verifyReference(findings, records, 'expenses', 'clientId', 'EXPENSE_CLIENT_MISSING', 'clients');
    verifyReference(findings, records, 'expenses', 'projectId', 'EXPENSE_PROJECT_MISSING', 'projects');
    const tasksById = new Map(collectionRecords(records, 'tasks').map(task => [task.id, task]));
    for (const timeEntry of collectionRecords(records, 'timeEntries')) {
      const task = tasksById.get(timeEntry.taskId);
      if (task && task.projectId !== timeEntry.projectId) {
        findings.push({ code: 'TIME_ENTRY_TASK_PROJECT_MISMATCH', id: timeEntry.id, taskId: timeEntry.taskId, projectId: timeEntry.projectId });
      }
    }
    const projectsById = new Map(collectionRecords(records, 'projects').map(project => [project.id, project]));
    for (const expense of collectionRecords(records, 'expenses')) {
      const project = projectsById.get(expense.projectId);
      if (project && typeof expense.clientId === 'string' && project.clientId !== expense.clientId) {
        findings.push({ code: 'EXPENSE_PROJECT_CLIENT_MISMATCH', id: expense.id, projectId: expense.projectId, clientId: expense.clientId });
      }
      if (expense.organizationId !== exportPayload.organization?.id) {
        findings.push({ code: 'EXPENSE_ORGANIZATION_MISMATCH', id: expense.id, organizationId: expense.organizationId });
      }
    }
  }

  return { valid: findings.length === 0, findings, manifest: expectedManifest };
}
