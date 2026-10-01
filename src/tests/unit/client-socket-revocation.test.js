// Client-portal socket revocation (#286, src/auth/client-socket-revocation.js)
// over a real in-process Socket.IO server: a client socket that already
// joined its project room is dropped when its client, contact, user or
// session is revoked, by the write-path disconnect or by the sweep, while
// staff sockets in the same room keep receiving events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';

import {
  clientSocketRooms,
  clientStateRevokesPortal,
  disconnectClientSockets,
  revokeClientSocketsFrom,
  sweepClientSockets,
} from '../../auth/client-socket-revocation.js';

const PROJECT_ROOM = 'project:p1';

/** A server whose middleware stands in for createSocketAuthMiddleware and whose connection handler joins the same rooms as src/index.js. */
async function startServer(t) {
  const server = http.createServer();
  const io = new Server(server);
  io.use((socket, next) => {
    const { userId, role, clientId } = socket.handshake.auth;
    socket.userId = userId;
    socket.userRole = role;
    socket.clientId = clientId;
    if (role === 'CLIENT') socket.portalClaims = { id: userId, role, clientId, contactId: `contact-${userId}`, sessionVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 };
    next();
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    for (const room of clientSocketRooms(socket)) socket.join(room);
    socket.join(PROJECT_ROOM);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  t.after(() => new Promise((resolve) => io.close(() => resolve(undefined))));
  return { io, url };
}

async function connect(t, url, auth) {
  const client = connectClient(url, { transports: ['websocket'], auth, reconnection: false });
  t.after(() => client.close());
  await once(client, 'connect');
  // The connection handler has run once the server sees the socket in its room.
  return client;
}

async function roomReady(io, count) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await io.in(PROJECT_ROOM).fetchSockets()).length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('sockets did not join the project room');
}

/** Resolves true when `client` receives `event` within `ms`, false otherwise. */
function receives(client, event, ms = 300) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { client.off(event, onEvent); resolve(false); }, ms);
    function onEvent() { clearTimeout(timer); resolve(true); }
    client.once(event, onEvent);
  });
}

test('only client-portal sockets join the revocation rooms', () => {
  assert.deepEqual(clientSocketRooms({ userRole: 'CLIENT', userId: 'u1', clientId: 'c1' }), ['client:c1', 'client-user:u1']);
  assert.deepEqual(clientSocketRooms({ userRole: 'ADMIN', userId: 'u2', clientId: 'c1' }), []);
  assert.deepEqual(clientSocketRooms({ userRole: 'TEAM', userId: 'u3' }), []);
  assert.deepEqual(clientSocketRooms(null), []);
});

test('the revoking client states match resolvePortalPrincipal', () => {
  assert.equal(clientStateRevokesPortal({ status: 'ACTIVE', relationshipStatus: 'ACTIVE', deletedAt: null }), false);
  assert.equal(clientStateRevokesPortal({ status: 'PAUSED', relationshipStatus: 'ACTIVE' }), true);
  assert.equal(clientStateRevokesPortal({ status: 'ACTIVE', relationshipStatus: 'ARCHIVED' }), true);
  assert.equal(clientStateRevokesPortal({ status: 'ACTIVE', relationshipStatus: 'CHURNED' }), true);
  assert.equal(clientStateRevokesPortal({ status: 'ACTIVE', deletedAt: new Date() }), true);
  assert.equal(clientStateRevokesPortal(null), true);
});

test('revoking a client drops its joined sockets; staff in the same room keep receiving events', async (t) => {
  const { io, url } = await startServer(t);
  const client = await connect(t, url, { userId: 'client-user', role: 'CLIENT', clientId: 'c1' });
  const otherClient = await connect(t, url, { userId: 'other-client-user', role: 'CLIENT', clientId: 'c2' });
  const staff = await connect(t, url, { userId: 'staff-user', role: 'ADMIN', clientId: 'c1' });
  await roomReady(io, 3);

  const clientGot = receives(client, 'task:updated');
  io.to(PROJECT_ROOM).emit('task:updated', { id: 't1' });
  assert.equal(await clientGot, true, 'the joined client socket receives project events before revocation');

  const dropped = once(client, 'disconnect');
  disconnectClientSockets(io, { clientId: 'c1' });
  await dropped;

  const staffGot = receives(staff, 'task:updated');
  const otherGot = receives(otherClient, 'task:updated');
  const revokedGot = receives(client, 'task:updated');
  io.to(PROJECT_ROOM).emit('task:updated', { id: 't2' });
  assert.equal(await staffGot, true, 'staff are unaffected');
  assert.equal(await otherGot, true, 'another client is unaffected');
  assert.equal(await revokedGot, false, 'the revoked socket receives nothing');
  assert.equal(client.connected, false);
  assert.equal(staff.connected, true);
});

