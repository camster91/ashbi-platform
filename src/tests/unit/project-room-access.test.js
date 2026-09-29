import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canJoinProjectRoom,
  createJoinProjectHandler,
  createLeaveProjectHandler,
  toClientProjectPayload,
  toClientTaskPayload,
  toClientChatPayload,
} from '../../auth/project-room-access.js';
import bus, { EVENTS } from '../../utils/events.js';
import { initSocketBridge } from '../../subscribers/socket.subscriber.js';

const projectOfA = { clientId: 'client-a', client: { organizationId: 'org-1' } };
const projectOfB = { clientId: 'client-b', client: { organizationId: 'org-1' } };
const projectElsewhere = { clientId: 'client-x', client: { organizationId: 'org-2' } };

test('a client-portal socket joins only its own client\'s project rooms', () => {
  const clientA = { userRole: 'CLIENT', clientId: 'client-a', organizationId: 'org-1' };
  assert.equal(canJoinProjectRoom(clientA, projectOfA), true);
  // Same agency organization must not authorize another client's project.
  assert.equal(canJoinProjectRoom(clientA, projectOfB), false);
  assert.equal(canJoinProjectRoom(clientA, projectElsewhere), false);
});

test('a client socket without a client id joins nothing', () => {
  const orphan = { userRole: 'CLIENT', organizationId: 'org-1' };
  assert.equal(canJoinProjectRoom(orphan, projectOfA), false);
  assert.equal(canJoinProjectRoom(orphan, { clientId: undefined, client: { organizationId: 'org-1' } }), false);
});

test('staff sockets join any project in their own organization only', () => {
  for (const userRole of ['ADMIN', 'TEAM']) {
    const staff = { userRole, organizationId: 'org-1' };
    assert.equal(canJoinProjectRoom(staff, projectOfA), true, userRole);
    assert.equal(canJoinProjectRoom(staff, projectOfB), true, userRole);
    assert.equal(canJoinProjectRoom(staff, projectElsewhere), false, userRole);
    assert.equal(canJoinProjectRoom({ userRole }, projectOfA), false, `${userRole} without org`);
  }
});

test('missing principal or project is refused', () => {
  assert.equal(canJoinProjectRoom(null, projectOfA), false);
  assert.equal(canJoinProjectRoom({ userRole: 'ADMIN', organizationId: 'org-1' }, null), false);
});

