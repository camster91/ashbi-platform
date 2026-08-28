import clientRoutes from '../../routes/client.routes.js';
import projectRoutes from '../../routes/project.routes.js';
import taskRoutes from '../../routes/task.routes.js';
import reportRoutes from '../../routes/report.routes.js';

/**
 * Register the contiguous client-to-work route vertical.
 *
 * The sequence intentionally matches the pre-extraction application factory
 * so route precedence and Fastify plugin initialization remain unchanged.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerWorkManagementRoutes(fastify) {
  await fastify.register(clientRoutes, { prefix: '/api/clients' });
  await fastify.register(projectRoutes, { prefix: '/api/projects' });
  await fastify.register(taskRoutes, { prefix: '/api/tasks' });
  await fastify.register(reportRoutes, { prefix: '/api/reports' });
}
