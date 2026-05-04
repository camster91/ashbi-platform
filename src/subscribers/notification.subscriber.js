import bus, { EVENTS } from '../utils/events.js';
import { fastify } from '../index.js';
import logger from '../utils/logger.js';

/**
 * Notification Subscriber
 * 
 * Centralizes all real-time and persistent user notifications.
 */
export function initNotificationSubscriber() {
  // Task Blocked Notification
  bus.on(EVENTS.TASK_BLOCKED, async ({ task, user, reason }) => {
    try {
      // Find admin to notify (Cameron)
      // This logic will eventually use a more dynamic "Account Owner" system
      const cameron = await fastify.prisma.user.findFirst({ where: { email: 'cameron@ashbi.ca' } });
      
      if (cameron) {
        await fastify.notify(cameron.id, 'TASK_UPDATE', {
          title: `Blocked: ${task.title}`,
          message: `Task blocked by ${user.name}: ${reason || 'No reason given'}`,
          data: { type: 'TASK', refId: task.id }
        });
        logger.debug({ taskId: task.id }, '✅ Notification: Task blocked alert sent');
      }
    } catch (err) {
      logger.error({ err, taskId: task.id }, '❌ Notification: Failed to send task blocked alert');
    }
  });

  // Additional notification hooks (Slack, Discord, Email) can be piped here
}
