import aiRoutes from '../../routes/ai.routes.js';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';
import semanticSearchRoutes from '../../routes/semantic-search.routes.js';
import automationRoutes from '../../routes/automation.routes.js';
import aiContextRoutes from '../../routes/ai-context.routes.js';
import aiTeamRoutes from '../../routes/ai-team.routes.js';
import botRoutes from '../../routes/bot.routes.js';
import approvalRoutes from '../../routes/approvals.routes.js';
import aiConnectionRoutes from '../../routes/ai-connection.routes.js';
import aiToolRoutes from '../../routes/ai-tool.routes.js';

/**
 * Register automation and AI routes: AI actions, the AI bridge, semantic
 * search, automations, AI context, the AI team, the bot, approvals, the
 * organization's bring-your-own-key AI connection (#413), and the governed AI
 * tool approval queue and receipts (#413 slice 2).
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerAiRoutes(fastify) {
  await fastify.register(aiRoutes, { prefix: '/api/ai' });
  await fastify.register(aiBridgeRoutes, { prefix: '/api/ai-bridge' });
  await fastify.register(semanticSearchRoutes, { prefix: '/api/semantic-search' });
  await fastify.register(automationRoutes, { prefix: '/api/automations' });
  await fastify.register(aiContextRoutes, { prefix: '/api/ai-context' });
  await fastify.register(aiTeamRoutes, { prefix: '/api/ai-team' });
  await fastify.register(botRoutes, { prefix: '/api/bot' });
  await fastify.register(approvalRoutes, { prefix: '/api/approvals' });
  await fastify.register(aiConnectionRoutes, { prefix: '/api/ai-connections' });
  await fastify.register(aiToolRoutes, { prefix: '/api/ai-tools' });
}
