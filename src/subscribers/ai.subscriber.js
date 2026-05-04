import bus, { EVENTS } from '../utils/events.js';
import { queueEmbedding } from '../jobs/queue.js';
import logger from '../utils/logger.js';

/**
 * AI Subscriber
 * 
 * Handles all AI-related side-effects like vector embeddings
 * and automatic plan generation.
 */
export function initAiSubscriber() {
  // Listen for Project Creation to generate vector context
  bus.on(EVENTS.PROJECT_CREATED, async ({ project }) => {
    try {
      if (project.clientId && project.description) {
        await queueEmbedding(
          project.clientId, 
          `Project: ${project.name} - ${project.description}`, 
          'PROJECT', 
          project.id, 
          { projectName: project.name }
        );
        logger.debug({ projectId: project.id }, '✅ AI: Project embedding queued');
      }
    } catch (err) {
      logger.error({ err, projectId: project.id }, '❌ AI: Failed to queue project embedding');
    }
  });

  // Additional AI hooks can be added here
}
