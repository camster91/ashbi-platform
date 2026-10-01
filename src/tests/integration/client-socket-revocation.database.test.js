// Already-joined client-portal sockets are dropped when access is revoked
// (#286, src/auth/client-socket-revocation.js), against a real PostgreSQL
// schema, the real Socket.IO handshake middleware and the real routes:
//
// - pausing the client (PUT /api/clients/:id) and signing out of the portal
//   (POST /api/client-portal/logout) disconnect the joined socket at once;
// - removing the contact (a write path with no `io`) is caught by the sweep
//   with the real resolvePortalPrincipal;
// - staff sockets in the same project room keep receiving events;
// - a revoked CLIENT session is not a current session for the routes outside
//   the portal either (GET/PUT /api/auth/me, change-password), while staff
//   sessions are unaffected (resolveRequestSession).
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { default: clientRoutes } = await import('../../routes/client.routes.js');
const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');
const { signUserSession } = await import('../../auth/session.js');
const { createSocketAuthMiddleware } = await import('../../auth/socket-auth.js');
const { clientSocketRooms, disconnectClientSockets, sweepClientSockets } = await import('../../auth/client-socket-revocation.js');
const { resolveRequestSession } = await import('../../auth/request-session.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const fixturePassword = () => ['fixture', randomUUID()].join(':');

function receives(client, event, ms = 300) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { client.off(event, onEvent); resolve(false); }, ms);
    function onEvent() { clearTimeout(timer); resolve(true); }
    client.once(event, onEvent);
  });
}

