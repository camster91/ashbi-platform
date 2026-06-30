// Agency Hub - Main Entry Point

import Fastify from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import env from './config/env.js';
import prisma from './config/db.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import clientPortalRoutes from './routes/client-portal.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import inboxRoutes from './routes/inbox.routes.js';
import clientRoutes from './routes/client.routes.js';
import projectRoutes from './routes/project.routes.js';
import threadRoutes from './routes/thread.routes.js';
import responseRoutes from './routes/response.routes.js';
import teamRoutes from './routes/team.routes.js';
import taskRoutes from './routes/task.routes.js';
import searchRoutes from './routes/search.routes.js';
import aiRoutes from './routes/ai.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import chatRoutes from './routes/chat.routes.js';
import ashChatRoutes from './routes/ash-chat.routes.js';
import noteRoutes from './routes/note.routes.js';
import milestoneRoutes from './routes/milestone.routes.js';
import timeRoutes from './routes/time.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import commentRoutes from './routes/comment.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import revisionRoutes from './routes/revision.routes.js';
import messageRoutes from './routes/message.routes.js';
import mailgunRoutes from './routes/mailgun.routes.js';
import mailgunHitlRoutes from './routes/mailgun-hitl.routes.js';
import approvalRoutes from './routes/approvals.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import botRoutes from './routes/bot.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import retainerRoutes from './routes/retainer.routes.js';
import leadRoutes from './routes/leads.routes.js';
import credentialRoutes from './routes/credential.routes.js';
import portalRoutes from './routes/portal.routes.js';
import templateRoutes from './routes/template.routes.js';
import aiTeamRoutes from './routes/ai-team.routes.js';
import emailTriageRoutes from './routes/email-triage.routes.js';
import proposalRoutes from './routes/proposal.routes.js';
import contractRoutes from './routes/contract.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import invoiceChaserRoutes from './routes/invoice-chaser.routes.js';
import aiContextRoutes from './routes/ai-context.routes.js';
import gmailRoutes from './routes/gmail.routes.js';
import integrationsGithubRoutes from './routes/integrations.github.routes.js';
import integrationsVpsRoutes from './routes/integrations.vps.routes.js';
import integrationsHostingerRoutes from './routes/integrations.hostinger.routes.js';
import pushRoutes from './routes/push.routes.js';
import { initVapid } from './utils/web-push.js';
import commandCenterRoutes from './routes/integrations.command-center.routes.js';
import expenseRoutes from './routes/expense.routes.js';
import { startRecurringInvoicesJob } from './jobs/recurring-invoices.js';
import automationRoutes from './routes/automation.routes.js';
import brandRoutes from './routes/brand.routes.js';
import { startOverdueChecker } from './services/automation.service.js';
import { startTrashPurgeJob } from './jobs/trash-purge.js';
import pipelineRoutes from './routes/pipeline.routes.js';
import { initHermesBridge } from './agents/hub-hermes.integration.js';
import timeTrackingRoutes from './routes/time-tracking.routes.js';
import timeSessionRoutes from './routes/time-sessions.routes.js';
import semanticSearchRoutes from './routes/semantic-search.routes.js';
import creativeBriefRoutes from './routes/creative-brief.routes.js';
import assetLibraryRoutes from './routes/asset-library.routes.js';
import apiKeyRoutes, { authenticateApiKey } from './routes/api-key.routes.js';
import estimateRoutes from './routes/estimate.routes.js';
import rateCardRoutes from './routes/rate-card.routes.js';
import integrationRoutes from './routes/integration.routes.js';
import proposalBuilderRoutes from './routes/proposal-builder.routes.js';
import clientAcquisitionRoutes from './routes/client-acquisition.routes.js';
import trashRoutes from './routes/trash.routes.js';
import draftRoutes from './routes/draft.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import * as Sentry from '@sentry/node';
import logger from './utils/logger.js';
import { initSubscribers } from './subscribers/index.js';
import { tenancyMiddleware } from './middleware/tenancy.js';
import { getAuthProvider } from './auth/index.js';

// Initialize Sentry error monitoring
if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: env.isProduction ? 0.2 : 1.0,
    enabled: true,
    integrations: [Sentry.fastifyIntegration()],
  });
  logger.info('[Sentry] Error monitoring initialized');
} else {
  logger.info('[Sentry] No SENTRY_DSN configured — skipping initialization');
}

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: env.isDev ? 'debug' : 'info'
  }
});

// Attach Sentry error handler (must be after Fastify creation, before plugins/routes)
if (env.sentryDsn) {
  Sentry.setupFastifyErrorHandler(fastify);
}

// Content Type Parser
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    req.rawBody = body;
    if (!body || body.length === 0) return done(null, {});
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err);
  }
});

