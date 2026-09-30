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
import { attachRedisAdapter } from './realtime/adapter.js';
import { closeRealtimeEmitter } from './realtime/emitter.js';
import { realtimeRedisSource } from './realtime/redis.js';
import { apiRateLimitKey, createApiRateLimitMax, createRateLimitRedis, isNonApiRequest } from './config/rateLimit.js';
import { trustHops } from './config/trust-proxy.js';
import { clearStaleSessionCookie, resolveRequestSession } from './auth/request-session.js';
import { requestTimeoutMs } from './config/http.js';
import { spaStaticOptions } from './config/static-cache.js';
import { isCurrentUserSession } from './auth/session.js';
import { createNotifier } from './services/notification.service.js';
import {
  actorHasOpenView, applyImpersonation, createImpersonationHook, createViewSocketRevoker, socketHandshakeDuringView,
  startViewSocketSweep,
} from './auth/impersonation.js';
import { createJoinProjectHandler, createLeaveProjectHandler } from './auth/project-room-access.js';
import { createSocketAuthMiddleware, withClientReauthorization } from './auth/socket-auth.js';
import { clientSocketRooms, disconnectClientSockets, startClientSocketSweep } from './auth/client-socket-revocation.js';
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
import { clientErrorStatus, toClientErrorBody } from './utils/http-errors.js';
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

// Global Error Handler. Registered before any route plugin: an encapsulated
// plugin keeps the error handler its parent had when it was registered, so a
// handler set after the routes would never apply to them and they would fall
// back to Fastify's default, which sends raw error messages (Prisma
// invocations, tenancy details) to clients.
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = clientErrorStatus(error);
  const logFields = {
    errorName: error.name,
    errorCode: typeof error.code === 'string' ? error.code : undefined,
    statusCode,
    route: request.routeOptions?.url || 'unknown',
    method: request.method,
    traceId: request.id,
  };
  if (statusCode >= 500) {
    request.log.error(logFields, 'Global request error');
    Sentry.captureException(error, {
      extra: {
        route: request.routeOptions?.url || 'unknown',
        method: request.method,
        traceId: request.id,
      },
    });
  } else {
    request.log.info(logFields, 'Request rejected');
  }
  reply.status(statusCode).send(toClientErrorBody(error, { traceId: request.id }));
});

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
  // A token that is not a current session (stale, revoked, untyped, or not a
  // session at all) makes the request anonymous and its cookie is cleared:
  // each route's own guard decides, so public routes never 401 because of a
  // stale cookie (src/auth/request-session.js).
  // If the session store is unreachable the request is also anonymous here
  // (the cookie is kept); guarded routes then answer 401 themselves.
  const session = await resolveRequestSession(request, prisma);
  if (session === 'stale') clearStaleSessionCookie(request, reply);
  if (session === 'error') request.log.warn('Session validation unavailable; continuing without a session');
});

// Support impersonation (#416, docs/privileged-actions.md): when the `imp`
// cookie names a live, read-only view, swap request.user for the viewed
// person and refuse writes and sensitive areas. Runs for /api/auth too.
fastify.addHook('onRequest', createImpersonationHook({ prisma, isCurrentUserSession }));

// Auth decorators. Re-verifying the session cookie resets request.user to the
// signed-in admin, so an active impersonation is re-applied afterwards.
fastify.decorate('authenticate', async (request, reply) => {
  const session = await resolveRequestSession(request, prisma);
  if (session !== 'current') {
    if (session === 'stale') clearStaleSessionCookie(request, reply);
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  applyImpersonation(request);
  return undefined;
});

fastify.decorate('adminOnly', async (request, reply) => {
  const session = await resolveRequestSession(request, prisma);
  if (session !== 'current') {
    if (session === 'stale') clearStaleSessionCookie(request, reply);
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  applyImpersonation(request);
  if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  return undefined;
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

// Socket.IO
const io = new SocketIO(fastify.server, { cors: { origin: env.isDev ? 'http://localhost:*' : env.corsOrigins, credentials: true } });
// With REDIS_URL set (and outside tests) every API instance shares the Redis
// adapter (src/realtime/adapter.js): a room emit reaches that room's sockets
// on every replica, fetchSockets() sees remote sockets, and packets the worker
// publishes through its Redis emitter (src/realtime/emitter.js) are delivered
// here. Without Redis the default in-memory adapter serves one instance.
// The adapter needs its own reconnecting pub/sub connections.
const realtimeAdapter = attachRedisAdapter(io, realtimeRedisSource());
// Starting a support view drops the admin's sockets on every API instance.
// With the Redis adapter, disconnectSockets() already broadcasts to every
// replica, but it is fire-and-forget; the revoker's own Redis pub/sub is kept
// because revoke() resolves only once Redis accepted the publish, and the
// view must not be reported as started before that. It also still covers
// replicas when the adapter is off. The sweep is the fallback if a
// revocation message is lost.
// Pub/sub needs its own reconnecting connections (the producer connection
// fails fast and would drop the SUBSCRIBE issued before Redis is ready).
const viewSocketRevoker = createViewSocketRevoker({ io, redis: pubSubRedisSource(), logger: fastify.log });
fastify.decorate('revokeSupportViewSockets', (userId) => viewSocketRevoker.revoke(userId));
const stopViewSocketSweep = startViewSocketSweep(io, prisma, fastify.log);
// Client-portal sockets whose access was revoked (#286): dropped at once by
// the revoking write paths, and within one sweep otherwise
// (src/auth/client-socket-revocation.js).
fastify.decorate('revokeClientSockets', (target) => disconnectClientSockets(io, target));
const stopClientSocketSweep = startClientSocketSweep(io, prisma, fastify.log);
fastify.addHook('onClose', async () => {
  stopViewSocketSweep();
  stopClientSocketSweep();
  await viewSocketRevoker.close();
  await new Promise((resolve) => io.close(resolve));
  // After io.close(): closing the server closes the adapter's subscriptions.
  await realtimeAdapter.close();
  await closeRealtimeEmitter();
});
// Handshake: sessions only (src/auth/socket-auth.js). Realtime is paused
// during a support view (#416): a handshake carrying the view cookie is
// refused before verification, and an admin with an open view is refused
// after the session is verified.
io.use(createSocketAuthMiddleware({
  verifyToken: (token) => fastify.jwt.verify(token),
  parseCookie: (header) => fastify.parseCookie(header),
  prisma,
  refuseBeforeVerify: (cookies) => (socketHandshakeDuringView(cookies) ? 'Realtime is paused during a support view' : null),
  refuseAfterVerify: async (decoded) => ((await actorHasOpenView(prisma, decoded)) ? 'Realtime is paused during a support view' : null),
}));

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
  // Client-portal sockets only: the rooms revocation disconnects.
  for (const room of clientSocketRooms(socket)) socket.join(room);
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
  // A client-portal socket is re-authorized on every join: a client paused
  // or archived (or a contact removed) since the handshake is refused and
  // disconnected (src/auth/socket-auth.js).
  socket.on('join-project', withClientReauthorization(prisma, socket, createJoinProjectHandler(socket, {
    findProject: (projectId) => prisma.project.findUnique({
      where: { id: projectId },
      select: { clientId: true, client: { select: { organizationId: true } } },
    }),
    logger,
  })));

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