test('revoking portal access drops already-joined client sockets and ends the session everywhere', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const org = `socket-revoke-org-${suffix}`;
  const clients = [];
  let app;
  let io;
  let server;

  try {
    await raw.organization.create({ data: { id: org, name: 'Socket revocation', slug: `socket-revoke-${suffix}` } });
    const staff = await raw.user.create({ data: { organizationId: org, email: `socket-staff-${suffix}@example.com`, name: 'Staff', password: fixturePassword(), role: 'ADMIN' } });
    const client = await raw.client.create({ data: { organizationId: org, name: 'Socket client' } });
    const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: 'Socket site' } });
    const email = `socket-contact-${suffix}@example.com`;
    let contact = await raw.contact.create({ data: { clientId: client.id, name: 'Contact', email } });
    const portalUser = await raw.user.create({ data: { organizationId: org, clientId: client.id, email, name: 'Contact', password: fixturePassword(), role: 'CLIENT' } });

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(multipart);
    await app.register(rateLimit, { global: false });
    await app.register(jwt, { secret: `socket-revoke-${randomUUID()}`, cookie: { cookieName: 'token', signed: false } });
    app.decorate('notify', async () => {});
    app.addHook('onRequest', async (request) => { request.prisma = raw; });
    app.decorate('authenticate', async (request) => {
      request.user = { id: staff.id, role: 'ADMIN', organizationId: org };
    });

    server = http.createServer();
    io = new Server(server);
    app.decorate('io', io);
    app.decorate('revokeClientSockets', (target) => disconnectClientSockets(io, target));
    await app.register(clientRoutes, { prefix: '/api/clients' });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();

    // The production handshake middleware and the rooms src/index.js joins.
    io.use(createSocketAuthMiddleware({ verifyToken: (token) => app.jwt.verify(token), parseCookie: () => ({}), prisma: raw }));
    io.on('connection', (socket) => {
      for (const room of clientSocketRooms(socket)) socket.join(room);
      socket.join(`project:${project.id}`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;

    const portalToken = async () => signUserSession(app.jwt, await raw.user.findUnique({ where: { id: portalUser.id } }), { contactId: contact.id });
    const staffToken = signUserSession(app.jwt, staff);
    const connect = async (token) => {
      const socket = connectClient(url, { transports: ['websocket'], auth: { token }, reconnection: false });
      clients.push(socket);
      const [outcome] = await Promise.race([once(socket, 'connect').then(() => ['connected']), once(socket, 'connect_error').then(([err]) => [err])]);
      if (outcome !== 'connected') throw outcome;
      for (let attempt = 0; attempt < 50 && !(await io.in(`project:${project.id}`).fetchSockets()).some((s) => s.id === socket.id); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return socket;
    };
    const room = () => io.to(`project:${project.id}`);
    const staffSocket = await connect(staffToken);

    // ── Pausing the client drops its joined socket at once ─────────────────
    let clientSocket = await connect(await portalToken());
    const before = receives(clientSocket, 'chat:message');
    room().emit('chat:message', { id: 'm1' });
    assert.equal(await before, true, 'the joined client socket receives project events');
    let dropped = once(clientSocket, 'disconnect');
    const paused = await app.inject({ method: 'PUT', url: `/api/clients/${client.id}`, payload: { status: 'INACTIVE' } });
    assert.equal(paused.statusCode, 200, paused.body);
    await dropped;
    const staffHears = receives(staffSocket, 'chat:message');
    const revokedHears = receives(clientSocket, 'chat:message');
    room().emit('chat:message', { id: 'm2' });
    assert.equal(await staffHears, true, 'staff sockets are unaffected');
    assert.equal(await revokedHears, false);
    await assert.rejects(connect(await portalToken()), /revoked/, 'and a new handshake is refused');

    // A save that leaves the client active disconnects nothing.
    await raw.client.update({ where: { id: client.id }, data: { status: 'ACTIVE' } });
    clientSocket = await connect(await portalToken());
    assert.equal((await app.inject({ method: 'PUT', url: `/api/clients/${client.id}`, payload: { name: 'Renamed', status: 'ACTIVE' } })).statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(clientSocket.connected, true);

    // ── Removing the contact (no io on that path): the sweep drops it ───────
    await raw.contact.delete({ where: { id: contact.id } });
    dropped = once(clientSocket, 'disconnect');
    assert.equal(await sweepClientSockets(io.of('/').sockets.values(), raw), 1);
    await dropped;
    assert.equal(staffSocket.connected, true, 'the sweep never drops staff');

    // ── Signing out of the portal drops the user's sockets ──────────────────
    contact = await raw.contact.create({ data: { clientId: client.id, name: 'Contact', email } });
    const token = await portalToken();
    clientSocket = await connect(token);
    dropped = once(clientSocket, 'disconnect');
    const logout = await app.inject({ method: 'POST', url: '/api/client-portal/logout', headers: { authorization: `Bearer ${token}` } });
    assert.equal(logout.statusCode, 200, logout.body);
    await dropped;
    assert.equal(staffSocket.connected, true);

    // ── /api/auth routes: a revoked CLIENT session is not current ───────────
    const sessionOf = async (bearer) => {
      const request = {
        headers: { authorization: `Bearer ${bearer}` },
        cookies: {},
        user: null,
        async jwtVerify() { this.user = app.jwt.verify(bearer); },
      };
      return resolveRequestSession(request, raw);
    };
    const current = await portalToken();
    const passwordLogin = signUserSession(app.jwt, await raw.user.findUnique({ where: { id: portalUser.id } }));
    assert.equal(await sessionOf(current), 'current');
    assert.equal(await sessionOf(passwordLogin), 'current');
    assert.equal(await sessionOf(staffToken), 'current');
    await raw.client.update({ where: { id: client.id }, data: { relationshipStatus: 'ARCHIVED' } });
    assert.equal(await sessionOf(current), 'stale', 'archived client: the portal session is refused by /api/auth/me');
    assert.equal(await sessionOf(passwordLogin), 'stale', 'and so is a password-login client session');
    assert.equal(await sessionOf(staffToken), 'current', 'staff sessions are unaffected');
    await raw.client.update({ where: { id: client.id }, data: { relationshipStatus: 'ACTIVE' } });
    assert.equal(await sessionOf(current), 'current');
    await raw.contact.delete({ where: { id: contact.id } });
    assert.equal(await sessionOf(current), 'stale', 'contact removed');
  } finally {
    for (const socket of clients) socket.close();
    if (io) await new Promise((resolve) => io.close(() => resolve(undefined)));
    await app?.close();
    await raw.activity.deleteMany({ where: { project: { organizationId: org } } });
    await raw.project.deleteMany({ where: { organizationId: org } });
    await raw.contact.deleteMany({ where: { client: { organizationId: org } } });
    await raw.user.deleteMany({ where: { organizationId: org } });
    await raw.client.deleteMany({ where: { organizationId: org } });
    if (await purgeFixtureAuditEvents(raw, { ids: [org] })) {
      await raw.organization.deleteMany({ where: { id: org } });
    }
    await raw.$disconnect();
  }
});
