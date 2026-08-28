import {
  captureOperatingDestinationInventory,
  verifyOperatingDestinationInventory,
} from './operatingDestinationInventory.service.js';

const PLAN_FORMAT = 'ashbi-notion-operating-migration-plan';
const PROJECT_STATUSES = new Set(['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED', 'ON_HOLD', 'CANCELLED']);
const TASK_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']);
const REGISTRY_OUTCOMES = new Set(['IMPORTED', 'LINKED', 'RETAINED_SOURCE', 'EXCLUDED', 'REPAIR_REQUIRED']);
const HASH = /^[a-f0-9]{64}$/i;

function text(value) { return String(value ?? '').trim(); }
function invalid(message) { throw new Error(`Notion operating migration refused: ${message}`); }

function validateExecutionInput({ plan, destinationInventory, organizationId, executedAt }) {
  const inventory = verifyOperatingDestinationInventory(destinationInventory);
  if (!inventory.valid) invalid('the destination inventory is invalid');
  if (plan?.format !== PLAN_FORMAT || plan?.version !== 1 || plan?.status !== 'READY') invalid('the reviewed plan is not READY');
  if (!Array.isArray(plan?.actions) || plan?.summary?.actions !== plan.actions.length) invalid('the plan action summary is inconsistent');
  if (!text(organizationId) || plan?.organizationId !== organizationId || destinationInventory.organizationId !== organizationId) {
    invalid('the plan, inventory, and selected organization differ');
  }
  const timestamp = Date.parse(String(executedAt ?? ''));
  if (!Number.isFinite(timestamp)) invalid('the execution timestamp is invalid');
  const actionIds = new Set();
  for (const action of plan.actions) {
    if (!text(action?.actionId) || actionIds.has(action.actionId)) invalid('the plan contains a duplicate or blank action ID');
    actionIds.add(action.actionId);
  }
  return new Date(timestamp);
}

function assertSnapshotUnchanged(expected, current) {
  if (JSON.stringify(expected) !== JSON.stringify(current)) invalid('the sandbox destination changed after the reviewed inventory was captured');
}

function assertProjectAction(action, organizationId, clientIds) {
  if (action?.kind !== 'CREATE_PROJECT' || action?.sourceSystem !== 'NOTION' || !text(action?.sourceId)
    || action?.values?.organizationId !== organizationId || !clientIds.has(action?.values?.clientId)
    || !text(action?.values?.name) || !PROJECT_STATUSES.has(action?.values?.status)) {
    invalid(`project action ${text(action?.actionId) || '(blank)'} is invalid`);
  }
}

function assertTaskAction(action) {
  const projectTargets = Number(Boolean(text(action?.projectId))) + Number(Boolean(text(action?.projectRef)));
  if (action?.kind !== 'CREATE_TASK' || action?.sourceSystem !== 'NOTION' || !text(action?.sourceId)
    || !text(action?.values?.title) || !TASK_STATUSES.has(action?.values?.status)
    || action?.values?.priority !== 'NORMAL' || projectTargets !== 1) {
    invalid(`task action ${text(action?.actionId) || '(blank)'} is invalid`);
  }
}

function assertRegistryAction(action) {
  const expectedKind = `REGISTER_${action?.entityType}_SOURCE`;
  const destinationOutcome = ['IMPORTED', 'LINKED'].includes(action?.outcome);
  const destinationTargets = Number(Boolean(text(action?.destinationId))) + Number(Boolean(text(action?.destinationRef)));
  if (action?.kind !== expectedKind || action?.sourceSystem !== 'NOTION' || !['PROJECT', 'TASK'].includes(action?.entityType)
    || !text(action?.sourceId) || !REGISTRY_OUTCOMES.has(action?.outcome) || !HASH.test(String(action?.sourceFingerprint ?? ''))
    || !text(action?.decisionCandidateId) || !HASH.test(String(action?.decisionFingerprint ?? ''))
    || (destinationOutcome && destinationTargets !== 1)
    || (!destinationOutcome && (action?.destinationId !== null || action?.destinationRef !== null))) {
    invalid(`source registration ${text(action?.actionId) || '(blank)'} is invalid`);
  }
}

