import { initAiSubscriber } from './ai.subscriber.js';
import { initNotificationSubscriber } from './notification.subscriber.js';
import { initSocketBridge } from './socket.subscriber.js';
import logger from '../utils/logger.js';

/**
 * Initialize all Enterprise Event Subscribers
 */
export function initSubscribers() {
  logger.info('🛰️  Initializing Enterprise Event Subscribers...');
  
  initAiSubscriber();
  initNotificationSubscriber();
  initSocketBridge();
  
  logger.info('✅ Event Subscribers Ready');
}
