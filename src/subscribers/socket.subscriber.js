import bus, { EVENTS } from '../utils/events.js';
import { io } from '../index.js';
import logger from '../utils/logger.js';

/**
 * Socket.IO Bridge Subscriber
 * 
 * This subscriber listens to the internal Enterprise Event Bus
 * and broadcasts relevant events to connected frontend clients
 * via Socket.IO.
 */
export function initSocketBridge() {
  logger.info('🔌 Connecting Event Bus to Socket.IO Bridge...');

  // Broadcast Project Updates
  bus.on(EVENTS.PROJECT_UPDATED, ({ project }) => {
    // Notify users in the project room
    io.to(`project:${project.id}`).emit('project_updated', project);
    logger.debug({ projectId: project.id }, '📡 Socket: Project update broadcasted');
  });

  // Broadcast Task Creations
  bus.on(EVENTS.TASK_CREATED, ({ task }) => {
    io.to(`project:${task.projectId}`).emit('task_created', task);
    logger.debug({ taskId: task.id }, '📡 Socket: Task creation broadcasted');
  });

  // Broadcast Task Updates
  bus.on(EVENTS.TASK_UPDATED, ({ task }) => {
    io.to(`project:${task.projectId}`).emit('task_updated', task);
    logger.debug({ taskId: task.id }, '📡 Socket: Task update broadcasted');
  });

  // Broadcast Notifications to specific users
  bus.on(EVENTS.TASK_BLOCKED, ({ task, user, reason }) => {
    // This is already handled by the notification subscriber calling fastify.notify,
    // but we could also emit a specific real-time event here if needed.
  });

  logger.info('✅ Socket.IO Bridge Ready');
}
