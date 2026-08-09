import invoiceChaserRoutes from '../../routes/invoice-chaser.routes.js';
import invoiceRoutes from '../../routes/invoice.routes.js';
import contractRoutes from '../../routes/contract.routes.js';
import proposalRoutes from '../../routes/proposal.routes.js';

/**
 * Register the contiguous proposal-to-cash route vertical.
 *
 * Keep this order aligned with the pre-extraction application composition so
 * route precedence and plugin initialization behavior remain unchanged.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerCoreRevenueRoutes(fastify) {
  await fastify.register(invoiceChaserRoutes, { prefix: '/api/invoice-chaser' });
  await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
  await fastify.register(contractRoutes, { prefix: '/api/contracts' });
  await fastify.register(proposalRoutes, { prefix: '/api/proposals' });
}
