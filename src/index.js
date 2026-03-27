// Agency Hub - Main Entry Point

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { Server as SocketIO } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

import env from './config/env.js';

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
// New feature routes
import chatRoutes from './routes/chat.routes.js';
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
import approvalRoutes from './routes/approvals.routes.js';
import botRoutes from './routes/bot.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import retainerRoutes from './routes/retainer.routes.js';
import reportRoutes from './routes/reports.routes.js';
import leadRoutes from './routes/leads.routes.js';
import credentialRoutes from './routes/credential.routes.js';
import portalRoutes from './routes/portal.routes.js';
import templateRoutes from './routes/template.routes.js';
import outreachRoutes from './routes/outreach.routes.js';
import socialRoutes from './routes/social.routes.js';
import blogRoutes from './routes/blog.routes.js';
import aiTeamRoutes from './routes/ai-team.routes.js';
// AI Employee Suite
import emailTriageRoutes from './routes/email-triage.routes.js';
import contentWriterRoutes from './routes/content-writer.routes.js';
import linkedinOutreachRoutes from './routes/linkedin-outreach.routes.js';
import coldEmailRoutes from './routes/cold-email.routes.js';
import callScreenerRoutes from './routes/call-screener.routes.js';
// Task-based agents
import leadGenRoutes from './routes/lead-gen.routes.js';
import socialContentRoutes from './routes/social-content.routes.js';
import seoBlogRoutes from './routes/seo-blog.routes.js';
import proposalsAiRoutes from './routes/proposals-ai.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import invoiceChaserRoutes from './routes/invoice-chaser.routes.js';
import clientHealthRoutes from './routes/client-health.routes.js';
import revenueRoutes from './routes/revenue.routes.js';
import aiContextRoutes from './routes/ai-context.routes.js';
import upworkContractRoutes from './routes/upwork-contracts.routes.js';
import upworkMessagesRoutes from './routes/upwork-messages.routes.js';
// Agent routes
import shopifyAgentRoutes from './routes/shopify-agent.routes.js';
import wordpressAgentRoutes from './routes/wordpress-agent.routes.js';
import salesAgentRoutes from './routes/sales-agent.routes.js';
import creativeAgentRoutes from './routes/creative-agent.routes.js';
import opsAgentRoutes from './routes/ops-agent.routes.js';
import financeAgentRoutes from './routes/finance-agent.routes.js';
import clientSuccessAgentRoutes from './routes/client-success-agent.routes.js';
import gmailRoutes from './routes/gmail.routes.js';
// Command Center integrations
import integrationsGithubRoutes from './routes/integrations.github.routes.js';
import integrationsVpsRoutes from './routes/integrations.vps.routes.js';
import integrationsHostingerRoutes from './routes/integrations.hostinger.routes.js';
import integrationsNotionRoutes from './routes/integrations.notion.routes.js';
import agentsRoutes from './routes/integrations.agents.routes.js';
import commandCenterRoutes from './routes/integrations.command-center.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Prisma
export const prisma = new PrismaClient();

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: env.isDev ? 'info' : 'warn'
  }
});

// Register plugins
await fastify.register(cors, {
  origin: env.isDev ? true : env.corsOrigins,
  credentials: true
});

await fastify.register(cookie);

await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
});

await fastify.register(jwt, {
  secret: env.jwtSecret,
  cookie: {
    cookieName: 'token',
    signed: false
  }
});

// Auth decorator
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

