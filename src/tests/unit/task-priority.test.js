import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import {
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITIES,
  sortByTaskPriority,
} from '../../shared/task-priority.js';
import { findTasksInPriorityOrder } from '../../services/task-priority-order.js';
import { createTaskSchema, taskCreateQuickSchema, taskUpdateSchema } from '../../validators/schemas.js';
import taskRoutes from '../../routes/task.routes.js';

// H1: the Kanban "add task" sent priority MEDIUM, which the API rejects
// (400 every time); card colours used MEDIUM/URGENT. M8: tasks were ordered
// alphabetically (CRITICAL, HIGH, LOW, NORMAL).

test('the web app and the API share one task priority list', () => {
  assert.deepEqual([...TASK_PRIORITIES], ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
  for (const priority of TASK_PRIORITIES) {
    assert.equal(taskCreateQuickSchema.safeParse({ title: 't', priority }).success, true, priority);
    assert.equal(taskUpdateSchema.safeParse({ priority }).success, true, priority);
  }
  assert.equal(taskCreateQuickSchema.safeParse({ title: 't', priority: 'MEDIUM' }).success, false);
  assert.equal(taskCreateQuickSchema.parse({ title: 't' }).priority, DEFAULT_TASK_PRIORITY);
  assert.equal(createTaskSchema.parse({ title: 't', projectId: 'p1' }).priority, DEFAULT_TASK_PRIORITY);

  const kanban = readFileSync(new URL('../../../web/src/pages/TaskKanban.jsx', import.meta.url), 'utf8');
  assert.match(kanban, /from '@shared\/task-priority\.js'/);
  assert.match(kanban, /priority: DEFAULT_TASK_PRIORITY/);
  assert.doesNotMatch(kanban, /MEDIUM|URGENT/);
});

test('in-memory ordering is semantic and stable', () => {
  const sorted = sortByTaskPriority([
    { id: 1, priority: 'LOW' }, { id: 2, priority: 'NORMAL' }, { id: 3, priority: 'CRITICAL' },
    { id: 4, priority: 'HIGH' }, { id: 5, priority: 'NORMAL' }, { id: 6, priority: 'WEIRD' },
  ]);
  assert.deepEqual(sorted.map((task) => task.id), [3, 4, 2, 5, 1, 6]);
});

function fakeTaskDelegate(rows) {
  const matches = (row, where) => {
    if (!where) return true;
    if (where.AND) return where.AND.every((clause) => matches(row, clause));
    if (where.priority && typeof where.priority === 'object') return !where.priority.notIn.includes(row.priority);
    if (where.priority) return row.priority === where.priority;
    return true;
  };
  return {
    count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
    findMany: async ({ where, skip = 0, take }) => rows.filter((row) => matches(row, where)).slice(skip, skip + take),
  };
}

test('paginated lists are ordered by priority in the database, across pages', async () => {
  const rows = [
    ...['a', 'b', 'c'].map((id) => ({ id: `low-${id}`, priority: 'LOW' })),
    ...['a', 'b'].map((id) => ({ id: `normal-${id}`, priority: 'NORMAL' })),
    ...['a', 'b'].map((id) => ({ id: `critical-${id}`, priority: 'CRITICAL' })),
    { id: 'high-a', priority: 'HIGH' },
  ];
  const delegate = fakeTaskDelegate(rows);
  const page1 = await findTasksInPriorityOrder(delegate, { where: {}, skip: 0, take: 3 });
  const page2 = await findTasksInPriorityOrder(delegate, { where: {}, skip: 3, take: 3 });
  const page3 = await findTasksInPriorityOrder(delegate, { where: {}, skip: 6, take: 3 });
  assert.deepEqual(page1.map((row) => row.id), ['critical-a', 'critical-b', 'high-a']);
  assert.deepEqual(page2.map((row) => row.id), ['normal-a', 'normal-b', 'low-a']);
  assert.deepEqual(page3.map((row) => row.id), ['low-b', 'low-c']);
});

test('a bucket larger than one capped findMany is read to the end before lower priorities', async () => {
  // Soft-deletable models cap findMany at 100 rows; a short page is not the
  // end of the bucket.
  const rows = [
    ...Array.from({ length: 150 }, (_, i) => ({ id: `critical-${String(i).padStart(3, '0')}`, priority: 'CRITICAL' })),
    { id: 'high-a', priority: 'HIGH' },
  ];
  const plain = fakeTaskDelegate(rows);
  const capped = { ...plain, findMany: async (args) => plain.findMany({ ...args, take: Math.min(args.take, 100) }) };
  const first = await findTasksInPriorityOrder(capped, { where: {}, skip: 0, take: 200 });
  assert.equal(first.length, 151);
  assert.deepEqual(first.slice(0, 150).map((row) => row.priority), Array(150).fill('CRITICAL'));
  assert.equal(first[150].id, 'high-a');
  const second = await findTasksInPriorityOrder(capped, { where: {}, skip: 120, take: 10 });
  assert.deepEqual(second.map((row) => row.id), Array.from({ length: 10 }, (_, i) => `critical-${120 + i}`));
});

test('GET /api/tasks/my pages through the global priority order', async () => {
  const rows = [
    { id: 'n1', priority: 'NORMAL', category: 'UPCOMING' }, { id: 'l1', priority: 'LOW', category: 'UPCOMING' },
    { id: 'c1', priority: 'CRITICAL', category: 'UPCOMING' }, { id: 'h1', priority: 'HIGH', category: 'UPCOMING' },
  ];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'TEAM' }; });
  app.addHook('onRequest', async (request) => { request.prisma = { task: fakeTaskDelegate(rows) }; });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  try {
    const first = await app.inject({ method: 'GET', url: '/api/tasks/my?limit=2&offset=0' });
    const second = await app.inject({ method: 'GET', url: '/api/tasks/my?limit=2&offset=2' });
    assert.deepEqual(first.json().UPCOMING.map((task) => task.id), ['c1', 'h1']);
    assert.deepEqual(second.json().UPCOMING.map((task) => task.id), ['n1', 'l1']);
  } finally {
    await app.close();
  }
});

test('GET /api/tasks returns the most urgent tasks first', async () => {
  const rows = [
    { id: 't-low', priority: 'LOW' }, { id: 't-normal', priority: 'NORMAL' },
    { id: 't-critical', priority: 'CRITICAL' }, { id: 't-high', priority: 'HIGH' },
  ];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', role: 'ADMIN' }; });
  app.addHook('onRequest', async (request) => { request.prisma = { task: fakeTaskDelegate(rows) }; });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/tasks' });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().tasks.map((task) => task.id), ['t-critical', 't-high', 't-normal', 't-low']);
  } finally {
    await app.close();
  }
});
