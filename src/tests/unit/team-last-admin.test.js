// PUT /api/team/:id keeps at least one active ADMIN in the organization:
// demoting or deactivating the last one is refused with 409 LAST_ADMIN.
import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';

const { withSession, reauthCookies } = await import('../helpers/reauth.js');
const { default: teamRoutes } = await import('../../routes/team.routes.js');

const ACTOR = { id: 'admin-1', email: 'founder@agency.test', name: 'Founder', role: 'ADMIN', organizationId: 'org-a', sessionVersion: 0, isActive: true };

function fakeDb(users) {
  const rows = users.map((user) => ({ skills: '[]', capacity: 100, sessionVersion: 0, ...user }));
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    return row[key] === value;
  });
  return {
    rows,
    user: {
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
      count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        for (const [key, value] of Object.entries(data)) {
          if (key === 'sessionVersion') row.sessionVersion += 1;
          else row[key] = value;
        }
        return { ...row };
      },
    },
    auditEvent: { create: async ({ data }) => data },
    impersonationSession: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
  };
}

async function teamApp(t, db) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorate('adminOnly', async (request) => { request.user = withSession(ACTOR); });
  app.decorate('authenticate', async (request) => { request.user = withSession(ACTOR); });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(teamRoutes);
  t.after(() => app.close());
  return (url, payload) => app.inject({ method: 'PUT', url, payload, cookies: reauthCookies(ACTOR) });
}

test('the last active admin cannot be demoted or deactivated', async (t) => {
  const db = fakeDb([ACTOR, { id: 'team-1', role: 'TEAM', isActive: true, organizationId: 'org-a', name: 'Teammate', email: 't@agency.test' }]);
  const put = await teamApp(t, db);

  for (const payload of [{ role: 'TEAM' }, { isActive: false }]) {
    const response = await put('/admin-1', payload);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'LAST_ADMIN');
  }
  assert.deepEqual([db.rows[0].role, db.rows[0].isActive], ['ADMIN', true]);

  // A profile edit of the last admin is still fine.
  assert.equal((await put('/admin-1', { name: 'Founder Renamed' })).statusCode, 200);
});

test('an admin can be demoted while another active admin remains', async (t) => {
  const db = fakeDb([
    ACTOR,
    { id: 'admin-2', role: 'ADMIN', isActive: true, organizationId: 'org-a', name: 'Second', email: 's@agency.test' },
    { id: 'admin-3', role: 'ADMIN', isActive: false, organizationId: 'org-a', name: 'Former', email: 'f@agency.test' },
  ]);
  const put = await teamApp(t, db);
  const demoted = await put('/admin-2', { role: 'TEAM' });
  assert.equal(demoted.statusCode, 200, demoted.body);
  // admin-3 is inactive, so admin-1 is now the last active admin.
  assert.equal((await put('/admin-1', { isActive: false })).statusCode, 409);
});
