import bus, { EVENTS } from '../utils/events.js';
import logger from '../utils/logger.js';
import {
  clientProjectRoom,
  projectRoom,
  toClientProjectPayload,
  toClientTaskPayload,
} from '../auth/project-room-access.js';

/**
 * Socket.IO Bridge Subscriber
 * 
 * This subscriber listens to the internal Enterprise Event Bus
 * and broadcasts relevant events to connected frontend clients
 * via Socket.IO.
 */
export function initSocketBridge(io) {
  logger.info('🔌 Connecting Event Bus to Socket.IO Bridge...');

  // Broadcast Project Updates
  // Staff in the internal room get the full row; the client room only ever
  // gets the whitelisted fields (see project-room-access.js).
  bus.on(EVENTS.PROJECT_UPDATED, ({ project }) => {
    io.to(projectRoom(project.id)).emit('project_updated', project);
    io.to(clientProjectRoom(project.id)).emit('project_updated', toClientProjectPayload(project));
    logger.debug({ projectId: project.id }, '📡 Socket: Project update broadcasted');
  });

  // Broadcast Task Creations
  bus.on(EVENTS.TASK_CREATED, ({ task }) => {
    io.to(projectRoom(task.projectId)).emit('task_created', task);
    const clientTask = toClientTaskPayload(task);
    if (clientTask) io.to(clientProjectRoom(task.projectId)).emit('task_created', clientTask);
    logger.debug({ taskId: task.id }, '📡 Socket: Task creation broadcasted');
  });

  // Broadcast Task Updates
  bus.on(EVENTS.TASK_UPDATED, ({ task }) => {
    io.to(projectRoom(task.projectId)).emit('task_updated', task);
    const clientTask = toClientTaskPayload(task);
    if (clientTask) io.to(clientProjectRoom(task.projectId)).emit('task_updated', clientTask);
    logger.debug({ taskId: task.id }, '📡 Socket: Task update broadcasted');
  });

  // Broadcast Notifications to specific users
  bus.on(EVENTS.TASK_BLOCKED, ({ task, user, reason }) => {
    // This is already handled by the notification subscriber calling fastify.notify,
    // but we could also emit a specific real-time event here if needed.
  });

  logger.info('✅ Socket.IO Bridge Ready');
}
