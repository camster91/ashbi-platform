import { z } from 'zod';
import { ToolError, recordNotFound, targetUnavailable } from '../ai/tools/registry.js';
import { taskRecurrenceUpdateSchema } from '../validators/schemas.js';
import { readTaskCollaborators, saveTaskCollaboratorsInTransaction } from '../services/task-collaborators.service.js';
import { saveTaskRecurrenceInTransaction } from '../services/task-recurrence.service.js';

const recordId = z.string().min(1).max(50);
const target = { taskId: recordId, projectId: recordId };
async function taskScope(prisma, user, input) {
  const task = await prisma.task.findFirst({ where: { id: input.taskId, projectId: input.projectId, deletedAt: null, project: { organizationId: user.organizationId, deletedAt: null } }, select: { id: true, title: true, projectId: true, assigneeId: true, recurrenceRule: true, recurrenceRevision: true, recurrenceSourceId: true } });
  if (!task) throw recordNotFound('Task not found');
  return task;
}
async function currentActor(prisma, user) {
  const actor = await prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, organizationId: true, role: true } });
  if (!actor) throw targetUnavailable();
  return actor;
}
async function collaboratorsScope({ prisma, user, input }) {
  const task = await taskScope(prisma, user, input);
  const current = await readTaskCollaborators(prisma, task.id, user);
  if (!current.canManage) throw new ToolError('FORBIDDEN', 'The owner or an administrator manages contributors', { statusCode: 403 });
  if (current.revision !== input.revision) throw targetUnavailable('Contributor revision changed');
  const known = new Map(current.collaborators.map(member => [member.id, member]));
  const added = input.userIds.filter(id => !known.has(id));
  const members = added.length ? await prisma.user.findMany({ where: { id: { in: added }, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true, name: true, isActive: true }, take: 30 }) : [];
  if (members.length !== added.length) throw recordNotFound('A selected teammate is unavailable');
  for (const member of members) known.set(member.id, member);
  return { ids: { taskId: task.id, projectId: task.projectId }, records: { task, current, proposed: input.userIds.map(id => known.get(id)) } };
}
async function recurrenceScope({ prisma, user, input }) {
  const task = await taskScope(prisma, user, input);
  if (task.recurrenceSourceId) throw targetUnavailable('Manage recurrence on the original task');
  if (task.recurrenceRevision !== input.revision) throw targetUnavailable('Recurrence revision changed');
  return { ids: { taskId: task.id, projectId: task.projectId }, records: { task } };
}

export const WORKSPACE_TASK_ACTIONS = [
  {
    name: 'set_task_collaborators', description: 'Set an exact staff contributor roster, preserving the accountable owner. Requires the observed roster revision and human approval of its preview.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: z.object({ ...target, revision: z.number().int().min(0), userIds: z.array(recordId).max(30).refine(ids => new Set(ids).size === ids.length) }).strict(),
    resolveScope: collaboratorsScope,
    preview: async ({ scope }) => ({ kind: 'set_task_collaborators', task: { id: scope.records.task.id, title: scope.records.task.title, projectId: scope.records.task.projectId }, ownerId: scope.records.current.ownerId, revision: scope.records.current.revision, before: scope.records.current.collaborators, after: scope.records.proposed }),
    rollback: 'The transaction restores the roster on failure. Prepare a new preview with the latest revision to reverse a committed roster change.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => {
      const actor = await currentActor(prisma, user);
      await taskScope(prisma, actor, input);
      return saveTaskCollaboratorsInTransaction(prisma, input.taskId, input, actor);
    } },
  },
  {
    name: 'set_task_recurrence', description: 'Configure or stop task calendar/completion recurrence with its observed revision. Human approval is required; this never replays completed history.',
    class: 'execute', roles: ['ADMIN', 'TEAM'], requiresConfirmation: true, idempotency: 'required', timeoutMs: 10_000,
    inputSchema: taskRecurrenceUpdateSchema.extend(target).strict(), resolveScope: recurrenceScope,
    preview: async ({ scope, input }) => ({ kind: 'set_task_recurrence', task: { id: scope.records.task.id, title: scope.records.task.title, projectId: scope.records.task.projectId }, revision: scope.records.task.recurrenceRevision, before: scope.records.task.recurrenceRule, after: input.rule, completedHistoryReplayed: false }),
    rollback: 'The transaction restores settings on failure. Prepare a new preview with the latest revision to reverse committed settings; existing task copies are retained.',
    execution: { mode: 'transaction', isolationLevel: 'Serializable', execute: async ({ prisma, user, input }) => {
      const actor = await currentActor(prisma, user);
      await recurrenceScope({ prisma, user: actor, input });
      return saveTaskRecurrenceInTransaction(prisma, input.taskId, input);
    } },
  },
];
