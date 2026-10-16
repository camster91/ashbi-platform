import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ToolError, recordNotFound, targetUnavailable } from '../ai/tools/registry.js';
import { COMMUNICATION_TASK_PROJECT_STATUSES } from './client-communication-task.service.js';

const id = z.string().trim().min(1).max(100);
export const clientTaskInputSchema = z.object({
  clientId: id, projectId: id, title: z.string().trim().min(1).max(500),
  description: z.string().max(10000).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  dueDate: z.string().datetime().optional(),
}).strict();
export const clientTaskFormSchema = clientTaskInputSchema.omit({ clientId: true });

async function staff(prisma, user) {
  const actor = user?.id && user?.organizationId && await prisma.user.findFirst({
    where: { id: user.id, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } },
    select: { id: true, organizationId: true, role: true, isActive: true },
  });
  if (!actor || actor.id !== user.id || actor.organizationId !== user.organizationId || !actor.isActive || !['ADMIN', 'TEAM'].includes(actor.role)) {
    throw new ToolError('ROLE_DENIED', 'Active staff access required', { statusCode: 403 });
  }
  return actor;
}

/** No ADMIN bypass: canonical client/project and explicitly enabled plugin are mandatory. */
export async function clientTaskScope({ prisma, user, input }) {
  const actor = await staff(prisma, user);
  const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true, name: true, organizationId: true, deletedAt: true } });
  if (!client || client.id !== input.clientId || client.organizationId !== actor.organizationId || client.deletedAt) throw recordNotFound('Client not found');
  const profile = await prisma.clientAgentProfile.findFirst({ where: { clientId: client.id, organizationId: actor.organizationId }, select: { id: true, organizationId: true, clientId: true, enabled: true, pluginIds: true, revision: true } });
  if (!profile || profile.organizationId !== actor.organizationId || profile.clientId !== client.id || !profile.enabled || !Array.isArray(profile.pluginIds) || !profile.pluginIds.includes('client-task-actions')) throw targetUnavailable('Task proposals are unavailable for this client');
  const project = await prisma.project.findFirst({ where: { id: input.projectId, clientId: client.id, organizationId: actor.organizationId, deletedAt: null, status: { in: COMMUNICATION_TASK_PROJECT_STATUSES } }, select: { id: true, name: true, clientId: true, organizationId: true, deletedAt: true, status: true } });
  if (!project || project.id !== input.projectId || project.clientId !== client.id || project.organizationId !== actor.organizationId || project.deletedAt || !COMMUNICATION_TASK_PROJECT_STATUSES.includes(project.status)) throw targetUnavailable('Client project unavailable');
  return { ids: { clientId: client.id, projectId: project.id }, records: { actor, client, project, profile } };
}

export function clientTaskPreview(input, scope) {
  const { client, project, profile } = scope.records;
  return { kind: 'create_client_task', profileRevision: profile.revision,
    task: { title: input.title, description: input.description ?? null, priority: input.priority, dueDate: input.dueDate ?? null },
    destination: { clientId: client.id, clientName: client.name, projectId: project.id, projectName: project.name } };
}

export async function authorizeClientTaskReceipt(prisma, user, action) {
  const scope = await clientTaskScope({ prisma, user, input: action.input });
  // Profile edits revoke old previews and receipts, including executed replays.
  if (action.preview?.profileRevision !== scope.records.profile.revision || action.preview?.destination?.clientId !== scope.ids.clientId || action.preview?.destination?.projectId !== scope.ids.projectId) throw targetUnavailable('The profile or destination changed; review a new preview');
  return scope;
}

/** Reauthorize requester AND approver inside the same Serializable transaction as task/receipt. */
export async function executeClientTask({ prisma, user, approver, input, preview }) {
  const scope = await authorizeClientTaskReceipt(prisma, user, { input, preview });
  await staff(prisma, approver);
  if (approver.organizationId !== user.organizationId) throw recordNotFound();
  const expected = clientTaskPreview(input, scope);
  if (!isDeepStrictEqual(expected, preview)) throw targetUnavailable('The preview changed; review a new proposal');
  const task = await prisma.task.create({ data: { projectId: input.projectId, title: input.title, description: input.description ?? null,
    priority: input.priority, dueDate: input.dueDate ? new Date(input.dueDate) : null }, select: { id: true, title: true, projectId: true } });
  return { task };
}