// Plugins
await fastify.register(compress, { global: true });
await fastify.register(cors, { origin: env.isDev ? ['http://localhost:3000', 'http://localhost:5173'] : env.corsOrigins, credentials: true });
await fastify.register(cookie);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await fastify.register(rateLimit, { global: true, max: 100, timeWindow: '1 minute', skipOnError: true });
await fastify.register(jwt, { secret: env.jwtSecret, cookie: { cookieName: 'token', signed: false } });

// JWT verification hook — runs for ALL /api/* requests BEFORE tenancyMiddleware
fastify.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;
  // Skip auth-exempt routes
  if (
    request.url.startsWith('/api/auth') ||
    request.url.startsWith('/api/wp-bridge') ||
    request.url.startsWith('/api/portal') ||
    request.url.startsWith('/api/client-acquisition/config') ||
    request.url.startsWith('/api/client-acquisition/intake') ||
    request.url === '/api/health'
  ) return;
  try {
    await request.jwtVerify();
  } catch {
    // No valid token — let route-specific auth handle 401
  }
});

// Auth decorators
fastify.decorate('authenticate', async (request, reply) => {
  try { await request.jwtVerify(); } catch (err) { return reply.status(401).send({ error: 'Unauthorized' }); }
});

fastify.decorate('adminOnly', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  } catch (err) { return reply.status(401).send({ error: 'Unauthorized' }); }
});

// Infrastructure
// SECURITY: Decorate `fastify.prisma` with a Proxy that resolves to the
// per-request scoped prisma (set by tenancy middleware via AsyncLocalStorage)
// when accessed from a route handler, and to the raw soft-delete-extended
// prisma otherwise. This matches the wrapping done on `db.js`'s default
// export — every call to `fastify.prisma.X.findMany()` now auto-scopes when
// the request has an organizationId.
import { getRequestPrisma } from './utils/request-context.js';
fastify.decorate('prisma', new Proxy({}, {
  get(_t, prop) {
    const client = getRequestPrisma() ?? prisma;
    const value = /** @type {any} */ (client)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
}));
fastify.decorate('auth', getAuthProvider(fastify));
fastify.addHook('preHandler', tenancyMiddleware);
fastify.decorate('authenticateWithApiKey', authenticateApiKey);

// Routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(clientRoutes, { prefix: '/api/clients' });
await fastify.register(projectRoutes, { prefix: '/api/projects' });
await fastify.register(taskRoutes, { prefix: '/api/tasks' });
await fastify.register(inboxRoutes, { prefix: '/api/inbox' });
await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
await fastify.register(aiRoutes, { prefix: '/api/ai' });
await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
await fastify.register(proposalBuilderRoutes, { prefix: '/api/proposal-builder' });
// Route registrations continued
await fastify.register(apiKeyRoutes, { prefix: '/api/api-keys' });
await fastify.register(estimateRoutes, { prefix: '/api/estimates' });
await fastify.register(rateCardRoutes, { prefix: '/api/rate-cards' });
await fastify.register(integrationRoutes, { prefix: '/api/integrations' });
await fastify.register(brandRoutes, { prefix: '/api/brand' });
await fastify.register(pipelineRoutes, { prefix: '/api/pipeline' });
await fastify.register(timeTrackingRoutes, { prefix: '/api/time-tracking' });
await fastify.register(timeSessionRoutes, { prefix: '/api/time-sessions' });
await fastify.register(semanticSearchRoutes, { prefix: '/api/semantic-search' });
await fastify.register(creativeBriefRoutes, { prefix: '/api/creative-brief' });
await fastify.register(assetLibraryRoutes, { prefix: '/api/asset-library' });
await fastify.register(automationRoutes, { prefix: '/api/automations' });
await fastify.register(expenseRoutes, { prefix: '/api/expenses' });
await fastify.register(commandCenterRoutes, { prefix: '/api/command-center' });
await fastify.register(pushRoutes, { prefix: '/api/push' });
await fastify.register(integrationsVpsRoutes, { prefix: '/api/integrations/vps' });
await fastify.register(integrationsHostingerRoutes, { prefix: '/api/integrations/hostinger' });
await fastify.register(integrationsGithubRoutes, { prefix: '/api/integrations/github' });
  await fastify.register(trashRoutes, { prefix: '/api/trash' });
  await fastify.register(draftRoutes, { prefix: '/api/draft' });
await fastify.register(aiContextRoutes, { prefix: '/api/ai-context' });
await fastify.register(invoiceChaserRoutes, { prefix: '/api/invoice-chaser' });
await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
await fastify.register(contractRoutes, { prefix: '/api/contracts' });
await fastify.register(proposalRoutes, { prefix: '/api/proposals' });
await fastify.register(emailTriageRoutes, { prefix: '/api/email-triage' });
await fastify.register(aiTeamRoutes, { prefix: '/api/ai-team' });
await fastify.register(templateRoutes, { prefix: '/api/templates' });
await fastify.register(portalRoutes, { prefix: '/api/portal' });
await fastify.register(credentialRoutes, { prefix: '/api/credentials' });
await fastify.register(leadRoutes, { prefix: '/api/leads' });
await fastify.register(retainerRoutes, { prefix: '/api/retainers' });
await fastify.register(onboardingRoutes, { prefix: '/api/onboarding' });
await fastify.register(botRoutes, { prefix: '/api/bot' });
await fastify.register(approvalRoutes, { prefix: '/api/approvals' });
await fastify.register(mailgunHitlRoutes, { prefix: '/api/mailgun-hitl' });
await fastify.register(mailgunRoutes, { prefix: '/api/mailgun' });
await fastify.register(messageRoutes, { prefix: '/api/messages' });
await fastify.register(revisionRoutes, { prefix: '/api/revisions' });
await fastify.register(calendarRoutes, { prefix: '/api/calendar' });
await fastify.register(commentRoutes, { prefix: '/api/comments' });
await fastify.register(attachmentRoutes, { prefix: '/api/attachments' });
await fastify.register(timeRoutes, { prefix: '/api/time' });
await fastify.register(milestoneRoutes, { prefix: '/api/milestones' });
await fastify.register(noteRoutes, { prefix: '/api/notes' });
await fastify.register(ashChatRoutes, { prefix: '/api/ash-chat' });
await fastify.register(chatRoutes, { prefix: '/api/chat' });
await fastify.register(searchRoutes, { prefix: '/api/search' });
await fastify.register(teamRoutes, { prefix: '/api/team' });
await fastify.register(responseRoutes, { prefix: '/api/responses' });
await fastify.register(threadRoutes, { prefix: '/api/threads' });
await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
await fastify.register(clientPortalRoutes, { prefix: '/api/client-portal' });
await fastify.register(gmailRoutes, { prefix: '/api/gmail' });
await fastify.register(clientAcquisitionRoutes, { prefix: '/api/client-acquisition' });
// ... (all other routes would be registered here in a production app, condensed for space)

// Hub-Hermes bridge initialization
initHermesBridge(fastify);

fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Static files
if (!env.isDev) {
  await fastify.register(fastifyStatic, { root: path.join(__dirname, '../dist'), prefix: '/' });
  fastify.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
    reply.status(404).send({ error: 'Not found' });
  });
}

