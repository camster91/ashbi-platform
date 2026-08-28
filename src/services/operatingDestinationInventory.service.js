const FORMAT = 'ashbi-operating-destination-inventory';
const VERSION = 1;
const PROJECT_STATUSES = new Set(['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED', 'ON_HOLD', 'CANCELLED']);
const TASK_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']);
const SOURCE_SYSTEMS = new Set(['NOTION', 'BONSAI']);
const ENTITY_TYPES = new Set(['PROJECT', 'TASK']);
const DESTINATION_OUTCOMES = new Set(['IMPORTED', 'LINKED']);
const SOURCE_ONLY_OUTCOMES = new Set(['RETAINED_SOURCE', 'EXCLUDED', 'REPAIR_REQUIRED']);
const HASH = /^[a-f0-9]{64}$/i;

const SAFEGUARDS = Object.freeze({
  clientNamesExcluded: true,
  clientContactDataExcluded: true,
  descriptionsAndMessagesExcluded: true,
  credentialsExcluded: true,
  financialDataExcluded: true,
  sourceContentExcluded: true,
});

function text(value) { return String(value ?? '').trim(); }
function sha256(value) { return HASH.test(String(value ?? '')) ? String(value).toLowerCase() : null; }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function finding(findings, code, details = {}) {
  const value = { code, ...details };
  if (!findings.some(item => JSON.stringify(item) === JSON.stringify(value))) findings.push(value);
}
function byId(left, right) { return String(left.id).localeCompare(String(right.id)); }
function bySource(left, right) {
  return `${left.sourceSystem}:${left.entityType}:${left.sourceId}`
    .localeCompare(`${right.sourceSystem}:${right.entityType}:${right.sourceId}`);
}

function canonicalize({ organizationId, capturedAt, clients = [], projects = [], tasks = [], sourceRecords = [] }) {
  const captured = Date.parse(String(capturedAt ?? ''));
  const tenant = text(organizationId);
  const clientRows = clients.map(row => ({ id: text(row?.id), organizationId: text(row?.organizationId) })).sort(byId);
  const projectRows = projects.map(row => ({
    id: text(row?.id), organizationId: text(row?.organizationId), clientId: text(row?.clientId),
    name: text(row?.name), status: text(row?.status),
  })).sort(byId);
  const taskRows = tasks.map(row => ({
    id: text(row?.id), organizationId: text(row?.organizationId), projectId: text(row?.projectId),
    title: text(row?.title), status: text(row?.status),
  })).sort(byId);
  const registryRows = sourceRecords.map(row => ({
    organizationId: text(row?.organizationId), sourceSystem: text(row?.sourceSystem),
    entityType: text(row?.entityType), sourceId: text(row?.sourceId),
    destinationId: row?.destinationId == null ? null : text(row.destinationId), outcome: text(row?.outcome),
    sourceFingerprint: sha256(row?.sourceFingerprint) ?? text(row?.sourceFingerprint),
    decisionCandidateId: row?.decisionCandidateId == null ? null : text(row.decisionCandidateId),
    decisionFingerprint: row?.decisionFingerprint == null ? null : (sha256(row.decisionFingerprint) ?? text(row.decisionFingerprint)),
  })).sort(bySource);
  return {
    format: FORMAT,
    version: VERSION,
    complete: true,
    capturedAt: Number.isFinite(captured) ? new Date(captured).toISOString() : null,
    organizationId: tenant,
    clients: clientRows,
    projects: projectRows,
    tasks: taskRows,
    sourceRecords: registryRows,
    summary: {
      clients: clientRows.length,
      projects: projectRows.length,
      tasks: taskRows.length,
      sourceRecords: registryRows.length,
    },
    privacySafeguards: { ...SAFEGUARDS },
  };
}

