import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerCallSignalling, resolveIceServers } from '../../services/call-signalling.service.js';

function fakeSocket(userId, rooms) {
  const handlers = {};
  const received = [];
  const socket = {
    userId,
    rooms: new Set(rooms),
    received,
    on(event, handler) { handlers[event] = handler; },
    emit(event, payload) { received.push({ event, payload }); },
    to(room) {
      return { emit: (event, payload) => socket.broadcasts.push({ room, event, payload }) };
    },
    broadcasts: [],
    trigger: (event, payload) => handlers[event](payload),
  };
  return socket;
}

function fakeIo(sockets) {
  return {
    in(room) {
      return { fetchSockets: async () => sockets.filter((s) => room === `user:${s.userId}`) };
    },
  };
}

const OFFER = { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } };

test('a call signal reaches only the addressed participant in the same project', async () => {
  const caller = fakeSocket('alice', ['project:p1']);
  const callee = fakeSocket('bob', ['project:p1']);
  const bystander = fakeSocket('carol', ['project:p1']);
  const calleeElsewhere = fakeSocket('bob', ['project:p2']);
  const io = fakeIo([caller, callee, bystander, calleeElsewhere]);
  registerCallSignalling(io, caller);

  await caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'bob', signal: OFFER });

  assert.deepEqual(callee.received, [{
    event: 'call:signal',
    payload: { projectId: 'p1', callId: 'c1', from: 'alice', signal: OFFER },
  }]);
  assert.equal(bystander.received.length, 0, 'other project members must not see the SDP');
  assert.equal(calleeElsewhere.received.length, 0, 'the callee socket outside the project must not receive it');
  assert.equal(caller.broadcasts.length, 0, 'signals are never broadcast to the room');
});

test('signals are dropped outside an authorized room, without a target, or when malformed', async () => {
  const caller = fakeSocket('alice', ['project:p1']);
  const outsider = fakeSocket('mallory', []);
  const callee = fakeSocket('bob', ['project:p1']);
  const io = fakeIo([caller, outsider, callee]);
  registerCallSignalling(io, caller);
  registerCallSignalling(io, outsider);

  await outsider.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'bob', signal: OFFER });
  await caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', signal: OFFER });
  await caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'alice', signal: OFFER });
  await caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'bob', signal: { type: 'exec' } });
  await caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'bob', signal: { type: 'ice', candidate: 'x'.repeat(20_000) } });
  await caller.trigger('call:signal', undefined);

  assert.equal(callee.received.length, 0);
});

test('presence is announced to the authorized project room with the sender id', () => {
  const caller = fakeSocket('alice', ['project:p1']);
  const outsider = fakeSocket('mallory', []);
  registerCallSignalling(fakeIo([]), caller);
  registerCallSignalling(fakeIo([]), outsider);

  caller.trigger('call:presence', { projectId: 'p1', callId: 'c1', state: 'joined' });
  outsider.trigger('call:presence', { projectId: 'p1', callId: 'c2', state: 'joined' });
  caller.trigger('call:presence', { projectId: 'p1', callId: 'c1', state: 'ringing' });

  assert.deepEqual(caller.broadcasts, [{
    room: 'project:p1',
    event: 'call:presence',
    payload: { projectId: 'p1', callId: 'c1', userId: 'alice', state: 'joined' },
  }]);
  assert.equal(outsider.broadcasts.length, 0);
});

test('ICE servers default to public STUN and accept a validated TURN configuration', () => {
  const stunOnly = [{ urls: 'stun:stun.l.google.com:19302' }];
  assert.deepEqual(resolveIceServers(undefined), stunOnly);
  assert.deepEqual(resolveIceServers('not json'), stunOnly);
  assert.deepEqual(resolveIceServers('[{"urls":"http://evil.test"}]'), stunOnly);
  assert.deepEqual(resolveIceServers('[]'), stunOnly);

  const turn = [
    { urls: 'stun:stun.example.com:3478' },
    { urls: ['turns:turn.example.com:5349'], username: 'u', credential: 'c', extra: 'dropped' },
  ];
  assert.deepEqual(resolveIceServers(JSON.stringify(turn)), [
    { urls: 'stun:stun.example.com:3478' },
    { urls: ['turns:turn.example.com:5349'], username: 'u', credential: 'c' },
  ]);
});

test('ICE servers are only served to signed-in users and are not cached', async (t) => {
  process.env.WEBRTC_ICE_SERVERS = '[{"urls":"turn:turn.example.com:3478","username":"u","credential":"c"}]';
  const { default: env } = await import('../../config/env.js');
  const previous = env.webrtcIceServers;
  env.webrtcIceServers = process.env.WEBRTC_ICE_SERVERS;
  t.after(() => { env.webrtcIceServers = previous; });
  const { default: realtimeRoutes } = await import('../../routes/realtime.routes.js');

  const app = Fastify();
  app.decorate('authenticate', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer ok') return reply.status(401).send({ error: 'Unauthorized' });
  });
  await app.register(realtimeRoutes);
  t.after(() => app.close());

  const anonymous = await app.inject({ method: 'GET', url: '/ice-servers' });
  assert.equal(anonymous.statusCode, 401);

  const signedIn = await app.inject({ method: 'GET', url: '/ice-servers', headers: { authorization: 'Bearer ok' } });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.headers['cache-control'], 'no-store');
  assert.deepEqual(signedIn.json().iceServers, [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }]);
});

test('a failing socket lookup drops the signal instead of rejecting', async () => {
  const caller = fakeSocket('alice', ['project:p1']);
  registerCallSignalling({ in: () => ({ fetchSockets: async () => { throw new Error('adapter timeout'); } }) }, caller);
  await assert.doesNotReject(caller.trigger('call:signal', { projectId: 'p1', callId: 'c1', to: 'bob', signal: OFFER }));
});
