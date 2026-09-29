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
import { pubSubRedisSource } from './jobs/queue.js';
import { apiRateLimitKey, createApiRateLimitMax, createRateLimitRedis, isNonApiRequest } from './config/rateLimit.js';
import { trustHops } from './config/trust-proxy.js';
import { requestTimeoutMs } from './config/http.js';
import { spaStaticOptions } from './config/static-cache.js';
import { isCurrentUserSession } from './auth/session.js';
import {
  actorHasOpenView, applyImpersonation, createImpersonationHook, createViewSocketRevoker, socketHandshakeDuringView,
  startViewSocketSweep,
} from './auth/impersonation.js';
import { createNotifier } from './services/notification.service.js';
import { createJoinProjectHandler, createLeaveProjectHandler } from './auth/project-room-access.js';
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

import logger, { resolveLoggerSettings } from './utils/logger.js';
import { LOG_REDACT_OPTIONS, serializeRequestForLog } from './utils/log-redaction.js';
import { initSubscribers } from './subscribers/index.js';
import { registerCallSignalling } from './services/call-signalling.service.js';
import { tenancyMiddleware } from './middleware/tenancy.js';
import { getAuthProvider } from './auth/index.js';
import { toClientErrorBody } from './utils/http-errors.js';
import { buildHelmetOptions, permissionsPolicy } from './config/security-headers.js';
import { initSentry, Sentry } from './observability/sentry.js';
import {
  checkRuntimeHealth,
  closeRuntimeHealth,
  HEALTH_DETAIL_ROLES,
  healthStatusCode,
  isLoopbackPeer,
  isStrictHealthQuery,
  publicHealthView,
} from './services/runtime-health.service.js';
import { getRequestPrisma } from './utils/request-context.js';

/**
 * Construct the complete API application without binding a network port.
 * Runtime-only bridges can be disabled for isolated construction tests.
 */
export async function buildApp({
  initializeRuntime = true,
  jwtSecret = env.jwtSecret,
  trustProxy = env.trustProxy,
  // Tests pass these to exercise the production static-serving path.
  serveBuiltSpa = env.serveBuiltSpa,
  spaRoot = path.join(__dirname, '../dist'),
} = {}) {
// Initialize Sentry error monitoring
if (initializeRuntime && initSentry('api', [Sentry.fastifyIntegration()])) {
  logger.info('[Sentry] Error monitoring initialized');
} else if (initializeRuntime) {
  logger.info('[Sentry] No SENTRY_DSN configured — skipping initialization');
}

// Initialize Fastify
const requestLogSettings = resolveLoggerSettings(env);
const fastify = Fastify({
  // Bound slow request bodies (see src/config/http.js); handler time is not limited.
  requestTimeout: requestTimeoutMs(),
  // Off by default; TRUST_PROXY=1 behind Traefik so per-IP rate limits and
  // audit IP prefixes see the client, not the proxy.
  trustProxy: typeof trustProxy === 'number' ? trustHops(trustProxy) : trustProxy,
  logger: {
    // Same level policy as the app logger (src/utils/logger.js): silent under
    // test unless LOG_LEVEL is set, and then synchronously to stderr so the
    // Node test runner's stdout frame channel stays clean.
    level: requestLogSettings.level,
    ...(env.isTest ? { stream: requestLogSettings.destination } : {}),
    // Never write API keys, session cookies or passwords to request logs.
    redact: { ...LOG_REDACT_OPTIONS, paths: [...LOG_REDACT_OPTIONS.paths] },
    // Nor capability tokens carried in the URL (review share links).
    serializers: { req: serializeRequestForLog },
  }
});

if (env.trustProxyInvalid) {
  fastify.log.warn('TRUST_PROXY must be false, a hop count from 1 to 5, or a list of proxy addresses/CIDRs; ignoring it and trusting no proxy');
}

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
const rateLimitRedis = createRateLimitRedis();
if (rateLimitRedis) fastify.addHook('onClose', async () => { rateLimitRedis.disconnect(); });
await fastify.register(rateLimit, {
  global: true,
  // Signed-in traffic is keyed by the verified user (higher limit); anonymous
  // traffic stays per IP. Route-level limits (login, MFA, share links) keep
  // their own keys. Counters live in Redis when available so every API
  // replica shares them; skipOnError keeps the API up if Redis is not.
  keyGenerator: apiRateLimitKey,
  max: createApiRateLimitMax(),
  ...(rateLimitRedis ? { redis: rateLimitRedis, nameSpace: 'ashbi-rate-limit:' } : {}),
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

// Support impersonation (#416, docs/privileged-actions.md): when the `imp`
// cookie names a live, read-only view, swap request.user for the viewed
// person and refuse writes and sensitive areas. Runs for /api/auth too.
fastify.addHook('onRequest', createImpersonationHook({ prisma, isCurrentUserSession }));

// Auth decorators. Re-verifying the session cookie resets request.user to the
// signed-in admin, so an active impersonation is re-applied afterwards.
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (!(await isCurrentUserSession(prisma, request.user))) throw new Error('Revoked session');
    applyImpersonation(request);
  } catch (err) { return reply.status(401).send({ error: 'Unauthorized' }); }
});

