// Agency Hub - Main Entry Point

import Fastify from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import env from './config/env.js';
import prisma from './config/db.js';
import { apiRateLimitMax, isNonApiRequest } from './config/rateLimit.js';
import { isCurrentUserSession } from './auth/session.js';
import { canJoinProjectRoom } from './auth/project-room-access.js';
import { clientAcquisitionCorsOptions, loadClientAcquisitionConfig } from './services/client-acquisition.contract.js';
import { initHermesBridge } from './agents/hub-hermes.integration.js';

// Route domains (see docs/backend-application-boundaries.md)
import { registerIdentityRoutes, authenticateApiKey } from './domains/identity/register-routes.js';
import { registerWorkManagementRoutes } from './domains/client-delivery/register-work-management-routes.js';
import { registerInboxRoutes } from './domains/client-communications/register-inbox-routes.js';
import { registerPlatformRoutes } from './domains/platform/register-routes.js';
import { registerAiRoutes } from './domains/ai/register-routes.js';
import { registerCommercialRevenueRoutes } from './domains/revenue/register-commercial-routes.js';
import { registerIntegrationRoutes } from './domains/integrations/register-routes.js';
import { registerClientWorkspaceRoutes } from './domains/client-delivery/register-workspace-routes.js';
import { registerCoreRevenueRoutes } from './domains/revenue/register-core-routes.js';
import { registerCollaborationRoutes } from './domains/client-delivery/register-collaboration-routes.js';
import { registerConversationRoutes } from './domains/client-communications/register-conversation-routes.js';
import { registerClientCommunicationRoutes } from './domains/client-communications/register-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import logger from './utils/logger.js';
import { initSubscribers } from './subscribers/index.js';
import { registerCallSignalling } from './services/call-signalling.service.js';
import { tenancyMiddleware } from './middleware/tenancy.js';
import { getAuthProvider } from './auth/index.js';
import { toClientErrorBody } from './utils/http-errors.js';
import { buildHelmetOptions, permissionsPolicy } from './config/security-headers.js';
import { initSentry, Sentry } from './observability/sentry.js';
import { checkRuntimeHealth, closeRuntimeHealth } from './services/runtime-health.service.js';
import { getRequestPrisma } from './utils/request-context.js';

/**
 * Construct the complete API application without binding a network port.
 * Runtime-only bridges can be disabled for isolated construction tests.
 */
export async function buildApp({ initializeRuntime = true, jwtSecret = env.jwtSecret } = {}) {
// Initialize Sentry error monitoring
if (initializeRuntime && initSentry('api', [Sentry.fastifyIntegration()])) {
  logger.info('[Sentry] Error monitoring initialized');
} else if (initializeRuntime) {
  logger.info('[Sentry] No SENTRY_DSN configured — skipping initialization');
}

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: env.isDev ? 'debug' : 'info'
  }
});

// Attach Sentry error handler (must be after Fastify creation, before plugins/routes)
if (initializeRuntime && env.sentryDsn) {
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
await fastify.register(helmet, buildHelmetOptions(env));
fastify.addHook('onSend', async (_request, reply, payload) => {
  reply.header('Permissions-Policy', permissionsPolicy);
  return payload;
});
await fastify.register(compress, { global: true });
const appCorsOptions = { origin: env.isDev ? ['http://localhost:3000', 'http://localhost:5173'] : env.corsOrigins, credentials: true };
await fastify.register(cors, {
  // The public ashbi.ca inquiry API gets its own allowlist and never accepts
  // credentialed (cookie) requests; everything else keeps the app policy.
  delegator: (request, callback) => {
    const url = request.raw?.url || request.url || '';
    if (/^\/api\/client-acquisition\/(?:config|intake)(?:[/?]|$)/.test(url)) {
      callback(null, clientAcquisitionCorsOptions(loadClientAcquisitionConfig()));
      return;
    }
    callback(null, appCorsOptions);
  },
});
await fastify.register(cookie);
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await fastify.register(rateLimit, {
  global: true,
  max: apiRateLimitMax(),
  timeWindow: '1 minute',
  skipOnError: true,
  // Frontend navigation loads many immutable chunks in parallel. Counting those
  // files can lock users out of the application shell before they call an API.
  allowList: isNonApiRequest,
});
await fastify.register(jwt, { secret: jwtSecret, cookie: { cookieName: 'token', signed: false } });

// JWT verification hook — runs for ALL /api/* requests BEFORE tenancyMiddleware
fastify.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;
  // Skip auth-exempt routes
  if (
    request.url.startsWith('/api/auth') ||
    request.url.startsWith('/api/portal') ||
    request.url.startsWith('/api/client-acquisition/config') ||
    request.url.startsWith('/api/client-acquisition/intake') ||
    request.url === '/api/health' ||
    request.url === '/api/live'
  ) return;
  let jwtVerified = false;
  try {
    await request.jwtVerify();
    jwtVerified = true;
  } catch {
    // No valid token — let route-specific auth handle 401
  }
  if (jwtVerified) {
    try {
      if (!(await isCurrentUserSession(prisma, request.user))) {
        return reply.status(401).send({ error: 'Session expired or revoked' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unable to validate session' });
    }
  }
});

// Auth decorators
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (!(await isCurrentUserSession(prisma, request.user))) throw new Error('Revoked session');
  } catch (err) { return reply.status(401).send({ error: 'Unauthorized' }); }
});