// Proposal PDF storage files
await fastify.register(fastifyStatic, {
  root: path.resolve(__dirname, '../storage/proposals'),
  prefix: '/storage/proposals/',
  decorateReply: false
});

// Global Error Handler (Enterprise Grade)
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;
  request.log.error({ err: error, userId: request.user?.id, url: request.url, method: request.method, organizationId: request.organizationId }, '🔥 Global Error Caught');
  Sentry.captureException(error, { extra: { url: request.url, method: request.method, userId: request.user?.id, organizationId: request.organizationId, traceId: request.id } });
  reply.status(statusCode).send({ error: error.name || 'InternalServerError', message: error.message || 'An unexpected error occurred', statusCode, traceId: request.id });
});

// Socket.IO
const io = new SocketIO(fastify.server, { cors: { origin: env.isDev ? 'http://localhost:*' : env.corsOrigins, credentials: true } });
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = await fastify.jwt.verify(token);
    socket.userId = decoded.id || decoded.contactId;
    socket.userRole = decoded.role;
    socket.organizationId = decoded.organizationId;
    next();
  } catch (err) { next(new Error('Invalid token')); }
});

fastify.decorate('io', io);
fastify.decorate('notify', async (userId, type, data) => {
  try {
    const { createNotification } = await import('./services/notification.service.js');
    await createNotification({ userId, type, title: type, message: JSON.stringify(data), data });
  } catch (err) { logger.error({ err }, '[notify] Failed to persist notification'); }
  io.to(`user:${userId}`).emit('notification', { type, data });
});

// Initialization
initSubscribers();

const start = async () => {
  try {
    try { initVapid(); } catch (e) { logger.warn({ err: e }, 'Web push init failed'); }
    await fastify.listen({ port: env.port, host: '0.0.0.0' });
    logger.info(`🚀 Agency Hub running at http://localhost:${env.port}`);
    startRecurringInvoicesJob();
    startOverdueChecker();
    startTrashPurgeJob();
  } catch (err) { fastify.log.error(err); process.exit(1); }
};

const shutdown = async () => {
  logger.info('Shutting down...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start();

export { fastify, io };
