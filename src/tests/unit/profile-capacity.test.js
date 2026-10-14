import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authRoutes from '../../routes/auth.routes.js';

test('profile capacity preserves zero and percentage values and rejects invalid input', async t => {
  let stored = { id: 'staff', capacity: 100 };
  let writes = 0;
  const app = Fastify();
  app.decorate('authenticate', async request => {
    request.user = { id: 'staff', role: 'TEAM', organizationId: 'org' };
    request.prisma = { user: { update: async ({ where, data }) => {
      assert.deepEqual(where, { id: 'staff' });
      writes++;
      stored = { ...stored, ...data };
      return stored;
    } } };
  });
  await app.register(authRoutes);
  t.after(() => app.close());
  for (const capacity of [0, 50, 100, 200]) {
    const response = await app.inject({ method: 'PUT', url: '/me', payload: { capacity } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().capacity, capacity);
  }
  for (const capacity of [-1, 201, 0.5, '50']) {
    const response = await app.inject({ method: 'PUT', url: '/me', payload: { capacity } });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(writes, 4);
  const response = await app.inject({ method: 'PUT', url: '/me', payload: { name: 'Staff' } });
  assert.equal(response.json().capacity, 200);
});