test('revoking a portal user (deactivation, sign-out, password change) drops only that user\'s sockets', async (t) => {
  const { io, url } = await startServer(t);
  const first = await connect(t, url, { userId: 'u1', role: 'CLIENT', clientId: 'c1' });
  const colleague = await connect(t, url, { userId: 'u2', role: 'CLIENT', clientId: 'c1' });
  const staff = await connect(t, url, { userId: 'u1-staff', role: 'TEAM' });
  await roomReady(io, 3);

  const dropped = once(first, 'disconnect');
  // Through the route helper and the app decorator, as the routes call it.
  revokeClientSocketsFrom({ revokeClientSockets: (target) => disconnectClientSockets(io, target) }, { userId: 'u1' });
  await dropped;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(first.connected, false);
  assert.equal(colleague.connected, true);
  assert.equal(staff.connected, true);

  // A staff user id never matches a client-user room.
  revokeClientSocketsFrom({ io }, { userId: 'u1-staff' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(staff.connected, true);
});

test('the sweep drops client sockets whose principal no longer resolves, and never staff sockets', async (t) => {
  const { io, url } = await startServer(t);
  const revoked = await connect(t, url, { userId: 'revoked', role: 'CLIENT', clientId: 'c1' });
  const current = await connect(t, url, { userId: 'current', role: 'CLIENT', clientId: 'c2' });
  const staff = await connect(t, url, { userId: 'staff', role: 'ADMIN' });
  await roomReady(io, 3);

  const resolved = [];
  const resolver = async (_prisma, claims) => {
    resolved.push(claims.id);
    return claims.id === 'revoked' ? null : { user: { id: claims.id } };
  };
  const dropped = once(revoked, 'disconnect');
  assert.equal(await sweepClientSockets(io.of('/').sockets.values(), {}, resolver), 1);
  await dropped;
  assert.deepEqual(resolved.sort(), ['current', 'revoked'], 'staff sockets are never resolved');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(current.connected, true);
  assert.equal(staff.connected, true);
});

test('the sweep drops a client socket whose token expired, and keeps sockets when the database is unreachable', async (t) => {
  const { io, url } = await startServer(t);
  const expired = await connect(t, url, { userId: 'expired', role: 'CLIENT', clientId: 'c1' });
  const other = await connect(t, url, { userId: 'other', role: 'CLIENT', clientId: 'c1' });
  await roomReady(io, 2);
  for (const socket of io.of('/').sockets.values()) {
    if (socket.userId === 'expired') socket.portalClaims.exp = Math.floor(Date.now() / 1000) - 1;
  }
  const failing = async () => { throw new Error('database unavailable'); };
  const dropped = once(expired, 'disconnect');
  assert.equal(await sweepClientSockets(io.of('/').sockets.values(), {}, failing), 1);
  await dropped;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(other.connected, true, 'a failed lookup is retried on the next sweep, not treated as revocation');
});

test('a failing revocation never fails the request', () => {
  const warnings = [];
  revokeClientSocketsFrom({ revokeClientSockets: () => { throw new Error('adapter down'); } }, { clientId: 'c1' }, { warn: (...args) => warnings.push(args) });
  assert.equal(warnings.length, 1);
  // No io at all (routes registered alone): a no-op.
  revokeClientSocketsFrom({}, { clientId: 'c1' });
});

test('the API wires the rooms, the decorator and the sweep, and the revoking routes call it', () => {
  const server = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(server, /for \(const room of clientSocketRooms\(socket\)\) socket\.join\(room\)/);
  assert.match(server, /fastify\.decorate\('revokeClientSockets'/);
  assert.match(server, /startClientSocketSweep\(io, prisma, fastify\.log\)/);
  const routes = {
    'client.routes.js': /revokeClientSocketsFrom\(fastify, \{ clientId: client\.id \}/,
    'team.routes.js': /revokeClientSocketsFrom\(fastify, \{ userId: member\.id \}/,
    'client-portal.routes.js': /revokeClientSocketsFrom\(fastify, \{ userId: request\.clientUser\.id \}/,
    'auth.routes.js': /revokeClientSocketsFrom\(fastify, \{ userId: request\.user\.id \}/,
  };
  for (const [file, pattern] of Object.entries(routes)) {
    assert.match(readFileSync(new URL(`../../routes/${file}`, import.meta.url), 'utf8'), pattern, file);
  }
});
