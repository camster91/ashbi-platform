import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import timeRoutes from '../../routes/time.routes.js';

async function createApp(role = 'ADMIN') {
  const updates = [];
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'reviewer-1', role };
  });
  app.addHook('onRequest', async (request) => {
    request.prisma = {
      timeEntry: {
        findUnique: async ({ where }) => ({ id: where.id, reviewStatus: 'PENDING' }),
        update: async (args) => {
          updates.push(args);
          return { id: args.where.id, ...args.data };
        },
      },
    };
  });
  await app.register(timeRoutes, { prefix: '/api' });
  return { app, updates };
}

test('admin approval records durable approval state and reviewer', async (t) => {
  const { app, updates } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'PATCH', url: '/api/timesheets/entry-1/approve' });

  assert.equal(response.statusCode, 200);
  assert.equal(updates[0].data.reviewStatus, 'APPROVED');
  assert.equal(updates[0].data.reviewedById, 'reviewer-1');
  assert.ok(updates[0].data.reviewedAt instanceof Date);
  assert.equal(updates[0].data.rejectionReason, null);
});

test('admin rejection records a reason without calling approval', async (t) => {
  const { app, updates } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/timesheets/entry-1/reject',
    payload: { reason: 'Description does not match the work performed.' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(updates[0].data.reviewStatus, 'REJECTED');
  assert.equal(updates[0].data.reviewedById, 'reviewer-1');
  assert.equal(updates[0].data.rejectionReason, 'Description does not match the work performed.');
});

test('timesheet UI calls the rejection API and renders persisted review state', () => {
  const api = readFileSync(resolve(process.cwd(), 'web/src/lib/api.js'), 'utf8');
  const page = readFileSync(resolve(process.cwd(), 'web/src/pages/Timesheets.jsx'), 'utf8');
  // The review state and buttons render in the Time page's entry component.
  const review = readFileSync(resolve(process.cwd(), 'web/src/components/time/EntryReview.jsx'), 'utf8');

  assert.match(api, /rejectTimesheetEntry: \(id, reason\)/);
  assert.match(page, /api\.rejectTimesheetEntry\(id, reason\)/);
  assert.match(page, /const canReview = user\?\.role === 'ADMIN'/);
  assert.match(page, /canReview=\{canReview\}/);
  assert.match(review, /entry\.reviewStatus === 'APPROVED'/);
  assert.match(review, /entry\.reviewStatus === 'REJECTED'/);
  assert.match(review, /if \(!canReview\) return/);
});


test('TEAM weekly timesheets scope to the current actor and reject review writes', async t => {
  const app = Fastify({ logger: false });
  const queries = []; let updates = 0;
  const entries = ['member-a', 'member-b'].map((userId, index) => ({ id: `entry-${index}`, userId,
    date: new Date('2026-10-12T12:00:00Z'), duration: 60, billable: true,
    user: { id: userId, name: userId, hourlyRate: 50 }, project: { id: 'project-a', name: 'Project' }, task: null }));
  app.decorate('authenticate', async request => { request.user = { id: 'member-a', role: 'TEAM' }; });
  app.addHook('onRequest', async request => { request.prisma = { timeEntry: {
    findMany: async args => { queries.push(args); return entries.filter(row => !args.where.userId || row.userId === args.where.userId); },
    update: async () => { updates++; },
  } }; });
  await app.register(timeRoutes, { prefix: '/api' }); t.after(() => app.close());
  const response = await app.inject('/api/timesheets/weekly?weekStart=2026-10-12T00:00:00Z&userId=member-b');
  assert.equal(response.statusCode, 200);
  assert.equal(queries[0].where.userId, 'member-a');
  assert.deepEqual(response.json().timesheets.map(row => row.user.id), ['member-a']);
  for (const action of ['approve', 'reject']) {
    const result = await app.inject({ method: 'PATCH', url: `/api/timesheets/entry-0/${action}`, ...(action === 'reject' ? { payload: { reason: 'Unauthorized review' } } : {}) });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(updates, 0);
});
