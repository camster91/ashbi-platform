import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperatingDestinationInventory } from '../../services/operatingDestinationInventory.service.js';
import {
  prepareNotionOperatingMigrationReconciliation,
  verifyNotionOperatingMigrationReconciliation,
} from '../../services/notionOperatingMigrationReconciliation.service.js';

const ORG = 'org-sandbox';
const HASH = Object.freeze({ notion: '1'.repeat(64), before: '2'.repeat(64), after: '3'.repeat(64), plan: '4'.repeat(64), result: '5'.repeat(64) });

function fixture() {
  const before = buildOperatingDestinationInventory({
    organizationId: ORG, capturedAt: '2026-08-28T13:00:00.000Z',
    clients: [{ id: 'client-1', organizationId: ORG }], projects: [], tasks: [], sourceRecords: [],
  });
  const plan = {
    format: 'ashbi-notion-operating-migration-plan', version: 1, status: 'READY', organizationId: ORG, findings: [],
    sourceEvidence: { notionSnapshotSha256: HASH.notion, destinationInventorySha256: HASH.before },
    actions: [
      { actionId: 'create-project:p1', kind: 'CREATE_PROJECT', sourceSystem: 'NOTION', sourceId: 'p1',
        values: { organizationId: ORG, clientId: 'client-1', name: 'Website', status: 'STARTING_UP' } },
      { actionId: 'register-project:p1', kind: 'REGISTER_PROJECT_SOURCE', sourceSystem: 'NOTION', entityType: 'PROJECT', sourceId: 'p1',
        outcome: 'IMPORTED', destinationId: null, destinationRef: 'create-project:p1', sourceFingerprint: HASH.notion,
        decisionCandidateId: 'project-candidate', decisionFingerprint: '6'.repeat(64) },
      { actionId: 'create-task:t1', kind: 'CREATE_TASK', sourceSystem: 'NOTION', sourceId: 't1', projectId: null,
        projectRef: 'create-project:p1', values: { title: 'Review', status: 'PENDING', priority: 'NORMAL' } },
      { actionId: 'register-task:t1', kind: 'REGISTER_TASK_SOURCE', sourceSystem: 'NOTION', entityType: 'TASK', sourceId: 't1',
        outcome: 'IMPORTED', destinationId: null, destinationRef: 'create-task:t1', sourceFingerprint: HASH.notion,
        decisionCandidateId: 'task-candidate', decisionFingerprint: '7'.repeat(64) },
    ],
    summary: { actions: 4 },
  };
  const after = buildOperatingDestinationInventory({
    organizationId: ORG, capturedAt: '2026-08-28T13:02:00.000Z',
    clients: before.clients,
    projects: [{ id: 'project-new', organizationId: ORG, clientId: 'client-1', name: 'Website', status: 'STARTING_UP' }],
    tasks: [{ id: 'task-new', organizationId: ORG, projectId: 'project-new', title: 'Review', status: 'PENDING' }],
    sourceRecords: [
      { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'PROJECT', sourceId: 'p1', destinationId: 'project-new', outcome: 'IMPORTED',
        sourceFingerprint: HASH.notion, decisionCandidateId: 'project-candidate', decisionFingerprint: '6'.repeat(64) },
      { organizationId: ORG, sourceSystem: 'NOTION', entityType: 'TASK', sourceId: 't1', destinationId: 'task-new', outcome: 'IMPORTED',
        sourceFingerprint: HASH.notion, decisionCandidateId: 'task-candidate', decisionFingerprint: '7'.repeat(64) },
    ],
  });
  const result = {
    format: 'ashbi-notion-operating-migration-result', version: 1, status: 'COMPLETED', complete: true,
    organizationId: ORG, executedAt: '2026-08-28T13:01:00.000Z', planSha256: HASH.plan,
    sandboxTarget: { environmentKind: 'sandbox', targetFingerprint: 'sandbox-target-1' },
    result: {
      executedAt: '2026-08-28T13:01:00.000Z', actionsApplied: 4, projectsCreated: 1, tasksCreated: 1,
      projectSourcesRegistered: 1, taskSourcesRegistered: 1, externalWritesPerformed: false,
      notionOrBonsaiRecordsChanged: false, ownersOrFinancialRecordsChanged: false,
    },
  };
  return {
    organizationId: ORG, notionSnapshotSha256: HASH.notion,
    beforeInventory: before, beforeInventorySha256: HASH.before,
    afterInventory: after, afterInventorySha256: HASH.after,
    plan, planSha256: HASH.plan, result, resultSha256: HASH.result,
    reconciledAt: '2026-08-28T13:03:00.000Z',
  };
}

test('reconciles exact planned additions while proving baseline preservation and bounded execution', () => {
  const input = fixture();
  const record = prepareNotionOperatingMigrationReconciliation(input);
  assert.equal(record.status, 'RECONCILED', JSON.stringify(record.findings));
  assert.equal(record.complete, true);
  assert.deepEqual(record.summary, {
    actionsApplied: 4, projectsCreated: 1, tasksCreated: 1,
    projectSourcesRegistered: 1, taskSourcesRegistered: 1, findings: 0,
  });
  assert.deepEqual(verifyNotionOperatingMigrationReconciliation({ ...input, record }), { valid: true, complete: true, findings: [] });
});

test('blocks unplanned destination additions, baseline changes, and execution count drift', () => {
  const input = fixture();
  input.afterInventory.clients[0].id = 'client-changed';
  input.afterInventory.summary.clients = 2;
  input.result.result.tasksCreated = 2;
  const record = prepareNotionOperatingMigrationReconciliation(input);
  assert.equal(record.status, 'BLOCKED');
  assert.ok(record.findings.some(item => item.code === 'INVALID_AFTER_INVENTORY'));
  assert.ok(record.findings.some(item => item.code === 'BASELINE_DESTINATION_CHANGED'));
  assert.ok(record.findings.some(item => item.code === 'EXECUTION_COUNT_MISMATCH'));
});

test('verification rejects a changed reconciliation claim', () => {
  const input = fixture();
  const record = prepareNotionOperatingMigrationReconciliation(input);
  record.summary.tasksCreated = 2;
  assert.deepEqual(verifyNotionOperatingMigrationReconciliation({ ...input, record }), {
    valid: false, complete: false, findings: ['RECONCILIATION_MISMATCH'],
  });
});