fastify.decorate('adminOnly', async (request, reply) => {
  try {
    await request.jwtVerify();
    if (!(await isCurrentUserSession(prisma, request.user))) throw new Error('Revoked session');
    applyImpersonation(request);
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

// Public readiness: database + Redis decide the status code; a stale worker
// is reported as degraded (still 200). `?strict=1` also requires the worker.
fastify.get('/api/health', async (request, reply) => {
  const report = await checkRuntimeHealth();
  const strict = isStrictHealthQuery(request.query);
  return reply.code(healthStatusCode(report, { strict })).send(publicHealthView(report));
});

// Detailed report (failed jobs, backup, alerting, image digest): staff
// sessions, or the deploy controller via `docker exec` on container loopback.
fastify.get('/api/health/details', {
  onRequest: [async function healthDetailsGuard(request, reply) {
    if (isLoopbackPeer(request)) return;
    await fastify.authenticate(request, reply);
    if (reply.sent) return reply;
    if (!HEALTH_DETAIL_ROLES.includes(request.user?.role)) {
      return reply.status(403).send({ error: 'Staff access required', code: 'FORBIDDEN' });
    }
  }],
}, async (request, reply) => {
  const report = await checkRuntimeHealth();
  const strict = isStrictHealthQuery(request.query);
  return reply.code(healthStatusCode(report, { strict })).send(report);
});

// Static files
if (serveBuiltSpa) {
  // Hashed /assets/* are immutable; index.html, sw.js and the manifest revalidate.
  await fastify.register(fastifyStatic, spaStaticOptions(spaRoot));
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
// Starting a support view drops the admin's sockets on every API instance
// (Redis pub/sub; there is no shared Socket.IO adapter). The sweep is the
// fallback if a revocation message is lost.
// Pub/sub needs its own reconnecting connections (the producer connection
// fails fast and would drop the SUBSCRIBE issued before Redis is ready).
const viewSocketRevoker = createViewSocketRevoker({ io, redis: pubSubRedisSource(), logger: fastify.log });
fastify.decorate('revokeSupportViewSockets', (userId) => viewSocketRevoker.revoke(userId));
const stopViewSocketSweep = startViewSocketSweep(io, prisma, fastify.log);
fastify.addHook('onClose', async () => {
  stopViewSocketSweep();
  await viewSocketRevoker.close();
  await new Promise((resolve) => io.close(resolve));
});
io.use(async (socket, next) => {
  try {
    // Accept an explicit auth payload for native/non-browser clients or the
    // same httpOnly cookie used by browser sessions. Never accept query-string
    // tokens: WebSocket upgrade URLs are routinely logged by proxies.
    const cookies = fastify.parseCookie(socket.handshake.headers.cookie || '');
    if (socketHandshakeDuringView(cookies)) return next(new Error('Realtime is paused during a support view'));
    const cookieToken = cookies.token;
    const token = socket.handshake.auth?.token || cookieToken;
    if (!token) return next(new Error('Authentication required'));
    const decoded = await fastify.jwt.verify(token);
    if (!(await isCurrentUserSession(prisma, decoded))) {
      return next(new Error('Invalid token'));
    }
    if (await actorHasOpenView(prisma, decoded)) return next(new Error('Realtime is paused during a support view'));
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
  // A support view that opened while the handshake was in flight must not
  // leave this socket with the admin's realtime access. The socket waits in
  // a pending room (which starting a view also drops) and every event it
  // sends waits on a re-check; only then does it join the user's own room,
  // so notify() reaches it.
  const pendingRoom = `pending-user:${socket.userId}`;
  if (socket.userId) socket.join(pendingRoom);
  const cleared = socket.userId && socket.organizationId
    ? actorHasOpenView(prisma, { id: socket.userId, organizationId: socket.organizationId }).then((open) => !open, () => false)
    : Promise.resolve(true);
  socket.use((_packet, next) => {
    cleared.then((ok) => (ok ? next() : next(new Error('Realtime is paused during a support view'))));
  });
  cleared.then((ok) => {
    if (!ok) { socket.disconnect(true); return; }
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      socket.leave(pendingRoom);
    }
  });

  // Explicit join is only allowed for the caller's own user room.
  socket.on('join', (userId) => {
    if (userId && userId === socket.userId) socket.join(`user:${userId}`);
  });

  // Staff in the project's org join the internal `project:{id}` room; the
  // project's own client joins only `project:{id}:client` (see
  // project-room-access.js), which never carries internal chat or fields.
  // Acknowledges the result so a reconnecting call can wait for the room
  // before re-signalling.
  socket.on('join-project', createJoinProjectHandler(socket, {
    findProject: (projectId) => prisma.project.findUnique({
      where: { id: projectId },
      select: { clientId: true, client: { select: { organizationId: true } } },
    }),
    logger,
  }));

  socket.on('leave-project', createLeaveProjectHandler(socket));

  registerCallSignalling(io, socket);
});

fastify.decorate('io', io);
// The single notification path (H4, see notification.service.js): notify()
// persists exactly one human-readable row and emits it; emitNotification()
// only emits a row already persisted inside a transaction.
const notifier = createNotifier(io, logger);
fastify.decorate('notify', notifier.notify);
fastify.decorate('emitNotification', notifier.emit);

// Initialization
if (initializeRuntime) initSubscribers({ fastify, io });

return fastify;
}

export { closeRuntimeHealth, env, logger, prisma, Sentry };
