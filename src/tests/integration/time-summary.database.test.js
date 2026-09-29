import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';
import timeTrackingRoutes from '../../routes/time-tracking.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// GET /api/time-tracking/summary counts the canonical TimeEntry records
// (timer and manual) plus timer sessions stopped before timers recorded an
// entry, never a timer twice (Codex P2 on #480: manual entries were missing).
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const MINUTE = 60_000;

test('the time summary includes manual entries, timer entries and legacy sessions once each', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const s = randomUUID();
  const ids = { org: `sum-org-${s}`, client: `sum-client-${s}`, project: `sum-project-${s}`, user: `sum-user-${s}`, other: `sum-other-${s}` };
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Summary', slug: `sum-${s}` } });
    await raw.client.create({ data: { id: ids.client, name: 'Summary client', organizationId: ids.org } });
    await raw.project.create({ data: { id: ids.project, name: 'Summary project', clientId: ids.client, organizationId: ids.org } });
    await raw.user.createMany({ data: [ids.user, ids.other].map((id) => ({ id, email: `${id}@example.com`, name: id, password: 'x', role: 'TEAM', organizationId: ids.org })) });

    const day = new Date('2026-09-10T10:00:00.000Z');
    // A legacy timer session stopped before timers recorded entries: 30 min.
    await raw.timeSession.create({ data: { userId: ids.user, projectId: ids.project, startTime: day, endTime: new Date(day.getTime() + 30 * MINUTE), duration: 30, isRunning: false } });
    // A timer that recorded its entry: 45 min, counted once (via the entry).
    const timed = await raw.timeSession.create({ data: { userId: ids.user, projectId: ids.project, startTime: day, endTime: new Date(day.getTime() + 45 * MINUTE), duration: 45, isRunning: false } });
    await raw.timeEntry.create({ data: { userId: ids.user, projectId: ids.project, duration: 45, date: day, source: 'TIMER', timeSessionId: timed.id } });
    // A running timer is not recorded time.
    await raw.timeSession.create({ data: { userId: ids.user, projectId: ids.project, startTime: new Date(), duration: 0, isRunning: true } });
    // Another user's time is excluded.
    await raw.timeEntry.create({ data: { userId: ids.other, projectId: ids.project, duration: 999, date: day, source: 'MANUAL' } });

    app = Fastify();
    app.decorate('authenticate', async (request) => { request.user = { id: ids.user, role: 'TEAM', organizationId: ids.org }; });
    const scoped = createScopedPrisma(raw, ids.org);
    app.addHook('onRequest', async (request) => {
      request.prisma = scoped;
      enterRequestContext({ prisma: scoped, organizationId: ids.org });
    });
    await app.register(timeTrackingRoutes, { prefix: '/api/time-tracking' });

    const manual = await app.inject({ method: 'POST', url: '/api/time-tracking/manual', payload: { projectId: ids.project, duration: 20, billable: false, date: day.toISOString() } });
    assert.equal(manual.statusCode, 201, manual.body);

    const summary = await app.inject({ method: 'GET', url: '/api/time-tracking/summary' });
    assert.equal(summary.statusCode, 200, summary.body);
    const body = summary.json();
    assert.equal(body.totalMinutes, 30 + 45 + 20);
    assert.equal(body.billableMinutes, 30 + 45);
    assert.equal(body.nonBillableMinutes, 20);
    assert.equal(body.entries.length, 3);
    assert.deepEqual(body.entries.map((e) => e.source).sort(), ['MANUAL', 'TIMER', 'TIMER']);
    assert.equal(body.byProject.length, 1);
    assert.equal(body.byProject[0].totalMinutes, 95);

    const filtered = await app.inject({ method: 'GET', url: `/api/time-tracking/summary?startDate=2026-09-11T00:00:00.000Z` });
    assert.equal(filtered.json().totalMinutes, 0, 'date filters apply to entries and legacy sessions');
  } finally {
    await app?.close();
    await raw.timeEntry.deleteMany({ where: { projectId: ids.project } });
    await raw.timeSession.deleteMany({ where: { projectId: ids.project } });
    await raw.activity.deleteMany({ where: { projectId: ids.project } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.user.deleteMany({ where: { id: { in: [ids.user, ids.other] } } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