export function verifyOperatingDestinationInventory(record) {
  const findings = [];
  const rootKeys = ['format', 'version', 'complete', 'capturedAt', 'organizationId', 'clients', 'projects', 'tasks', 'sourceRecords', 'summary', 'privacySafeguards'];
  if (!exactKeys(record, rootKeys) || record?.format !== FORMAT || record?.version !== VERSION || record?.complete !== true) {
    finding(findings, 'INVALID_INVENTORY_SCHEMA');
  }
  const organizationId = text(record?.organizationId);
  if (!organizationId) finding(findings, 'ORGANIZATION_ID_REQUIRED');
  const captured = Date.parse(String(record?.capturedAt ?? ''));
  if (!Number.isFinite(captured) || new Date(captured).toISOString() !== record?.capturedAt) finding(findings, 'INVALID_CAPTURED_AT');
  const collections = ['clients', 'projects', 'tasks', 'sourceRecords'];
  for (const name of collections) if (!Array.isArray(record?.[name])) finding(findings, 'INVALID_INVENTORY_COLLECTION', { collection: name });

  const clients = new Map();
  for (const row of Array.isArray(record?.clients) ? record.clients : []) {
    if (!exactKeys(row, ['id', 'organizationId']) || !text(row?.id) || row?.organizationId !== organizationId || clients.has(row.id)) {
      finding(findings, 'INVALID_CLIENT_IDENTITY', { destinationId: text(row?.id) || null });
    }
    clients.set(row.id, row);
  }
  const projects = new Map();
  for (const row of Array.isArray(record?.projects) ? record.projects : []) {
    if (!exactKeys(row, ['id', 'organizationId', 'clientId', 'name', 'status']) || !text(row?.id)
      || row?.organizationId !== organizationId || !clients.has(row?.clientId) || !text(row?.name)
      || !PROJECT_STATUSES.has(row?.status) || projects.has(row.id)) {
      finding(findings, 'INVALID_PROJECT_IDENTITY', { destinationId: text(row?.id) || null });
    }
    projects.set(row.id, row);
  }
  const tasks = new Map();
  for (const row of Array.isArray(record?.tasks) ? record.tasks : []) {
    if (!exactKeys(row, ['id', 'organizationId', 'projectId', 'title', 'status']) || !text(row?.id)
      || row?.organizationId !== organizationId || !projects.has(row?.projectId) || !text(row?.title)
      || !TASK_STATUSES.has(row?.status) || tasks.has(row.id)) {
      finding(findings, 'INVALID_TASK_IDENTITY', { destinationId: text(row?.id) || null });
    }
    tasks.set(row.id, row);
  }
  const sourceKeys = new Set();
  for (const row of Array.isArray(record?.sourceRecords) ? record.sourceRecords : []) {
    const sourceKey = `${row?.sourceSystem}:${row?.entityType}:${text(row?.sourceId)}`;
    const destinationOutcomes = DESTINATION_OUTCOMES.has(row?.outcome);
    const sourceOnlyOutcomes = SOURCE_ONLY_OUTCOMES.has(row?.outcome);
    const destination = row?.entityType === 'PROJECT' ? projects.get(row?.destinationId) : tasks.get(row?.destinationId);
    if (!exactKeys(row, ['organizationId', 'sourceSystem', 'entityType', 'sourceId', 'destinationId', 'outcome', 'sourceFingerprint', 'decisionCandidateId', 'decisionFingerprint'])
      || row?.organizationId !== organizationId || !SOURCE_SYSTEMS.has(row?.sourceSystem) || !ENTITY_TYPES.has(row?.entityType)
      || !text(row?.sourceId) || sourceKeys.has(sourceKey) || !sha256(row?.sourceFingerprint)
      || (!destinationOutcomes && !sourceOnlyOutcomes)
      || (destinationOutcomes && (!text(row?.destinationId) || !destination))
      || (sourceOnlyOutcomes && row?.destinationId !== null)
      || (row?.decisionCandidateId !== null && !text(row?.decisionCandidateId))
      || (row?.decisionFingerprint !== null && !sha256(row?.decisionFingerprint))) {
      finding(findings, 'INVALID_SOURCE_IDENTITY', { sourceKey });
    }
    sourceKeys.add(sourceKey);
  }

  const expectedSummary = {
    clients: Array.isArray(record?.clients) ? record.clients.length : 0,
    projects: Array.isArray(record?.projects) ? record.projects.length : 0,
    tasks: Array.isArray(record?.tasks) ? record.tasks.length : 0,
    sourceRecords: Array.isArray(record?.sourceRecords) ? record.sourceRecords.length : 0,
  };
  if (!exactKeys(record?.summary, Object.keys(expectedSummary)) || JSON.stringify(record?.summary) !== JSON.stringify(expectedSummary)) {
    finding(findings, 'INVALID_INVENTORY_SUMMARY');
  }
  if (!exactKeys(record?.privacySafeguards, Object.keys(SAFEGUARDS))
    || JSON.stringify(record?.privacySafeguards) !== JSON.stringify(SAFEGUARDS)) {
    finding(findings, 'INVALID_PRIVACY_SAFEGUARDS');
  }
  if (findings.length === 0) {
    const expected = canonicalize(record);
    if (JSON.stringify(record) !== JSON.stringify(expected)) finding(findings, 'NON_CANONICAL_INVENTORY');
  }
  return { valid: findings.length === 0, organizationId: organizationId || null, summary: expectedSummary, findings };
}

export function buildOperatingDestinationInventory(input) {
  const record = canonicalize(input);
  const verification = verifyOperatingDestinationInventory(record);
  if (!verification.valid) {
    const error = new Error(`Operating destination inventory is invalid: ${verification.findings.map(item => item.code).join(', ')}`);
    error.findings = verification.findings;
    throw error;
  }
  return record;
}

export async function captureOperatingDestinationInventory({ prisma, organizationId, capturedAt }) {
  const tenant = text(organizationId);
  if (!prisma || !tenant) throw new Error('A Prisma transaction and organization ID are required.');
  const organization = await prisma.organization.findUnique({
    where: { id: tenant },
    select: { id: true },
  });
  if (!organization) throw new Error('The bound sandbox organization does not exist.');
  const clients = await prisma.client.findMany({
    where: { organizationId: tenant, deletedAt: null },
    select: { id: true, organizationId: true },
  });
  const projects = await prisma.project.findMany({
    where: { organizationId: tenant, deletedAt: null },
    select: { id: true, organizationId: true, clientId: true, name: true, status: true },
  });
  const taskRows = await prisma.task.findMany({
    where: { deletedAt: null, project: { organizationId: tenant, deletedAt: null } },
    select: { id: true, projectId: true, title: true, status: true },
  });
  const sourceRecords = await prisma.operatingSourceRecord.findMany({
    where: { organizationId: tenant },
    select: {
      organizationId: true, sourceSystem: true, entityType: true, sourceId: true,
      destinationId: true, outcome: true, sourceFingerprint: true,
      decisionCandidateId: true, decisionFingerprint: true,
    },
  });
  return buildOperatingDestinationInventory({
    organizationId: tenant,
    capturedAt,
    clients,
    projects,
    tasks: taskRows.map(row => ({ ...row, organizationId: tenant })),
    sourceRecords,
  });
}

export { FORMAT as OPERATING_DESTINATION_INVENTORY_FORMAT };
