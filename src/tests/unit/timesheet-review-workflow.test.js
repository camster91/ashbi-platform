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
  await app.register(timeRoutes, { prefix: '/api/time' });
  return { app, updates };
}

test('admin approval records durable approval state and reviewer', async (t) => {
  const { app, updates } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'PATCH', url: '/api/time/timesheets/entry-1/approve' });

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
    url: '/api/time/timesheets/entry-1/reject',
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

  assert.match(api, /rejectTimesheetEntry: \(id, reason\)/);
  assert.match(page, /api\.rejectTimesheetEntry\(id, reason\)/);
  assert.match(page, /const canReview = user\?\.role === 'ADMIN'/);
  assert.match(page, /canReview=\{canReview\}/);
  assert.match(page, /entry\.reviewStatus === 'APPROVED'/);
  assert.match(page, /entry\.reviewStatus === 'REJECTED'/);
});
