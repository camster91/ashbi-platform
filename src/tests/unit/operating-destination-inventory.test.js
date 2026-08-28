import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOperatingDestinationInventory,
  verifyOperatingDestinationInventory,
} from '../../services/operatingDestinationInventory.service.js';

const ORG = 'org-sandbox';
const HASH = 'a'.repeat(64);

function inventory() {
  return buildOperatingDestinationInventory({
    organizationId: ORG,
    capturedAt: '2026-08-28T12:00:00.000Z',
    clients: [{ id: 'client-2', organizationId: ORG }, { id: 'client-1', organizationId: ORG }],
    projects: [{ id: 'project-1', organizationId: ORG, clientId: 'client-1', name: 'Website', status: 'DESIGN_DEV' }],
    tasks: [{ id: 'task-1', organizationId: ORG, projectId: 'project-1', title: 'Review', status: 'PENDING' }],
    sourceRecords: [
      { organizationId: ORG, sourceSystem: 'BONSAI', entityType: 'PROJECT', sourceId: '101', destinationId: 'project-1', outcome: 'IMPORTED', sourceFingerprint: HASH },
      { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'TASK', sourceId: 'notion-task', destinationId: null, outcome: 'RETAINED_SOURCE', sourceFingerprint: HASH, decisionCandidateId: 'candidate-1', decisionFingerprint: HASH },
    ],
  });
}

test('builds a deterministic, privacy-bounded destination inventory', () => {
  const record = inventory();
  assert.deepEqual(record.clients.map(item => item.id), ['client-1', 'client-2']);
  assert.deepEqual(record.summary, { clients: 2, projects: 1, tasks: 1, sourceRecords: 2 });
  assert.equal(record.privacySafeguards.clientContactDataExcluded, true);
  assert.deepEqual(verifyOperatingDestinationInventory(record), {
    valid: true,
    organizationId: ORG,
    summary: { clients: 2, projects: 1, tasks: 1, sourceRecords: 2 },
    findings: [],
  });
});

test('rejects extra private fields and a falsified safeguard', () => {
  const record = inventory();
  record.clients[0].email = 'private@example.test';
  record.privacySafeguards.clientContactDataExcluded = false;
  const result = verifyOperatingDestinationInventory(record);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some(item => item.code === 'INVALID_CLIENT_IDENTITY'));
  assert.ok(result.findings.some(item => item.code === 'INVALID_PRIVACY_SAFEGUARDS'));
});

test('rejects cross-tenant, orphaned, duplicate, and unsupported destination evidence', () => {
  const record = inventory();
  record.projects[0].organizationId = 'org-other';
  record.tasks[0].projectId = 'project-missing';
  record.clients.push({ ...record.clients[0] });
  record.sourceRecords[0].outcome = 'UNKNOWN';
  const result = verifyOperatingDestinationInventory(record);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some(item => item.code === 'INVALID_CLIENT_IDENTITY'));
  assert.ok(result.findings.some(item => item.code === 'INVALID_PROJECT_IDENTITY'));
  assert.ok(result.findings.some(item => item.code === 'INVALID_TASK_IDENTITY'));
  assert.ok(result.findings.some(item => item.code === 'INVALID_SOURCE_IDENTITY'));
});

test('requires imported identities to resolve to a same-type destination and source-only outcomes to omit one', () => {
  const imported = inventory();
  imported.sourceRecords[0].destinationId = 'task-1';
  assert.ok(verifyOperatingDestinationInventory(imported).findings.some(item => item.code === 'INVALID_SOURCE_IDENTITY'));

  const retained = inventory();
  retained.sourceRecords[1].destinationId = 'task-1';
  assert.ok(verifyOperatingDestinationInventory(retained).findings.some(item => item.code === 'INVALID_SOURCE_IDENTITY'));
});