fastify.decorate('adminOnly', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (!(await isCurrentUserSession(prisma, request.user))) throw new Error('Revoked session');
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

// Routes — every route module is registered by a domain registrar. Route
// plugins are encapsulated, so domains are ordered by where each one first
// appeared in the pre-extraction sequence.
await registerIdentityRoutes(fastify);
await registerWorkManagementRoutes(fastify);
await registerInboxRoutes(fastify);
await registerPlatformRoutes(fastify);
await registerAiRoutes(fastify);
await registerCommercialRevenueRoutes(fastify);
await registerIntegrationRoutes(fastify);
await registerClientWorkspaceRoutes(fastify);
await registerCoreRevenueRoutes(fastify);
await registerCollaborationRoutes(fastify);
await registerConversationRoutes(fastify);
await registerClientCommunicationRoutes(fastify);

// Hub-Hermes bridge initialization
if (initializeRuntime) initHermesBridge(fastify);

fastify.get('/api/live', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  revision: process.env.APP_REVISION || 'unknown',
}));

fastify.get('/api/health', async (_request, reply) => {
  const report = await checkRuntimeHealth();
  return reply.code(report.ready ? 200 : 503).send(report);
});

// Static files
if (env.serveBuiltSpa) {
  await fastify.register(fastifyStatic, { root: path.join(__dirname, '../dist'), prefix: '/' });
  fastify.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/')) return reply.sendFile('index.html');
    reply.status(404).send({ error: 'Not found' });
  });
}

// Proposal PDFs are served only via authenticated /api/proposal-builder/:id/pdf
// (and portal token routes). Do not expose storage/proposals/ as public static files.

// Global Error Handler (Enterprise Grade)
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;
  request.log.error({
    errorName: error.name,
    statusCode,
    route: request.routeOptions?.url || 'unknown',
    method: request.method,
    traceId: request.id,
  }, 'Global request error');
  Sentry.captureException(error, {
    extra: {
      route: request.routeOptions?.url || 'unknown',
      method: request.method,
      traceId: request.id,
    },
  });
  reply.status(statusCode).send(toClientErrorBody(error, { traceId: request.id }));
});

// Socket.IO
const io = new SocketIO(fastify.server, { cors: { origin: env.isDev ? 'http://localhost:*' : env.corsOrigins, credentials: true } });
fastify.addHook('onClose', async () => {
  await new Promise((resolve) => io.close(resolve));
});
io.use(async (socket, next) => {
  try {
    // Accept an explicit auth payload for native/non-browser clients or the
    // same httpOnly cookie used by browser sessions. Never accept query-string
    // tokens: WebSocket upgrade URLs are routinely logged by proxies.
    const cookieToken = fastify.parseCookie(socket.handshake.headers.cookie || '').token;
    const token = socket.handshake.auth?.token || cookieToken;
    if (!token) return next(new Error('Authentication required'));
    const decoded = await fastify.jwt.verify(token);
    if (!(await isCurrentUserSession(prisma, decoded))) {
      return next(new Error('Invalid token'));
    }
    socket.userId = decoded.id || decoded.contactId;
    socket.userRole = decoded.role;
    socket.organizationId = decoded.organizationId;
    socket.clientId = decoded.clientId;
    next();
  } catch (err) { next(new Error('Invalid token')); }
});

// Socket.IO connection handling. Without this, the client-emitted `join` /
// `join-project` events were never handled, so room-scoped notifications
// (io.to(`user:...`)) were never delivered. Rooms are authorized server-side.
io.on('connection', (socket) => {
  // Auto-join the authenticated user's own room so notify() reaches them.
  if (socket.userId) socket.join(`user:${socket.userId}`);

  // Explicit join is only allowed for the caller's own user room.
  socket.on('join', (userId) => {
    if (userId && userId === socket.userId) socket.join(`user:${userId}`);
  });

  // Join a project room only if the caller is staff in the project's org or
  // the project's own client (see canJoinProjectRoom).
  socket.on('join-project', async (projectId) => {
    if (!projectId) return;
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { clientId: true, client: { select: { organizationId: true } } },
      });
      if (canJoinProjectRoom(socket, project)) socket.join(`project:${projectId}`);
    } catch (err) {
      logger.error({ err, projectId }, '[socket] join-project authorization failed');
    }
  });

  socket.on('leave-project', (projectId) => {
    if (projectId) socket.leave(`project:${projectId}`);
  });

  registerCallSignalling(io, socket);
});

fastify.decorate('io', io);
fastify.decorate('notify', async (userId, type, data) => {
  try {
    const { createNotification } = await import('./services/notification.service.js');
    await createNotification({ userId, type, title: type, message: JSON.stringify(data), data }, { io });
  } catch (err) { logger.error({ err }, '[notify] Failed to persist notification'); }
  io.to(`user:${userId}`).emit('notification', { type, data });
});

// Initialization
if (initializeRuntime) initSubscribers({ fastify, io });

return fastify;
}

export { closeRuntimeHealth, env, logger, prisma, Sentry };