test('the Socket.IO join-project handler uses the shared authorizer', () => {
  const server = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const handler = server.slice(server.indexOf("socket.on('join-project'"), server.indexOf("socket.on('leave-project'"));
  assert.match(handler, /createJoinProjectHandler\(socket, \{/);
  assert.doesNotMatch(handler, /sameOrg/);
});

function roomSocket(principal) {
  return {
    ...principal,
    rooms: new Set(),
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
  };
}

test('join-project joins an authorized room and acknowledges it', async () => {
  const socket = roomSocket({ userRole: 'TEAM', organizationId: 'org-1' });
  const handler = createJoinProjectHandler(socket, { findProject: async () => projectOfA });
  const acks = [];
  await handler('p1', (result) => acks.push(result));
  assert.deepEqual(acks, [{ joined: true, room: 'internal' }]);
  assert.deepEqual([...socket.rooms], ['project:p1']);
});

test('a client-portal socket is refused the internal room and joins only the client room (C3)', async () => {
  const client = roomSocket({ userRole: 'CLIENT', clientId: 'client-a', organizationId: 'org-1' });
  const acks = [];
  await createJoinProjectHandler(client, { findProject: async () => projectOfA })('p1', (result) => acks.push(result));
  assert.deepEqual(acks, [{ joined: true, room: 'client' }]);
  assert.equal(client.rooms.has('project:p1'), false, 'never the internal room');
  assert.deepEqual([...client.rooms], ['project:p1:client']);

  createLeaveProjectHandler(client)('p1');
  assert.equal(client.rooms.size, 0);
});

function recordingIo() {
  const emitted = [];
  return { emitted, to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
}

test('project and task broadcasts to the client room carry only whitelisted fields (C3)', () => {
  const io = recordingIo();
  const before = {
    project: bus.listenerCount(EVENTS.PROJECT_UPDATED),
    created: bus.listenerCount(EVENTS.TASK_CREATED),
    updated: bus.listenerCount(EVENTS.TASK_UPDATED),
  };
  const listeners = [EVENTS.PROJECT_UPDATED, EVENTS.TASK_CREATED, EVENTS.TASK_UPDATED, EVENTS.TASK_BLOCKED]
    .map((event) => [event, bus.listeners(event)]);
  initSocketBridge(io);
  try {
    const project = {
      id: 'p1', name: 'Website', status: 'DESIGN_DEV', startDate: null, endDate: null, updatedAt: 'now',
      budget: 12000, aiSummary: 'Client is difficult', risks: '[]', draftData: '{}', viewToken: 'secret-token',
      hourlyBudget: 100, clientId: 'client-a',
    };
    bus.emit(EVENTS.PROJECT_UPDATED, { project });
    bus.emit(EVENTS.TASK_CREATED, { task: { id: 't1', projectId: 'p1', title: 'Wireframe', status: 'PENDING', description: 'internal notes', assigneeId: 'u1', aiContext: 'x' } });
    bus.emit(EVENTS.TASK_UPDATED, { task: { id: 't2', projectId: 'p1', parentId: 't1', title: 'Subtask', status: 'PENDING' } });

    const internal = io.emitted.filter((entry) => entry.room === 'project:p1');
    const client = io.emitted.filter((entry) => entry.room === 'project:p1:client');
    assert.deepEqual(internal.map((entry) => entry.event), ['project_updated', 'task_created', 'task_updated']);
    assert.equal(internal[0].payload.budget, 12000, 'staff keep the full row');

    assert.deepEqual(client.map((entry) => entry.event), ['project_updated', 'task_created'], 'subtasks are not broadcast to clients');
    assert.deepEqual(Object.keys(client[0].payload).sort(), ['endDate', 'id', 'name', 'startDate', 'status', 'updatedAt']);
    assert.deepEqual(Object.keys(client[1].payload).sort(), ['id', 'projectId', 'status', 'title']);
  } finally {
    for (const [event, original] of listeners) {
      bus.removeAllListeners(event);
      for (const listener of original) bus.on(event, listener);
    }
    assert.equal(bus.listenerCount(EVENTS.PROJECT_UPDATED), before.project);
    assert.equal(bus.listenerCount(EVENTS.TASK_CREATED), before.created);
    assert.equal(bus.listenerCount(EVENTS.TASK_UPDATED), before.updated);
  }
});

test('client payload helpers drop internal fields and internal messages', () => {
  assert.deepEqual(toClientProjectPayload({ id: 'p', name: 'n', budget: 1, viewToken: 't' }), { id: 'p', name: 'n' });
  assert.equal(toClientTaskPayload({ id: 't', parentId: 'x' }), null);
  assert.equal(toClientChatPayload({ id: 'm', visibility: 'INTERNAL', content: 'secret' }), null);
  assert.equal(toClientChatPayload({ id: 'm', visibility: 'CLIENT', content: 'gone', removedAt: new Date() }), null);
  assert.deepEqual(
    toClientChatPayload({ id: 'm', projectId: 'p', visibility: 'CLIENT', content: 'hi', metadata: '{"mentions":[]}', externalSource: 'SLACK', author: { id: 'u', name: 'Avery', email: 'a@x' } }),
    { id: 'm', projectId: 'p', content: 'hi', visibility: 'CLIENT', author: { id: 'u', name: 'Avery' } },
  );
});

test('join-project refuses unauthorized, invalid and failing lookups with a negative ack', async () => {
  const client = roomSocket({ userRole: 'CLIENT', clientId: 'client-a', organizationId: 'org-1' });
  const acks = [];
  await createJoinProjectHandler(client, { findProject: async () => projectOfB })('p2', (r) => acks.push(r));
  await createJoinProjectHandler(client, { findProject: async () => projectOfA })(42, (r) => acks.push(r));
  const errors = [];
  await createJoinProjectHandler(client, {
    findProject: async () => { throw new Error('db down'); },
    logger: { error: (...args) => errors.push(args) },
  })('p3', (r) => acks.push(r));
  assert.deepEqual(acks, [{ joined: false }, { joined: false }, { joined: false }]);
  assert.equal(client.rooms.size, 0);
  assert.equal(errors.length, 1);
});

test('join-project without an acknowledgement callback still joins', async () => {
  const socket = roomSocket({ userRole: 'ADMIN', organizationId: 'org-1' });
  await createJoinProjectHandler(socket, { findProject: async () => projectOfA })('p1');
  assert.ok(socket.rooms.has('project:p1'));
  assert.equal(socket.rooms.has('project:p1:client'), false);
});
