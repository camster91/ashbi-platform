import { verifyBonsaiProjectSnapshot } from './bonsaiProjectSnapshot.service.js';

const ENTITY_TYPES = new Set(['PROJECT', 'TASK']);
const SHA256 = /^[0-9a-f]{64}$/;

function text(value) { return String(value ?? '').trim(); }
function normalized(value) { return text(value).toLowerCase().replace(/\s+/g, ' '); }

export function verifyBonsaiProjectCsvSnapshotBinding({ snapshot, snapshotSha256, projectRows }) {
  const findings = [];
  const verification = verifyBonsaiProjectSnapshot(snapshot);
  if (!verification.valid) findings.push({ code: 'INVALID_BONSAI_PROJECT_SNAPSHOT', findings: verification.integrityFindings });
  if (!SHA256.test(text(snapshotSha256).toLowerCase())) findings.push({ code: 'INVALID_PROJECT_SNAPSHOT_CHECKSUM' });
  if (!Array.isArray(projectRows)) findings.push({ code: 'PROJECT_CSV_ROWS_REQUIRED' });
  const snapshotById = new Map();
  for (const project of snapshot?.projects ?? []) snapshotById.set(String(project.id), project);
  const csvById = new Map();
  for (const [index, row] of (Array.isArray(projectRows) ? projectRows : []).entries()) {
    const sourceId = text(row?.project_id);
    if (!sourceId || csvById.has(sourceId)) {
      findings.push({ code: sourceId ? 'DUPLICATE_PROJECT_CSV_ID' : 'MISSING_PROJECT_CSV_ID', index, sourceId: sourceId || null });
      continue;
    }
    csvById.set(sourceId, row);
    const project = snapshotById.get(sourceId);
    if (!project) { findings.push({ code: 'PROJECT_CSV_ID_NOT_IN_SNAPSHOT', index, sourceId }); continue; }
    const differences = [];
    if (text(row.title) !== text(project.title)) differences.push('title');
    if (normalized(row.status) !== normalized(project.status)) differences.push('status');
    if (text(row.client_or_company_name) !== text(project.company_name)) differences.push('company');
    if (differences.length) findings.push({ code: 'PROJECT_CSV_SNAPSHOT_MISMATCH', index, sourceId, fields: differences });
  }
  for (const sourceId of snapshotById.keys()) {
    if (!csvById.has(sourceId)) findings.push({ code: 'PROJECT_SNAPSHOT_ID_MISSING_FROM_CSV', sourceId });
  }
  return {
    valid: findings.length === 0,
    snapshotSha256: SHA256.test(text(snapshotSha256).toLowerCase()) ? text(snapshotSha256).toLowerCase() : null,
    snapshotProjects: snapshotById.size,
    csvProjects: csvById.size,
    findings,
  };
}

export function assessBonsaiOperatingSourceRecord({
  organizationId, entityType, sourceId, destinationId, sourceFingerprint, existingRecord = null,
}) {
  const expected = {
    organizationId: text(organizationId), sourceSystem: 'BONSAI', entityType: text(entityType),
    sourceId: text(sourceId), destinationId: text(destinationId), outcome: 'IMPORTED',
    sourceFingerprint: text(sourceFingerprint).toLowerCase(), decisionCandidateId: null, decisionFingerprint: null,
  };
  const findings = [];
  if (!expected.organizationId) findings.push('ORGANIZATION_ID_REQUIRED');
  if (!ENTITY_TYPES.has(expected.entityType)) findings.push('INVALID_ENTITY_TYPE');
  if (!expected.sourceId) findings.push('SOURCE_ID_REQUIRED');
  if (!expected.destinationId) findings.push('DESTINATION_ID_REQUIRED');
  if (!SHA256.test(expected.sourceFingerprint)) findings.push('INVALID_SOURCE_FINGERPRINT');
  if (existingRecord) {
    for (const field of Object.keys(expected)) {
      if ((existingRecord[field] ?? null) !== expected[field]) findings.push(`EXISTING_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}_MISMATCH`);
    }
  }
  return {
    ready: findings.length === 0,
    operation: findings.length > 0 ? 'CONFLICT' : existingRecord ? 'REUSE' : 'CREATE',
    record: expected,
    findings,
  };
}
