import bus, { EVENTS } from '../utils/events.js';
import logger from '../utils/logger.js';

/**
 * Who hears that a task was blocked (M10): the task's assignee and the
 * project's owner; when neither exists (or both are the person who blocked
 * it), the organization's active admins. The actor is never notified, and
 * nobody outside the actor's organization is.
 *
 * @param {any} prisma
 * @param {{ task: { assigneeId?: string | null, projectId: string }, user: { id: string, organizationId?: string } }} event
 * @returns {Promise<string[]>}
 */
export async function taskBlockedRecipients(prisma, { task, user }) {
  const organizationId = user?.organizationId;
  if (!organizationId) return [];
  const project = await prisma.project.findFirst({
    where: { id: task.projectId, organizationId },
    select: { defaultOwnerId: true },
  });
  const direct = [task.assigneeId, project?.defaultOwnerId].filter((id) => id && id !== user.id);
  const candidates = direct.length > 0
    ? await prisma.user.findMany({ where: { id: { in: direct }, organizationId, isActive: true }, select: { id: true } })
    : [];
  if (candidates.length > 0) return [...new Set(candidates.map(({ id }) => id))];
  const admins = await prisma.user.findMany({
    where: { organizationId, role: 'ADMIN', isActive: true, id: { not: user.id } },
    select: { id: true },
  });
  return admins.map(({ id }) => id);
}

/**
 * @param {{ prisma: any, notify: Function }} fastify
 * @param {{ task: any, user: any, reason?: string | null }} event
 */
export async function notifyTaskBlocked(fastify, { task, user, reason }) {
  const recipients = await taskBlockedRecipients(fastify.prisma, { task, user });
  for (const userId of recipients) {
    await fastify.notify(userId, {
      type: 'TASK_BLOCKED',
      title: `Blocked: ${task.title}`,
      message: `${user.name || 'A teammate'} blocked this task: ${reason || 'No reason given'}`,
      data: { taskId: task.id, projectId: task.projectId },
    });
  }
  return recipients;
}

/**
 * Notification Subscriber
 *
 * Centralizes all real-time and persistent user notifications.
 */
export function initNotificationSubscriber(fastify) {
  bus.on(EVENTS.TASK_BLOCKED, async (event) => {
    try {
      const recipients = await notifyTaskBlocked(fastify, event);
      logger.debug({ taskId: event.task.id, recipients: recipients.length }, 'Notification: task blocked alert sent');
    } catch (err) {
      logger.error({ err, taskId: event.task?.id }, 'Notification: failed to send task blocked alert');
    }
  });

  // Additional notification hooks (Slack, Discord, Email) can be piped here
}
