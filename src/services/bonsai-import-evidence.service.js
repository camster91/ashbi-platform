import crypto from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function fingerprintInputInventory(inventory) {
  const evidence = inventory
    .map(file => ({ filename: file.filename, present: file.present, rows: file.rows, sha256: file.sha256 || null }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  return sha256Json(evidence);
}

export function fingerprintBonsaiPlan({ sourceFingerprint, stats }) {
  return sha256Json({ sourceFingerprint, stats });
}

export function missingRequiredCsvHeaders(actualHeaders = [], requiredHeaders = []) {
  const actual = new Set(actualHeaders.map(header => String(header).trim()));
  return requiredHeaders.filter(header => !actual.has(header));
}

export function assertApprovedBonsaiDryRun(approved, current) {
  if (!approved || approved.mode !== 'dry-run') throw new Error('Approved Bonsai evidence must be a dry-run report');
  if (approved.organization?.id !== current.organizationId) throw new Error('Approved Bonsai report organization does not match');
  if (approved.sandboxTarget?.environmentKind !== 'sandbox'
    || !approved.sandboxTarget?.targetFingerprint
    || approved.sandboxTarget.targetFingerprint !== current.targetFingerprint) {
    throw new Error('Approved Bonsai report sandbox target does not match');
  }
  if (approved.complete !== true || approved.stats?.errors?.length !== 0) {
    throw new Error('Approved Bonsai dry run is incomplete or has unresolved findings');
  }
  if (!approved.sourceFingerprint || approved.sourceFingerprint !== current.sourceFingerprint) {
    throw new Error('Bonsai CSV source changed after the approved dry run');
  }
  if (!approved.planFingerprint || approved.planFingerprint !== current.planFingerprint) {
    throw new Error('Bonsai destination state or import plan changed after the approved dry run');
  }
  return true;
}

function evidenceValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim().toLowerCase();
  return value ?? null;
}

export function sourceDifferences(source, target, fields) {
  return fields.filter(field => {
    const incoming = source[field];
    if (incoming === '' || incoming === null || incoming === undefined) return false;
    return evidenceValue(incoming) !== evidenceValue(target[field]);
  });
}
