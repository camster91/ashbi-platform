import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';
import timeTrackingRoutes from '../../routes/time-tracking.routes.js';
import timeSessionRoutes from '../../routes/time-sessions.routes.js';
import timeRoutes from '../../routes/time.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Timers against a real PostgreSQL schema (built with `prisma migrate
// deploy`): stopping a timer records a TimeEntry in the same transaction
// (C2), only the owner can stop or delete a timer (C2), parallel starts
// leave exactly one running timer thanks to the partial unique index (H7),
// and approved or invoiced entries are locked (H6).
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('timers record entries, are owner-scoped, race-safe, and approved entries are locked', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    org: `timer-org-${suffix}`, client: `timer-client-${suffix}`, project: `timer-project-${suffix}`,
    owner: `timer-owner-${suffix}`, other: `timer-other-${suffix}`, admin: `timer-admin-${suffix}`,
  };
  const users = {
    [ids.owner]: { id: ids.owner, name: 'Owner', role: 'TEAM', organizationId: ids.org },
    [ids.other]: { id: ids.other, name: 'Other', role: 'TEAM', organizationId: ids.org },
    [ids.admin]: { id: ids.admin, name: 'Admin', role: 'ADMIN', organizationId: ids.org },
  };
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Timer tenant', slug: `timer-${suffix}` } });
    await raw.client.create({ data: { id: ids.client, name: 'Timer client', organizationId: ids.org } });
    await raw.project.create({ data: { id: ids.project, name: 'Timer project', clientId: ids.client, organizationId: ids.org } });
    await raw.user.createMany({ data: Object.values(users).map((user) => ({
      ...user, email: `${user.id}@example.com`, password: 'x',
    })) });

    app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = users[request.headers['x-test-user']];
    });
    const scoped = createScopedPrisma(raw, ids.org);
    // `x-approve-after-read` simulates an admin approval that commits between
    // the route's lock check and its write.
    const approvingAfterRead = new Proxy(scoped, {
      get(target, key) {
        if (key !== 'timeEntry') return Reflect.get(target, key);
        const delegate = target.timeEntry;
        let first = true;
        return new Proxy(delegate, {
          get(model, operation) {
            if (operation !== 'findUnique') return typeof model[operation] === 'function' ? model[operation].bind(model) : model[operation];
            return async (args) => {
              const row = await model.findUnique(args);
              if (first && row) {
                first = false;
                await raw.timeEntry.update({ where: { id: row.id }, data: { reviewStatus: 'APPROVED' } });
              }
              return row;
            };
          },
        });
      },
    });
    app.addHook('onRequest', async (request) => {
      request.prisma = request.headers['x-approve-after-read'] ? approvingAfterRead : scoped;
      enterRequestContext({ prisma: request.prisma, organizationId: ids.org });
    });
    await app.register(timeTrackingRoutes, { prefix: '/api/time-tracking' });
    await app.register(timeSessionRoutes, { prefix: '/api/time-sessions' });
    await app.register(timeRoutes, { prefix: '/api' });
    const as = (userId, options) => app.inject({ ...options, headers: { 'x-test-user': userId, ...(options.headers ?? {}) } });

    // Start, then backdate so the timer has measurable duration.
    const started = await as(ids.owner, { method: 'POST', url: '/api/time-sessions', payload: { projectId: ids.project, description: 'Design work' } });
    assert.equal(started.statusCode, 201, started.body);
    const timer = started.json();
    await raw.timeSession.update({ where: { id: timer.id }, data: { startTime: new Date(Date.now() - 45 * 60_000) } });

    // Someone else cannot stop or delete it, and learns nothing (404, not 500).
    const foreignStop = await as(ids.other, { method: 'POST', url: `/api/time-sessions/${timer.id}/stop` });
    assert.equal(foreignStop.statusCode, 404, foreignStop.body);
    const foreignStop2 = await as(ids.other, { method: 'POST', url: `/api/time-tracking/${timer.id}/stop` });
    assert.equal(foreignStop2.statusCode, 404, foreignStop2.body);
    const foreignDelete = await as(ids.other, { method: 'DELETE', url: `/api/time-tracking/${timer.id}` });
    assert.equal(foreignDelete.statusCode, 404, foreignDelete.body);
    assert.equal((await raw.timeSession.findUnique({ where: { id: timer.id } })).isRunning, true);

    // The owner stops it: a TIMER entry is recorded in the same transaction.
    const stopped = await as(ids.owner, { method: 'POST', url: `/api/time-sessions/${timer.id}/stop` });
    assert.equal(stopped.statusCode, 200, stopped.body);
    assert.equal(stopped.json().isRunning, false);
    const entry = stopped.json().timeEntry;
    assert.ok(entry, 'stop returns the recorded entry');
    assert.equal(entry.source, 'TIMER');
    assert.equal(entry.timeSessionId, timer.id);
    assert.ok(entry.duration >= 44 && entry.duration <= 46, `duration ${entry.duration}`);
    const listed = await as(ids.owner, { method: 'GET', url: `/api/projects/${ids.project}/time-entries` });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(listed.json().entries.map((row) => row.id), [entry.id]);

    const again = await as(ids.owner, { method: 'POST', url: `/api/time-sessions/${timer.id}/stop` });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, 'TIMER_NOT_RUNNING');

    // Starting while a timer runs stops (and records) the previous one.
    const first = (await as(ids.owner, { method: 'POST', url: '/api/time-tracking/start', payload: { projectId: ids.project } })).json();
    await raw.timeSession.update({ where: { id: first.id }, data: { startTime: new Date(Date.now() - 10 * 60_000) } });
    const second = await as(ids.owner, { method: 'POST', url: '/api/time-tracking/start', payload: { projectId: ids.project } });
    assert.equal(second.statusCode, 201, second.body);
    assert.equal((await raw.timeSession.findUnique({ where: { id: first.id } })).isRunning, false);
    assert.ok(await raw.timeEntry.findUnique({ where: { timeSessionId: first.id } }), 'the replaced timer was recorded');

    // Parallel starts: exactly one running timer survives; losers get 409.
    const results = await Promise.all(Array.from({ length: 6 }, () => as(ids.owner, {
      method: 'POST', url: '/api/time-tracking/start', payload: { projectId: ids.project },
    })));
    const statuses = results.map((response) => response.statusCode);
    assert.ok(statuses.every((status) => status === 201 || status === 409), `statuses ${statuses}`);
    assert.ok(statuses.includes(201));
    for (const response of results.filter((r) => r.statusCode === 409)) {
      assert.equal(response.json().code, 'TIMER_ALREADY_RUNNING');
    }
    assert.equal(await raw.timeSession.count({ where: { userId: ids.owner, isRunning: true } }), 1);

    // The database itself refuses a second running timer.
    await assert.rejects(raw.timeSession.create({ data: {
      userId: ids.owner, projectId: ids.project, startTime: new Date(), isRunning: true,
    } }), /Unique constraint|P2002/);

    // H6: approved and invoiced entries are locked.
    const approve = await as(ids.admin, { method: 'PATCH', url: `/api/timesheets/${entry.id}/approve` });
    assert.equal(approve.statusCode, 200, approve.body);
    const edit = await as(ids.owner, { method: 'PUT', url: `/api/time-entries/${entry.id}`, payload: { description: 'changed' } });
    assert.equal(edit.statusCode, 409);
    assert.equal(edit.json().code, 'TIME_ENTRY_APPROVED');
    const remove = await as(ids.owner, { method: 'DELETE', url: `/api/time-entries/${entry.id}` });
    assert.equal(remove.statusCode, 409);
    const adminEdit = await as(ids.admin, { method: 'PUT', url: `/api/time-entries/${entry.id}`, payload: { description: 'changed' } });
    assert.equal(adminEdit.statusCode, 409, 'admins reopen through the reject action, not by editing');
    const reject = await as(ids.admin, { method: 'PATCH', url: `/api/timesheets/${entry.id}/reject`, payload: { reason: 'Split this across two tasks.' } });
    assert.equal(reject.statusCode, 200, reject.body);
    const reopenedEdit = await as(ids.owner, { method: 'PUT', url: `/api/time-entries/${entry.id}`, payload: { description: 'fixed' } });
    assert.equal(reopenedEdit.statusCode, 200, reopenedEdit.body);

    // An approval that commits after the lock check still wins: the write is
    // conditional, so the owner's edit and delete change nothing.
    for (const method of ['PUT', 'DELETE']) {
      await raw.timeEntry.update({ where: { id: entry.id }, data: { reviewStatus: 'PENDING' } });
      const raced = await as(ids.owner, {
        method, url: `/api/time-entries/${entry.id}`, headers: { 'x-approve-after-read': '1' },
        ...(method === 'PUT' ? { payload: { description: 'raced edit' } } : {}),
      });
      assert.equal(raced.statusCode, 409, `${method} ${raced.body}`);
      assert.equal(raced.json().code, 'TIME_ENTRY_APPROVED');
      const stored = await raw.timeEntry.findUnique({ where: { id: entry.id } });
      assert.equal(stored.description, 'fixed', `${method} left the approved entry unchanged`);
      assert.equal(stored.deletedAt, null, `${method} did not delete the approved entry`);
    }
    await raw.timeEntry.update({ where: { id: entry.id }, data: { reviewStatus: 'REJECTED' } });

    // A weekly timesheet counts every entry of the week, beyond one 100-row read.
    const weekStart = new Date('2031-03-02T00:00:00.000Z');
    await raw.timeEntry.createMany({ data: Array.from({ length: 130 }, (_, i) => ({
      userId: ids.other, projectId: ids.project, duration: 10, billable: i % 2 === 0,
      date: new Date(weekStart.getTime() + (i % 7) * 86_400_000 + 3_600_000),
    })) });
    const week = await as(ids.other, { method: 'GET', url: `/api/timesheets/weekly?weekStart=${weekStart.toISOString()}` });
    assert.equal(week.statusCode, 200, week.body);
    const [sheet] = week.json().timesheets;
    assert.equal(sheet.totalMinutes, 1300, 'all 130 entries are counted');
    assert.equal(sheet.billableMinutes, 650);
    assert.equal(Object.values(sheet.days).reduce((sum, day) => sum + day.entries.length, 0), 130);

    await raw.timeEntry.update({ where: { id: entry.id }, data: { invoiced: true } });
    const invoicedDelete = await as(ids.admin, { method: 'DELETE', url: `/api/time-entries/${entry.id}` });
    assert.equal(invoicedDelete.statusCode, 409);
    assert.equal(invoicedDelete.json().code, 'TIME_ENTRY_INVOICED');
  } finally {
    await app?.close();
    await raw.timeEntry.deleteMany({ where: { projectId: ids.project } });
    await raw.timeSession.deleteMany({ where: { projectId: ids.project } });
    await raw.activity.deleteMany({ where: { projectId: ids.project } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.user.deleteMany({ where: { id: { in: Object.keys(users) } } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
