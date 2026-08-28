import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperatingDestinationInventory } from '../../services/operatingDestinationInventory.service.js';
import { executeNotionOperatingMigrationPlan } from '../../services/notionOperatingMigrationExecutor.service.js';

const ORG = 'org-sandbox';
const HASH = 'a'.repeat(64);

function fixture() {
  const clients = [{ id: 'client-1', organizationId: ORG }];
  const projects = [{ id: 'project-existing', organizationId: ORG, clientId: 'client-1', name: 'Existing', status: 'DESIGN_DEV' }];
  const tasks = [{ id: 'task-existing', organizationId: ORG, projectId: 'project-existing', title: 'Existing task', status: 'PENDING' }];
  const sourceRecords = [];
  const destinationInventory = buildOperatingDestinationInventory({
    organizationId: ORG,
    capturedAt: '2026-08-28T13:00:00.000Z',
    clients,
    projects,
    tasks,
    sourceRecords,
  });
  const plan = {
    format: 'ashbi-notion-operating-migration-plan', version: 1, status: 'READY', organizationId: ORG,
    actions: [
      { actionId: 'create-project:notion-project', kind: 'CREATE_PROJECT', sourceSystem: 'NOTION', sourceId: 'notion-project',
        values: { organizationId: ORG, clientId: 'client-1', name: 'New project', status: 'STARTING_UP', sourceMetadata: { notionStatus: 'Planning' } } },
      { actionId: 'register-project:notion-project', kind: 'REGISTER_PROJECT_SOURCE', sourceSystem: 'NOTION', entityType: 'PROJECT',
        sourceId: 'notion-project', outcome: 'IMPORTED', destinationId: null, destinationRef: 'create-project:notion-project',
        sourceFingerprint: HASH, decisionCandidateId: 'project-decision', decisionFingerprint: HASH },
      { actionId: 'create-task:notion-task', kind: 'CREATE_TASK', sourceSystem: 'NOTION', sourceId: 'notion-task',
        projectId: null, projectRef: 'create-project:notion-project',
        values: { title: 'New task', status: 'IN_PROGRESS', priority: 'NORMAL', sourceMetadata: { notionStatus: 'Review' } } },
      { actionId: 'register-task:notion-task', kind: 'REGISTER_TASK_SOURCE', sourceSystem: 'NOTION', entityType: 'TASK',
        sourceId: 'notion-task', outcome: 'IMPORTED', destinationId: null, destinationRef: 'create-task:notion-task',
        sourceFingerprint: HASH, decisionCandidateId: 'task-decision', decisionFingerprint: HASH },
    ],
    summary: { actions: 4 },
  };
  const writes = { projects: [], tasks: [], sourceRecords: [], isolationLevel: null };
  const tx = {
    organization: { findUnique: async () => ({ id: ORG }) },
    client: { findMany: async () => clients },
    project: {
      findMany: async () => projects,
      create: async (args) => { writes.projects.push(args); return { id: 'project-new' }; },
    },
    task: {
      findMany: async () => tasks.map(({ organizationId: _organizationId, ...task }) => task),
      create: async (args) => { writes.tasks.push(args); return { id: 'task-new' }; },
    },
    operatingSourceRecord: {
      findMany: async () => sourceRecords,
      create: async (args) => { writes.sourceRecords.push(args); return { id: `source-${writes.sourceRecords.length}` }; },
    },
  };
  const prisma = {
    $transaction: async (callback, options) => {
      writes.isolationLevel = options?.isolationLevel;
      return callback(tx);
    },
  };
  return { destinationInventory, plan, prisma, tx, writes };
}

test('applies a READY plan atomically with typed references and no external, owner, or financial writes', async () => {
  const value = fixture();
  const result = await executeNotionOperatingMigrationPlan({
    prisma: value.prisma,
    plan: value.plan,
    destinationInventory: value.destinationInventory,
    organizationId: ORG,
    executedAt: '2026-08-28T13:01:00.000Z',
  });
  assert.equal(value.writes.isolationLevel, 'Serializable');
  assert.equal(value.writes.projects[0].data.organizationId, ORG);
  assert.equal(value.writes.tasks[0].data.projectId, 'project-new');
  assert.deepEqual(JSON.parse(value.writes.tasks[0].data.properties), { migrationSource: { notionStatus: 'Review' } });
  assert.deepEqual(value.writes.sourceRecords.map(item => [item.data.entityType, item.data.destinationId]), [
    ['PROJECT', 'project-new'], ['TASK', 'task-new'],
  ]);
  assert.deepEqual(result, {
    executedAt: '2026-08-28T13:01:00.000Z', actionsApplied: 4,
    projectsCreated: 1, tasksCreated: 1, projectSourcesRegistered: 1, taskSourcesRegistered: 1,
    externalWritesPerformed: false, notionOrBonsaiRecordsChanged: false, ownersOrFinancialRecordsChanged: false,
  });
});

test('refuses all actions when the sandbox changed after inventory capture', async () => {
  const value = fixture();
  value.tx.client.findMany = async () => [
    { id: 'client-1', organizationId: ORG },
    { id: 'client-new', organizationId: ORG },
  ];
  await assert.rejects(() => executeNotionOperatingMigrationPlan({
    prisma: value.prisma,
    plan: value.plan,
    destinationInventory: value.destinationInventory,
    organizationId: ORG,
    executedAt: '2026-08-28T13:01:00.000Z',
  }), /changed after the reviewed inventory/i);
  assert.equal(value.writes.projects.length, 0);
  assert.equal(value.writes.tasks.length, 0);
  assert.equal(value.writes.sourceRecords.length, 0);
});

test('rejects a non-ready plan, tenant mismatch, and invalid same-type reference before writing', async () => {
  const blocked = fixture();
  blocked.plan.status = 'BLOCKED';
  await assert.rejects(() => executeNotionOperatingMigrationPlan({
    prisma: blocked.prisma, plan: blocked.plan, destinationInventory: blocked.destinationInventory,
    organizationId: ORG, executedAt: '2026-08-28T13:01:00.000Z',
  }), /not READY/i);

  const mismatched = fixture();
  await assert.rejects(() => executeNotionOperatingMigrationPlan({
    prisma: mismatched.prisma, plan: mismatched.plan, destinationInventory: mismatched.destinationInventory,
    organizationId: 'org-other', executedAt: '2026-08-28T13:01:00.000Z',
  }), /selected organization differ/i);

  const wrongReference = fixture();
  wrongReference.plan.actions[3].destinationRef = 'create-project:notion-project';
  await assert.rejects(() => executeNotionOperatingMigrationPlan({
    prisma: wrongReference.prisma, plan: wrongReference.plan, destinationInventory: wrongReference.destinationInventory,
    organizationId: ORG, executedAt: '2026-08-28T13:01:00.000Z',
  }), /same-type tenant destination/i);
});
