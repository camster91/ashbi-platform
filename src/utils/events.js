import { EventEmitter } from 'events';
import logger from './logger.js';

/**
 * Enterprise Internal Event Bus
 * 
 * This singleton enables a pub/sub pattern across the application,
 * allowing us to decouple core business logic from secondary 
 * side-effects like notifications, AI processing, and third-party syncs.
 */
class EventBus extends EventEmitter {
  emit(event, ...args) {
    logger.debug({ event }, '📢 Event Emitted');
    return super.emit(event, ...args);
  }
}

const bus = new EventBus();

// Core Event Constants
export const EVENTS = {
  // Client Events
  CLIENT_CREATED: 'client.created',
  CLIENT_UPDATED: 'client.updated',
  
  // Project Events
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_STATUS_CHANGED: 'project.status_changed',
  
  // Task Events
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  TASK_BLOCKED: 'task.blocked',
  
  // Auth Events
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout'
};

export default bus;
