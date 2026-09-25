import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

const { default: portalRoutes } = await import('../../routes/portal.routes.js');
const { default: env } = await import('../../config/env.js');

// A weekday well in the future, so the past/weekend guards never interfere.
const DATE = '2031-03-05';

function buildFakePrisma({ admins, events }) {
  const calls = { eventQueries: [], created: [] };
  const eventInScope = (event, where) => {
    const orgFilter = where.createdBy?.organizationId
      ?? where.AND?.find((part) => part.createdBy)?.createdBy.organizationId;
    return orgFilter === undefined || event.organizationId === orgFilter;
  };
  const prisma = {
    user: {
      findFirst: async ({ where }) => {
        const found = admins
          .filter((admin) => admin.role === where.role && admin.isActive === where.isActive)
          .filter((admin) => !where.organizationId || admin.organizationId === where.organizationId)
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        return found ? { id: found.id, organizationId: found.organizationId } : null;
      },
    },
    calendarEvent: {
      findMany: async ({ where }) => {
        calls.eventQueries.push(where);
        return events.filter((event) => eventInScope(event, where));
      },
      findFirst: async ({ where }) => {
        calls.eventQueries.push(where);
        const [{ startTime: { lt: end } }, { endTime: { gt: start } }] = where.AND;
        return events.find((event) => eventInScope(event, where) && event.startTime < end && event.endTime > start) ?? null;
      },
      create: async ({ data }) => {
        calls.created.push(data);
        return { id: 'event-new', ...data };
      },
    },
  };
  return { prisma, calls };
}

async function buildApp(fake) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.prisma = fake.prisma; });
  await app.register(portalRoutes, { prefix: '/api/portal' });
  await app.ready();
  return app;
}

const admins = [
  { id: 'admin-owner', role: 'ADMIN', isActive: true, organizationId: 'org-owner', createdAt: new Date('2025-01-01') },
  { id: 'admin-other', role: 'ADMIN', isActive: true, organizationId: 'org-other', createdAt: new Date('2025-06-01') },
];
// Another tenant is busy at 10:00; the booking organization is free then.
const events = [
  { organizationId: 'org-other', startTime: new Date(`${DATE}T10:00:00`), endTime: new Date(`${DATE}T11:00:00`) },
];

describe('public booking stays inside one organization (#412 access review)', () => {
  it('ignores other tenants\' events when listing availability', async () => {
    const fake = buildFakePrisma({ admins, events });
    const app = await buildApp(fake);
    const res = await app.inject({ method: 'GET', url: `/api/portal/booking/availability?date=${DATE}` });
    await app.close();
    assert.equal(res.statusCode, 200);
    const tenAm = res.json().slots.find((slot) => slot.start === new Date(`${DATE}T10:00:00`).toISOString());
    assert.equal(tenAm.available, true);
    assert.deepEqual(fake.calls.eventQueries[0].createdBy, { organizationId: 'org-owner' });
  });

  it('books into the booking organization without a cross-tenant conflict', async () => {
    const fake = buildFakePrisma({ admins, events });
    const app = await buildApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/booking',
      payload: { name: 'Visitor', email: 'visitor@example.com', date: DATE, time: '10:00' },
    });
    await app.close();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(fake.calls.created[0].createdById, 'admin-owner');
  });

  it('honours PUBLIC_BOOKING_ORGANIZATION_ID and still detects that tenant\'s conflicts', async () => {
    const previous = env.publicBookingOrganizationId;
    env.publicBookingOrganizationId = 'org-other';
    try {
      const fake = buildFakePrisma({ admins, events });
      const app = await buildApp(fake);
      const res = await app.inject({
        method: 'POST',
        url: '/api/portal/booking',
        payload: { name: 'Visitor', email: 'visitor@example.com', date: DATE, time: '10:00' },
      });
      await app.close();
      assert.equal(res.statusCode, 409);
      assert.equal(fake.calls.created.length, 0);
    } finally {
      env.publicBookingOrganizationId = previous;
    }
  });

  it('refuses to book when no active admin owns the booking organization', async () => {
    const fake = buildFakePrisma({ admins: [], events: [] });
    const app = await buildApp(fake);
    const res = await app.inject({ method: 'GET', url: `/api/portal/booking/availability?date=${DATE}` });
    await app.close();
    assert.equal(res.statusCode, 503);
  });
});
