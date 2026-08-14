import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import milestoneRoutes from '../../routes/milestone.routes.js';
import { restoreTrashedItem } from '../../services/trash-purge.service.js';

test('deleting a milestone creates one recovery ledger with its former task links', async (t) => {
  const calls = [];
  const original = { id: 'milestone-a', name: 'Launch', projectId: 'project-a' };
  const transaction = {
    milestone: {
      findUnique: async () => original,
      delete: async (args) => { calls.push(['archive', args]); return original; },
    },
    task: {
      findMany: async (args) => { calls.push(['find-tasks', args]); return [{ id: 'task-a' }, { id: 'task-b' }]; },
      updateMany: async (args) => { calls.push(['unlink-tasks', args]); return { count: 2 }; },
    },
    trashedItem: {
      create: async (args) => { calls.push(['ledger', args]); return { id: 'trash-milestone-a', ...args.data }; },
    },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user-a', organizationId: 'org-a', role: 'ADMIN' };
  });
  app.decorate('prisma', {
    milestone: { findUnique: async () => original },
    $transaction: async (callback) => callback(transaction),
  });
  app.addHook('onRequest', async (request) => {
    request.prisma = app.prisma;
  });
  await app.register(milestoneRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/milestones/milestone-a' });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { success: true, trashId: 'trash-milestone-a' });
  assert.deepEqual(calls.map(([operation]) => operation), ['find-tasks', 'unlink-tasks', 'archive', 'ledger']);
  assert.deepEqual(calls[0][1], { where: { milestoneId: 'milestone-a' }, select: { id: true } });
  assert.deepEqual(calls[1][1], { where: { milestoneId: 'milestone-a' }, data: { milestoneId: null } });
  assert.equal(calls[3][1].data.entity, 'MILESTONE');
  assert.deepEqual(calls[3][1].data.data.taskIds, ['task-a', 'task-b']);
});

test('restoring a milestone relinks only its original unassigned project tasks', async () => {
  const calls = [];
  const ledger = {
    id: 'trash-milestone-a',
    entity: 'MILESTONE',
    recordId: 'milestone-a',
    organizationId: 'org-a',
    restoredAt: null,
    data: { projectId: 'project-a', taskIds: ['task-a', 'task-b'] },
  };
  const scopedPrisma = {
    trashedItem: { findFirst: async () => ledger },
  };
  const rawPrisma = {
    $transaction: async (callback) => callback({
      trashedItem: {
        findFirst: async (args) => { calls.push(['locked-ledger', args]); return ledger; },
        update: async (args) => { calls.push(['restore-ledger', args]); return args; },
      },
      milestone: {
        findFirst: async (args) => { calls.push(['find-milestone', args]); return { id: 'milestone-a', projectId: 'project-a' }; },
        update: async (args) => { calls.push(['restore-milestone', args]); return args; },
      },
      task: {
        updateMany: async (args) => { calls.push(['restore-unassigned-tasks', args]); return { count: 1 }; },
      },
    }),
  };

  const result = await restoreTrashedItem({ scopedPrisma, rawPrisma, trashId: ledger.id });

  assert.deepEqual(result, { restoredId: 'milestone-a', entity: 'MILESTONE' });
  assert.deepEqual(calls.find(([operation]) => operation === 'restore-milestone')[1], {
    where: { id: 'milestone-a' }, data: { deletedAt: null },
  });
  assert.deepEqual(calls.find(([operation]) => operation === 'restore-unassigned-tasks')[1], {
    where: {
      id: { in: ['task-a', 'task-b'] },
      projectId: 'project-a',
      milestoneId: null,
      project: { client: { organizationId: 'org-a' } },
    },
    data: { milestoneId: 'milestone-a' },
  });
});
