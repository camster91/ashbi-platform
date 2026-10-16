import crypto from 'node:crypto';
import { z } from 'zod';
import { ToolError, recordNotFound, targetUnavailable } from '../ai/tools/registry.js';

const id = z.string().trim().min(1).max(100);
export const COMMUNICATION_TASK_PROJECT_STATUSES = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'ACTIVE'];
export const communicationTaskInputSchema = z.object({
  clientId: id, source: z.literal('inbox'), messageId: id, projectId: id,
  title: z.string().trim().min(1).max(500), description: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  dueDate: z.string().datetime().optional(),
}).strict();
export const communicationTaskFormSchema = communicationTaskInputSchema.omit({ clientId: true, source: true, messageId: true });

/** Fresh authorization is required even when the caller presents an old JWT or receipt. */
export async function communicationTaskSource(prisma, user, { clientId, messageId }) {
  const actor = user?.id && user?.organizationId && await prisma.user.findFirst({
    where: { id: user.id, organizationId: user.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } },
    select: { id: true, organizationId: true, role: true },
  });
  if (!actor) throw new ToolError('ROLE_DENIED', 'Staff access required', { statusCode: 403 });
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId, deletedAt: null }, select: { id: true } });
  if (!client) throw recordNotFound();
  const message = await prisma.message.findFirst({
    where: { id: messageId, thread: { clientId, client: { organizationId: actor.organizationId, deletedAt: null }, ...(actor.role === 'TEAM' ? { assignedToId: actor.id } : {}) } },
    select: { id: true, threadId: true, subject: true, senderEmail: true, receivedAt: true, direction: true, bodyText: true,
      thread: { select: { id: true, clientId: true, projectId: true, assignedToId: true, project: { select: { id: true, clientId: true, organizationId: true, deletedAt: true } } } } },
  });
  if (!message) throw recordNotFound();
  const thread = message.thread;
  if (thread.projectId && (!thread.project || thread.project.id !== thread.projectId || thread.project.clientId !== clientId || thread.project.organizationId !== actor.organizationId || thread.project.deletedAt != null)) throw recordNotFound();
  return { actor, message };
}

export async function communicationTaskScope({ prisma, user, input }) {
  const { actor, message } = await communicationTaskSource(prisma, user, input);
  const project = await prisma.project.findFirst({ where: { id: input.projectId, clientId: input.clientId, organizationId: actor.organizationId, deletedAt: null, status: { in: COMMUNICATION_TASK_PROJECT_STATUSES } }, select: { id: true, name: true, clientId: true } });
  if (!project || (message.thread.projectId && message.thread.projectId !== project.id)) throw targetUnavailable();
  // Include full stored text and assignments, not just the bounded visible preview.
  const evidence = [message.id, message.threadId, message.subject, message.senderEmail, new Date(message.receivedAt).toISOString(), message.direction, message.bodyText,
    message.thread.clientId, message.thread.projectId, message.thread.assignedToId, project.id, project.name];
  const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  return { ids: { clientId: input.clientId, messageId: message.id, threadId: message.threadId, projectId: project.id }, records: { project, message, sourceFingerprint } };
}

export function communicationTaskPreview(input, scope) {
  const { message, project, sourceFingerprint } = scope.records;
  return { kind: 'create_task_from_client_message', sourceFingerprint,
    task: { title: input.title, description: input.description ?? null, priority: input.priority, dueDate: input.dueDate ?? null },
    destination: { projectId: project.id, projectName: project.name, clientId: input.clientId },
    source: { source: 'inbox', messageId: message.id, threadId: message.threadId, subject: (message.subject ?? '').slice(0, 500), sender: (message.senderEmail ?? '').slice(0, 320), receivedAt: new Date(message.receivedAt).toISOString() },
  };
}

export async function executeCommunicationTask({ prisma, user, input, preview }) {
  const scope = await communicationTaskScope({ prisma, user, input });
  if (!preview?.sourceFingerprint || preview.sourceFingerprint !== scope.records.sourceFingerprint) throw targetUnavailable('Stored communication changed; review a new preview');
  const task = await prisma.task.create({ data: { projectId: input.projectId, title: input.title, description: input.description ?? null,
    priority: input.priority, dueDate: input.dueDate ? new Date(input.dueDate) : null, sourceThreadId: scope.ids.threadId },
  select: { id: true, title: true, projectId: true, sourceThreadId: true } });
  return { task };
}
