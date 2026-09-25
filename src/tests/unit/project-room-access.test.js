import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canJoinProjectRoom } from '../../auth/project-room-access.js';

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
  assert.match(handler, /canJoinProjectRoom\(socket, project\)/);
  assert.doesNotMatch(handler, /sameOrg/);
});
