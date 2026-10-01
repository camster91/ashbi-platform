// PUT /api/calendar/:id checks end >= start against the stored value when
// only one end is sent, and attendees are only active staff (ADMIN/TEAM) of
// the caller's organization.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

const { default: calendarRoutes } = await import('../../routes/calendar.routes.js');

const USERS = [
  { id: 'admin-1', role: 'ADMIN', isActive: true },
  { id: 'team-1', role: 'TEAM', isActive: true },
  { id: 'client-1', role: 'CLIENT', isActive: true },
  { id: 'bot-1', role: 'BOT', isActive: true },
  { id: 'gone-1', role: 'TEAM', isActive: false },
];

async function setup(t) {
  const event = {
    id: 'evt_1', title: 'Kickoff', createdById: 'admin-1', attendees: [],
    startTime: new Date('2026-10-02T14:00:00.000Z'), endTime: new Date('2026-10-02T15:00:00.000Z'),
  };
  const writes = { attendees: [], updates: [] };
  const prisma = {
    calendarEvent: {
      findUnique: async () => event,
      update: async ({ data }) => { writes.updates.push(data); return { ...event, ...data }; },
      create: async ({ data }) => { writes.created = data; return { id: 'evt_2', ...data }; },
    },
    eventAttendee: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }) => { writes.attendees.push(...data); return { count: data.length }; },
    },
    user: {
      findMany: async ({ where }) => USERS.filter((user) => where.id.in.includes(user.id)
        && user.isActive === where.isActive && where.role.in.includes(user.role)),
    },
    project: { findUnique: async () => null },
    activity: { create: async () => ({}) },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'admin-1', role: 'ADMIN', organizationId: 'org_1', name: 'Admin' };
    request.prisma = prisma;
  });
  const notified = [];
  app.decorate('notify', async (userId) => { notified.push(userId); });
  await app.register(calendarRoutes, { prefix: '/api/calendar' });
  t.after(() => app.close());
  const put = (payload) => app.inject({ method: 'PUT', url: '/api/calendar/evt_1', payload });
  return { app, put, writes, notified };
}

describe('calendar event guards', () => {
  it('compares a lone endTime or startTime with the stored other end', async (t) => {
    const { put, writes } = await setup(t);
    assert.equal((await put({ endTime: '2026-10-02T13:00:00.000Z' })).statusCode, 400);
    assert.equal((await put({ startTime: '2026-10-02T16:00:00.000Z' })).statusCode, 400);
    assert.equal(writes.updates.length, 0);
    assert.equal((await put({ endTime: '2026-10-02T16:00:00.000Z' })).statusCode, 200);
  });

  it('keeps only active ADMIN/TEAM attendees on update and create', async (t) => {
    const { app, put, writes, notified } = await setup(t);
    const ids = ['team-1', 'client-1', 'bot-1', 'gone-1', 'other-org-1'];
    assert.equal((await put({ attendeeIds: ids })).statusCode, 200);
    assert.deepEqual(writes.attendees.map((row) => row.userId), ['team-1']);
    assert.deepEqual(notified, ['team-1']);

    const created = await app.inject({
      method: 'POST', url: '/api/calendar', payload: {
        title: 'Review', type: 'MEETING', startTime: '2026-10-03T14:00:00.000Z', endTime: '2026-10-03T15:00:00.000Z', attendeeIds: ids,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(writes.created.attendees.create, [{ userId: 'team-1' }]);
  });
});
