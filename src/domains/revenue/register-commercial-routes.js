import proposalBuilderRoutes from '../../routes/proposal-builder.routes.js';
import estimateRoutes from '../../routes/estimate.routes.js';
import rateCardRoutes from '../../routes/rate-card.routes.js';
import pipelineRoutes from '../../routes/pipeline.routes.js';
import expenseRoutes from '../../routes/expense.routes.js';
import leadRoutes from '../../routes/leads.routes.js';
import clientAcquisitionRoutes from '../../routes/client-acquisition.routes.js';
import retainerRoutes from '../../routes/retainer.routes.js';

/**
 * Register pre-sale and commercial revenue routes: proposal builder,
 * estimates, rate cards, pipeline, expenses, leads, public client
 * acquisition, and retainers.
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerCommercialRevenueRoutes(fastify) {
  await fastify.register(proposalBuilderRoutes, { prefix: '/api/proposal-builder' });
  await fastify.register(estimateRoutes, { prefix: '/api/estimates' });
  await fastify.register(rateCardRoutes, { prefix: '/api/rate-cards' });
  await fastify.register(pipelineRoutes, { prefix: '/api/pipeline' });
  await fastify.register(expenseRoutes, { prefix: '/api/expenses' });
  await fastify.register(leadRoutes, { prefix: '/api/leads' });
  await fastify.register(clientAcquisitionRoutes, { prefix: '/api/client-acquisition' });
  await fastify.register(retainerRoutes, { prefix: '/api/retainers' });
}