// Admin-only decorator
fastify.decorate('adminOnly', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (request.user.role !== 'ADMIN') {
      reply.status(403).send({ error: 'Admin access required' });
    }
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

// Make prisma available in routes
fastify.decorate('prisma', prisma);

// Register API routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(clientPortalRoutes, { prefix: '/api' });
await fastify.register(webhookRoutes, { prefix: '/api/webhooks' });
await fastify.register(inboxRoutes, { prefix: '/api/inbox' });
await fastify.register(clientRoutes, { prefix: '/api/clients' });
await fastify.register(projectRoutes, { prefix: '/api/projects' });
await fastify.register(threadRoutes, { prefix: '/api/threads' });
await fastify.register(responseRoutes, { prefix: '/api/responses' });
await fastify.register(teamRoutes, { prefix: '/api/team' });
await fastify.register(taskRoutes, { prefix: '/api/tasks' });
await fastify.register(searchRoutes, { prefix: '/api/search' });
await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
await fastify.register(aiRoutes, { prefix: '/api/ai' });
await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
// New feature routes
await fastify.register(chatRoutes, { prefix: '/api/chat' });
await fastify.register(noteRoutes, { prefix: '/api' });
await fastify.register(milestoneRoutes, { prefix: '/api' });
await fastify.register(timeRoutes, { prefix: '/api' });
await fastify.register(attachmentRoutes, { prefix: '/api' });
await fastify.register(activityRoutes, { prefix: '/api' });
await fastify.register(commentRoutes, { prefix: '/api' });
await fastify.register(calendarRoutes, { prefix: '/api' });
await fastify.register(revisionRoutes, { prefix: '/api' });
await fastify.register(messageRoutes, { prefix: '/api' });
await fastify.register(mailgunRoutes, { prefix: '/api/mailgun' });
await fastify.register(approvalRoutes, { prefix: '/api' });
await fastify.register(botRoutes, { prefix: '/api/bot' });
await fastify.register(onboardingRoutes, { prefix: '/api/onboarding' });
await fastify.register(retainerRoutes, { prefix: '/api' });
await fastify.register(reportRoutes, { prefix: '/api/reports' });
await fastify.register(leadRoutes, { prefix: '/api' });
await fastify.register(credentialRoutes, { prefix: '/api/credentials' });
await fastify.register(portalRoutes, { prefix: '/api/portal' });
await fastify.register(templateRoutes, { prefix: '/api/templates' });
await fastify.register(outreachRoutes, { prefix: '/api/outreach' });
await fastify.register(socialRoutes, { prefix: '/api/social' });
await fastify.register(blogRoutes, { prefix: '/api/blog' });
await fastify.register(aiTeamRoutes, { prefix: '/api/ai-team' });
// AI Employee Suite
await fastify.register(emailTriageRoutes, { prefix: '/api/email-triage' });
await fastify.register(contentWriterRoutes, { prefix: '/api/content-writer' });
await fastify.register(linkedinOutreachRoutes, { prefix: '/api/linkedin-outreach' });
await fastify.register(coldEmailRoutes, { prefix: '/api/cold-email' });
await fastify.register(callScreenerRoutes, { prefix: '/api/call-screener' });
// Task-based agents
await fastify.register(leadGenRoutes, { prefix: '/api/lead-gen' });
await fastify.register(socialContentRoutes, { prefix: '/api/social-content' });
await fastify.register(seoBlogRoutes, { prefix: '/api/seo-blog' });
await fastify.register(proposalsAiRoutes, { prefix: '/api/proposals-ai' });
await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
await fastify.register(invoiceChaserRoutes, { prefix: '/api/invoice-chaser' });
  await fastify.register(clientHealthRoutes, { prefix: '/api/clients' });
  await fastify.register(revenueRoutes, { prefix: '/api/revenue' });
await fastify.register(aiContextRoutes, { prefix: '/api/settings/ai-context' });
await fastify.register(upworkContractRoutes, { prefix: '/api/upwork-contracts' });
await fastify.register(upworkMessagesRoutes, { prefix: '/api/upwork' });
// Agent routes
await fastify.register(shopifyAgentRoutes, { prefix: '/api/shopify' });
await fastify.register(wordpressAgentRoutes, { prefix: '/api/wordpress' });
await fastify.register(salesAgentRoutes, { prefix: '/api/sales' });
await fastify.register(creativeAgentRoutes, { prefix: '/api/creative' });
await fastify.register(opsAgentRoutes, { prefix: '/api/ops' });
await fastify.register(financeAgentRoutes, { prefix: '/api/finance' });
await fastify.register(clientSuccessAgentRoutes, { prefix: '/api/client-success' });
await fastify.register(gmailRoutes, { prefix: '/api/gmail' });
// Command Center integrations
await fastify.register(integrationsGithubRoutes, { prefix: '/api/integrations/github' });
await fastify.register(integrationsVpsRoutes, { prefix: '/api/integrations/vps' });
await fastify.register(integrationsHostingerRoutes, { prefix: '/api/integrations/hostinger' });
await fastify.register(integrationsNotionRoutes, { prefix: '/api/integrations/notion' });
await fastify.register(agentsRoutes, { prefix: '/api/agents' });
await fastify.register(commandCenterRoutes, { prefix: '/api/command-center' });

// Serve static frontend in production
if (!env.isDev) {
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../dist'),
    prefix: '/'
  });

  // SPA fallback
  fastify.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    reply.status(404).send({ error: 'Not found' });
  });
}

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Setup Socket.IO for real-time notifications
const io = new SocketIO(fastify.server, {
  cors: {
    origin: env.isDev ? '*' : env.corsOrigins,
    credentials: true
  }
});

io.on('connection', (socket) => {
  fastify.log.info(`Client connected: ${socket.id}`);

  socket.on('error', (err) => {
    fastify.log.error({ err, socketId: socket.id }, 'Socket error');
  });

  // Join user's personal room for notifications
  socket.on('join', (userId) => {
    socket.join(`user:${userId}`);
    socket.userId = userId;
    fastify.log.info(`User ${userId} joined their room`);
  });

  // Join project room for real-time chat
  socket.on('join-project', (projectId) => {
    socket.join(`project:${projectId}`);
    fastify.log.info(`Socket ${socket.id} joined project:${projectId}`);
  });

  // Leave project room
  socket.on('leave-project', (projectId) => {
    socket.leave(`project:${projectId}`);
    fastify.log.info(`Socket ${socket.id} left project:${projectId}`);
  });

  // Typing indicator for project chat
  socket.on('typing', ({ projectId, isTyping }) => {
    socket.to(`project:${projectId}`).emit('user-typing', {
      userId: socket.userId,
      isTyping
    });
  });

  socket.on('disconnect', (reason) => {
    fastify.log.info(`Client disconnected: ${socket.id} (${reason})`);
  });
});

io.engine.on('connection_error', (err) => {
  fastify.log.error({ err }, 'Socket.IO connection error');
});

// Make io available globally
fastify.decorate('io', io);

// Global notification helper
fastify.decorate('notify', (userId, type, data) => {
  io.to(`user:${userId}`).emit('notification', { type, data });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: env.port, host: '0.0.0.0' });
    console.log(`🚀 Agency Hub running at http://localhost:${env.port}`);
    console.log(`   Environment: ${env.nodeEnv}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

export { fastify, io };
