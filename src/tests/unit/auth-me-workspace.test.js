import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import authRoutes from '../../routes/auth.routes.js';

test('session refresh returns the canonical organization for user-scoped send recovery without credentials', async t => {
  const app = Fastify();
  const stored = { id: 'staff', organizationId: 'canonical-org', email: 'staff@example.test', name: 'Staff', role: 'TEAM', skills: '[]', capacity: 100 };
  let profileSelect;
  app.decorate('authenticate', async request => {
    request.user = { id: stored.id, role: stored.role, organizationId: stored.organizationId };
    request.prisma = { user: { findUnique: async ({ where, select }) => {
      assert.equal(where.id, stored.id);
      if (select.email) profileSelect = select;
      return Object.fromEntries(Object.entries(stored).filter(([key]) => select[key]));
    } } };
  });
  await app.register(authRoutes);
  t.after(() => app.close());
  const response = await app.inject('/me');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(profileSelect.organizationId, true);
  assert.equal(response.json().organizationId, stored.organizationId);
  assert.doesNotMatch(response.body, /password|resetToken|mfaSecret|sessionVersion/);
});
