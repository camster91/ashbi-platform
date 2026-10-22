import integrationRoutes from '../../routes/integration.routes.js';
import wpBridgeRoutes from '../../routes/wp-bridge.routes.js';
import workspaceApiRoutes from '../../routes/workspace-api.routes.js';
import commandCenterRoutes from '../../routes/integrations.command-center.routes.js';
import mailgunHitlRoutes from '../../routes/mailgun-hitl.routes.js';
import mailgunRoutes from '../../routes/mailgun.routes.js';
import slackEventRoutes from '../../routes/slack-events.routes.js';
import slackAdminRoutes from '../../routes/slack.routes.js';
import googleCalendarRoutes from '../../routes/google-calendar.routes.js';
import IORedis from 'ioredis';
import env from '../../config/env.js';
import { prisma } from '../../config/db.js';
import { redisConnectionArgs } from '../../config/redis.js';
import { createMcpOAuthProvider } from '../../auth/mcp-oauth-provider.js';
import mcpOAuthRoutes from '../../routes/mcp-oauth.routes.js';

/**
 * Register third-party integration routes: integration settings, the
 * command center, Mailgun (HITL and inbound), Slack events and admin, and
 * Google Calendar.
 *
 * Every route module here is an encapsulated Fastify plugin (none uses
 * fastify-plugin or skip-override), so its hooks cannot affect other domains.
 * The order below keeps the modules' pre-extraction relative order.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function registerIntegrationRoutes(fastify) {
  let oauthProvider;
  if (process.env.MCP_OAUTH_ENABLED === 'true') {
    const redis = new IORedis(...redisConnectionArgs(undefined, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false }));
    redis.on('error', () => {});
    await redis.connect();
    fastify.addHook('onClose', () => redis.quit());
    oauthProvider = createMcpOAuthProvider({ prisma, redis, issuer: env.hubUrl });
  }
  await fastify.register(mcpOAuthRoutes, { prefix: '', ...(oauthProvider ? { provider: oauthProvider } : {}) });
  await fastify.register(workspaceApiRoutes, { prefix: '/api', ...(oauthProvider ? { oauthProvider } : {}) });
  await fastify.register(integrationRoutes, { prefix: '/api/integrations' });
  await fastify.register(wpBridgeRoutes, { prefix: '/api/wp-bridge' });
  await fastify.register(commandCenterRoutes, { prefix: '/api/command-center' });
  await fastify.register(mailgunHitlRoutes, { prefix: '/api/mailgun-hitl' });
  await fastify.register(mailgunRoutes, { prefix: '/api/mailgun' });
  await fastify.register(slackEventRoutes, { prefix: '/api/slack/events' });
  await fastify.register(slackAdminRoutes, { prefix: '/api/slack' });
  await fastify.register(googleCalendarRoutes, { prefix: '/api/google-calendar' });
}