export async function executeNotionOperatingMigrationPlan({
  prisma,
  plan,
  destinationInventory,
  organizationId,
  executedAt,
}) {
  if (!prisma?.$transaction) invalid('a database transaction boundary is required');
  const timestamp = validateExecutionInput({ plan, destinationInventory, organizationId, executedAt });
  const counts = { projectsCreated: 0, tasksCreated: 0, projectSourcesRegistered: 0, taskSourcesRegistered: 0 };
  await prisma.$transaction(async (tx) => {
    const current = await captureOperatingDestinationInventory({
      prisma: tx,
      organizationId,
      capturedAt: destinationInventory.capturedAt,
    });
    assertSnapshotUnchanged(destinationInventory, current);
    const clients = new Set(destinationInventory.clients.map(item => item.id));
    const projects = new Set(destinationInventory.projects.map(item => item.id));
    const tasks = new Set(destinationInventory.tasks.map(item => item.id));
    const destinationsByRef = new Map();
    for (const action of plan.actions) {
      if (action.kind === 'CREATE_PROJECT') {
        assertProjectAction(action, organizationId, clients);
        const created = await tx.project.create({
          data: {
            organizationId,
            clientId: action.values.clientId,
            name: action.values.name,
            status: action.values.status,
          },
          select: { id: true },
        });
        projects.add(created.id);
        destinationsByRef.set(action.actionId, { entityType: 'PROJECT', destinationId: created.id });
        counts.projectsCreated++;
      } else if (action.kind === 'CREATE_TASK') {
        assertTaskAction(action);
        const projectId = text(action.projectId) || destinationsByRef.get(action.projectRef)?.destinationId;
        if (!projectId || !projects.has(projectId)) invalid(`task action ${action.actionId} has no tenant-owned project`);
        const created = await tx.task.create({
          data: {
            projectId,
            title: action.values.title,
            status: action.values.status,
            priority: action.values.priority,
            properties: JSON.stringify({ migrationSource: action.values.sourceMetadata }),
          },
          select: { id: true },
        });
        tasks.add(created.id);
        destinationsByRef.set(action.actionId, { entityType: 'TASK', destinationId: created.id });
        counts.tasksCreated++;
      } else if (String(action.kind).startsWith('REGISTER_')) {
        assertRegistryAction(action);
        const referenced = text(action.destinationRef) ? destinationsByRef.get(action.destinationRef) : null;
        const destinationId = text(action.destinationId) || referenced?.destinationId || null;
        const destinationSet = action.entityType === 'PROJECT' ? projects : tasks;
        if (['IMPORTED', 'LINKED'].includes(action.outcome)
          && (!destinationId || !destinationSet.has(destinationId) || (referenced && referenced.entityType !== action.entityType))) {
          invalid(`source registration ${action.actionId} has no same-type tenant destination`);
        }
        await tx.operatingSourceRecord.create({
          data: {
            organizationId,
            sourceSystem: 'NOTION',
            entityType: action.entityType,
            sourceId: action.sourceId,
            destinationId,
            outcome: action.outcome,
            sourceFingerprint: action.sourceFingerprint,
            decisionCandidateId: action.decisionCandidateId,
            decisionFingerprint: action.decisionFingerprint,
            importedAt: ['IMPORTED', 'LINKED'].includes(action.outcome) ? timestamp : null,
          },
          select: { id: true },
        });
        if (action.entityType === 'PROJECT') counts.projectSourcesRegistered++;
        else counts.taskSourcesRegistered++;
      } else invalid(`unsupported action kind ${text(action.kind) || '(blank)'}`);
    }
  }, { isolationLevel: 'Serializable' });
  return {
    executedAt: timestamp.toISOString(),
    actionsApplied: plan.actions.length,
    ...counts,
    externalWritesPerformed: false,
    notionOrBonsaiRecordsChanged: false,
    ownersOrFinancialRecordsChanged: false,
  };
}
