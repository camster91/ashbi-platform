import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import teamRoutes from '../../routes/team.routes.js';

const MEMBERS = [
  { id: 'u1', email: 'a@x.test', name: 'A', role: 'ADMIN', skills: '[]', capacity: 100, isActive: true, mfaEnabled: true, mfaLockedUntil: null, _count: { assignedThreads: 0, assignedTasks: 0 } },
  { id: 'u2', email: 'b@x.test', name: 'B', role: 'STAFF', skills: '[]', capacity: 100, isActive: true, mfaEnabled: false, mfaLockedUntil: new Date(Date.now() + 60_000), _count: { assignedThreads: 1, assignedTasks: 2 } },
];

async function listAs(t, role) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role }; });
  app.decorate('adminOnly', async () => {});
  app.addHook('onRequest', async (request) => {
    request.prisma = { user: { findMany: async () => structuredClone(MEMBERS) } };
  });
  await app.register(teamRoutes);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 200);
  return response.json();
}

test("admins see each member's two-factor state", async (t) => {
  const team = await listAs(t, 'ADMIN');
  assert.deepEqual(team.map((m) => [m.mfaEnabled, m.mfaLocked]), [[true, false], [false, true]]);
  assert.ok(team.every((m) => !('mfaLockedUntil' in m)));
});

test('non-admins do not see two-factor state', async (t) => {
  for (const role of ['STAFF', 'TEAM']) {
    const team = await listAs(t, role);
    assert.ok(team.every((m) => !('mfaEnabled' in m) && !('mfaLocked' in m) && !('mfaLockedUntil' in m)), role);
  }
});
