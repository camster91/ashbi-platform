import crypto from 'node:crypto';

export const WORKSPACE_EXPORT_COLLECTIONS = Object.freeze([
  'clients', 'contacts', 'projects', 'tasks', 'notes', 'milestones',
]);

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

export function buildWorkspaceExportManifest(records) {
  const collections = Object.fromEntries(WORKSPACE_EXPORT_COLLECTIONS.map((collection) => {
    const entries = collectionRecords(records, collection);
    return [collection, { count: entries.length, sha256: sha256(entries) }];
  }));
  return {
    version: 1,
    collections,
    recordsSha256: sha256(Object.fromEntries(WORKSPACE_EXPORT_COLLECTIONS.map((collection) => [collection, collectionRecords(records, collection)]))),
  };
}

function ids(records, collection) {
  return new Set(collectionRecords(records, collection).map((record) => record?.id).filter((id) => typeof id === 'string'));
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
  if (exportPayload?.format !== 'ashbi-workspace-export' || exportPayload?.version !== 2 || !records || typeof records !== 'object') {
    return { valid: false, findings: [{ code: 'EXPORT_FORMAT_INVALID' }], manifest: null };
  }

  const expectedManifest = buildWorkspaceExportManifest(records);
  for (const collection of WORKSPACE_EXPORT_COLLECTIONS) {
    const actual = exportPayload.manifest?.collections?.[collection];
    const expected = expectedManifest.collections[collection];
    if (!actual || actual.count !== expected.count || actual.sha256 !== expected.sha256) {
      findings.push({ code: 'MANIFEST_MISMATCH', collection });
    }
  }
  if (findings.length === 0 && exportPayload.manifest?.recordsSha256 !== expectedManifest.recordsSha256) {
    findings.push({ code: 'RECORDS_CHECKSUM_MISMATCH' });
  }

  verifyReference(findings, records, 'contacts', 'clientId', 'CONTACT_CLIENT_MISSING', 'clients');
  verifyReference(findings, records, 'projects', 'clientId', 'PROJECT_CLIENT_MISSING', 'clients');
  verifyReference(findings, records, 'tasks', 'projectId', 'TASK_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'notes', 'projectId', 'NOTE_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'milestones', 'projectId', 'MILESTONE_PROJECT_MISSING', 'projects');
  verifyReference(findings, records, 'tasks', 'parentId', 'TASK_PARENT_MISSING', 'tasks');
  verifyReference(findings, records, 'notes', 'parentId', 'NOTE_PARENT_MISSING', 'notes');

  return { valid: findings.length === 0, findings, manifest: expectedManifest };
}
