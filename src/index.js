
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
import analyticsRoutes from './routes/analytics.routes.js';
import aiRoutes from './routes/ai.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import chatRoutes from './routes/chat.routes.js';
import ashChatRoutes from './routes/ash-chat.routes.js';
import noteRoutes from './routes/note.routes.js';
import milestoneRoutes from './routes/milestone.routes.js';
import timeRoutes from './routes/time.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import activityRoutes from './routes/activity.routes.js';
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
import reportRoutes from './routes/reports.routes.js';
import leadRoutes from './routes/leads.routes.js';
import landingRoutes from './routes/landing.routes.js';
import credentialRoutes from './routes/credential.routes.js';
import portalRoutes from './routes/portal.routes.js';
import templateRoutes from './routes/template.routes.js';
import outreachRoutes from './routes/outreach.routes.js';
import socialRoutes from './routes/social.routes.js';
import blogRoutes from './routes/blog.routes.js';
import aiTeamRoutes from './routes/ai-team.routes.js';
import emailTriageRoutes from './routes/email-triage.routes.js';
import contentWriterRoutes from './routes/content-writer.routes.js';
import linkedinOutreachRoutes from './routes/linkedin-outreach.routes.js';
import coldEmailRoutes from './routes/cold-email.routes.js';
import callScreenerRoutes from './routes/call-screener.routes.js';
import leadGenRoutes from './routes/lead-gen.routes.js';
import socialContentRoutes from './routes/social-content.routes.js';
import seoBlogRoutes from './routes/seo-blog.routes.js';
import proposalsAiRoutes from './routes/proposals-ai.routes.js';
import proposalRoutes from './routes/proposal.routes.js';
import notionSyncRoutes from './routes/notion-sync.routes.js';
import contractRoutes from './routes/contract.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import invoiceChaserRoutes from './routes/invoice-chaser.routes.js';
import clientHealthRoutes from './routes/client-health.routes.js';
import revenueRoutes from './routes/revenue.routes.js';
import aiContextRoutes from './routes/ai-context.routes.js';
import upworkContractRoutes from './routes/upwork-contracts.routes.js';
import upworkMessagesRoutes from './routes/upwork-messages.routes.js';
import shopifyAgentRoutes from './routes/shopify-agent.routes.js';
import wordpressAgentRoutes from './routes/wordpress-agent.routes.js';
import salesAgentRoutes from './routes/sales-agent.routes.js';
import creativeAgentRoutes from './routes/creative-agent.routes.js';
import opsAgentRoutes from './routes/ops-agent.routes.js';
import financeAgentRoutes from './routes/finance-agent.routes.js';
import clientSuccessAgentRoutes from './routes/client-success-agent.routes.js';
import gmailRoutes from './routes/gmail.routes.js';
import integrationsGithubRoutes from './routes/integrations.github.routes.js';
import integrationsVpsRoutes from './routes/integrations.vps.routes.js';
import integrationsHostingerRoutes from './routes/integrations.hostinger.routes.js';
import agentsRoutes from './routes/integrations.agents.routes.js';
import pushRoutes from './routes/push.routes.js';
import { initVapid } from './utils/web-push.js';
import commandCenterRoutes from './routes/integrations.command-center.routes.js';
import expenseRoutes from './routes/expense.routes.js';
import { startRecurringInvoicesJob } from './jobs/recurring-invoices.js';
import automationRoutes from './routes/automation.routes.js';
import intakeFormRoutes from './routes/intake-form.routes.js';
import brandRoutes from './routes/brand.routes.js';
import { startOverdueChecker } from './services/automation.service.js';
import pipelineRoutes from './routes/pipeline.routes.js';
import { initHermesBridge } from './agents/hub-hermes.integration.js';
import timeTrackingRoutes from './routes/time-tracking.routes.js';
import semanticSearchRoutes from './routes/semantic-search.routes.js';
import adCopyRoutes from './routes/ad-copy.routes.js';
import creativeBriefRoutes from './routes/creative-brief.routes.js';
import seoAuditRoutes from './routes/seo-audit.routes.js';
import contentCalendarRoutes from './routes/content-calendar.routes.js';
import socialSchedulerRoutes from './routes/social-scheduler.routes.js';
import snippetLibraryRoutes from './routes/snippet-library.routes.js';
import assetLibraryRoutes from './routes/asset-library.routes.js';
import wpBridgeRoutes from './routes/wp-bridge.routes.js';
import surveyRoutes from './routes/survey.routes.js';
import apiKeyRoutes, { authenticateApiKey } from './routes/api-key.routes.js';
import estimateRoutes from './routes/estimate.routes.js';
import rateCardRoutes from './routes/rate-card.routes.js';
import bookkeepingRoutes from './routes/bookkeeping.routes.js';
import integrationRoutes from './routes/integration.routes.js';
import outreachSchedulerRoutes from './routes/outreach-scheduler.routes.js';
import referralEngineRoutes from './routes/referral-engine.routes.js';
import upworkAgentRoutes from './routes/upwork-agent.routes.js';
import upworkJobsRoutes from './routes/upwork-jobs.routes.js';
import leadIntelligenceRoutes from './routes/lead-intelligence.routes.js';
import proposalBuilderRoutes from './routes/proposal-builder.routes.js';
import coldCallRoutes from './routes/cold-call.routes.js';
import upworkAutoAlertRoutes from './routes/upwork-auto-alert.routes.js';

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
await fastify.register(cors, { origin: env.isDev ? true : env.corsOrigins, credentials: true });
await fastify.register(cookie);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await fastify.register(rateLimit, { global: true, max: 100, timeWindow: '1 minute', skipOnError: true });
await fastify.register(jwt, { secret: env.jwtSecret, cookie: { cookieName: 'token', signed: false } });

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
fastify.decorate('prisma', prisma);
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
await fastify.register(outreachSchedulerRoutes, { prefix: '/api/outreach-scheduler' });
await fastify.register(referralEngineRoutes, { prefix: '/api/referral-engine' });
await fastify.register(upworkAgentRoutes, { prefix: '/api/upwork' });
await fastify.register(upworkJobsRoutes, { prefix: '/api/upwork' });
await fastify.register(leadIntelligenceRoutes, { prefix: '/api/lead-intelligence' });
await fastify.register(proposalBuilderRoutes, { prefix: '/api/proposal-builder' });
await fastify.register(coldCallRoutes, { prefix: '/api/cold-call' });
await fastify.register(coldEmailRoutes, { prefix: '/api/cold-email' });
await fastify.register(upworkAutoAlertRoutes, { prefix: '/api/upwork-auto-alert' });
// Route registrations continued
await fastify.register(wpBridgeRoutes, { prefix: '/api/wp-bridge' });
await fastify.register(surveyRoutes, { prefix: '/api/surveys' });
await fastify.register(apiKeyRoutes, { prefix: '/api/api-keys' });
await fastify.register(estimateRoutes, { prefix: '/api/estimates' });
await fastify.register(rateCardRoutes, { prefix: '/api/rate-cards' });
await fastify.register(bookkeepingRoutes, { prefix: '/api/bookkeeping' });
await fastify.register(integrationRoutes, { prefix: '/api/integrations' });
await fastify.register(notionSyncRoutes, { prefix: '/api/notion-sync' });
await fastify.register(brandRoutes, { prefix: '/api/brand' });
await fastify.register(pipelineRoutes, { prefix: '/api/pipeline' });
await fastify.register(timeTrackingRoutes, { prefix: '/api/time-tracking' });
await fastify.register(semanticSearchRoutes, { prefix: '/api/semantic-search' });
await fastify.register(adCopyRoutes, { prefix: '/api/ad-copy' });
await fastify.register(creativeBriefRoutes, { prefix: '/api/creative-brief' });
await fastify.register(seoAuditRoutes, { prefix: '/api/seo-audit' });
await fastify.register(contentCalendarRoutes, { prefix: '/api/content-calendar' });
await fastify.register(socialSchedulerRoutes, { prefix: '/api/social-scheduler' });
await fastify.register(snippetLibraryRoutes, { prefix: '/api/snippet-library' });
await fastify.register(assetLibraryRoutes, { prefix: '/api/asset-library' });
await fastify.register(automationRoutes, { prefix: '/api/automations' });
await fastify.register(intakeFormRoutes, { prefix: '/api/intake-forms' });
await fastify.register(expenseRoutes, { prefix: '/api/expenses' });
await fastify.register(commandCenterRoutes, { prefix: '/api/command-center' });
await fastify.register(pushRoutes, { prefix: '/api/push' });
await fastify.register(agentsRoutes, { prefix: '/api/agents' });
await fastify.register(integrationsVpsRoutes, { prefix: '/api/integrations/vps' });
await fastify.register(integrationsHostingerRoutes, { prefix: '/api/integrations/hostinger' });
await fastify.register(integrationsGithubRoutes, { prefix: '/api/integrations/github' });
await fastify.register(clientSuccessAgentRoutes, { prefix: '/api/client-success' });
await fastify.register(financeAgentRoutes, { prefix: '/api/finance' });
await fastify.register(opsAgentRoutes, { prefix: '/api/ops' });
await fastify.register(creativeAgentRoutes, { prefix: '/api/creative' });
await fastify.register(salesAgentRoutes, { prefix: '/api/sales' });
await fastify.register(shopifyAgentRoutes, { prefix: '/api/shopify' });
await fastify.register(upworkMessagesRoutes, { prefix: '/api/upwork-messages' });
await fastify.register(upworkContractRoutes, { prefix: '/api/upwork-contracts' });
await fastify.register(aiContextRoutes, { prefix: '/api/ai-context' });
await fastify.register(revenueRoutes, { prefix: '/api/revenue' });
await fastify.register(clientHealthRoutes, { prefix: '/api/client-health' });
await fastify.register(invoiceChaserRoutes, { prefix: '/api/invoice-chaser' });
await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
await fastify.register(contractRoutes, { prefix: '/api/contracts' });
await fastify.register(proposalRoutes, { prefix: '/api/proposals' });
await fastify.register(proposalsAiRoutes, { prefix: '/api/proposals-ai' });
await fastify.register(seoBlogRoutes, { prefix: '/api/seo-blog' });
await fastify.register(socialContentRoutes, { prefix: '/api/social-content' });
await fastify.register(leadGenRoutes, { prefix: '/api/lead-gen' });
await fastify.register(callScreenerRoutes, { prefix: '/api/call-screener' });
await fastify.register(linkedinOutreachRoutes, { prefix: '/api/linkedin-outreach' });
await fastify.register(contentWriterRoutes, { prefix: '/api/content-writer' });
await fastify.register(emailTriageRoutes, { prefix: '/api/email-triage' });
await fastify.register(aiTeamRoutes, { prefix: '/api/ai-team' });
await fastify.register(blogRoutes, { prefix: '/api/blog' });
await fastify.register(socialRoutes, { prefix: '/api/social' });
await fastify.register(outreachRoutes, { prefix: '/api/outreach' });
await fastify.register(templateRoutes, { prefix: '/api/templates' });
await fastify.register(portalRoutes, { prefix: '/api/portal' });
await fastify.register(credentialRoutes, { prefix: '/api/credentials' });
await fastify.register(leadRoutes, { prefix: '/api/leads' });
await fastify.register(landingRoutes, { prefix: '/api/leads' });
await fastify.register(reportRoutes, { prefix: '/api/reports' });
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
await fastify.register(activityRoutes, { prefix: '/api/activity' });
await fastify.register(attachmentRoutes, { prefix: '/api/attachments' });
await fastify.register(timeRoutes, { prefix: '/api/time' });
await fastify.register(milestoneRoutes, { prefix: '/api/milestones' });
await fastify.register(noteRoutes, { prefix: '/api/notes' });
await fastify.register(ashChatRoutes, { prefix: '/api/ash-chat' });
await fastify.register(chatRoutes, { prefix: '/api/chat' });
await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
await fastify.register(searchRoutes, { prefix: '/api/search' });
await fastify.register(teamRoutes, { prefix: '/api/team' });
await fastify.register(responseRoutes, { prefix: '/api/responses' });
await fastify.register(threadRoutes, { prefix: '/api/threads' });
await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
await fastify.register(clientPortalRoutes, { prefix: '/api/client-portal' });
await fastify.register(wordpressAgentRoutes, { prefix: '/api/wordpress' });
await fastify.register(gmailRoutes, { prefix: '/api/gmail' });
await fastify.register(contractRoutes, { prefix: '/api/contracts' });
await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
// ... (all other routes would be registered here in a production app, condensed for space)

// Hub-Hermes bridge initialization
initHermesBridge(fastify);

// Static files
if (!env.isDev) {
  // Health check endpoint
  fastify.get("/api/health", async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await fastify.register(fastifyStatic, { root: path.join(__dirname, '../dist'), prefix: '/' });
  fastify.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
  // Health check endpoint
    reply.status(404).send({ error: 'Not found' });
  });
}

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
