import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { requestStorage } from '../../utils/request-context.js';
import { createNotifier } from '../../services/notification.service.js';
import commentRoutes from '../../routes/comment.routes.js';
import chatRoutes from '../../routes/chat.routes.js';
import { taskBlockedRecipients, notifyTaskBlocked } from '../../subscribers/notification.subscriber.js';

// H4: routes persisted a notification and then called fastify.notify(),
// which persisted a second row titled with the raw type and a JSON blob as
// its message. M10: blocked-task alerts went to a hardcoded email address.

function recordingIo() {
  const emitted = [];
  return { emitted, to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
}

function notificationTable() {
  const rows = [];
  return {
    rows,
    notification: {
      create: async ({ data }) => { const row = { id: `n${rows.length + 1}`, createdAt: new Date(), read: false, ...data }; rows.push(row); return row; },
    },
  };
}

test('notify persists exactly one human-readable row and emits it once', async () => {
  const db = notificationTable();
  const io = recordingIo();
  const { notify } = createNotifier(io);
  await requestStorage.run({ prisma: db, organizationId: 'org-a' }, () => notify('u1', {
    type: 'MENTION', title: 'You were mentioned', message: 'Avery mentioned you', data: { projectId: 'p1' },
  }));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].title, 'You were mentioned');
  assert.equal(db.rows[0].message, 'Avery mentioned you');
  assert.deepEqual(db.rows[0].data, { projectId: 'p1' }, 'data is stored as an object for deep links');
  assert.deepEqual(io.emitted.map((entry) => [entry.room, entry.event]), [['user:u1', 'notification:new'], ['user:u1', 'notification']]);
  assert.equal(io.emitted[1].payload.title, undefined, 'the legacy event never causes a second toast');
});

test('no route creates notification rows besides the single notify() path', () => {
  for (const file of ['chat', 'comment', 'calendar', 'response', 'thread']) {
    const source = readFileSync(new URL(`../../routes/${file}.routes.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /notification\.create\(/, `${file}.routes.js`);
    assert.doesNotMatch(source, /fastify\.notify\([^,]+,\s*'/, `${file}.routes.js uses the object form`);
  }
  const server = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /message: JSON\.stringify\(data\)/);
});

function commentApp({ notifications }) {
  const app = Fastify();
  const db = notificationTable();
  app.decorate('authenticate', async (request) => { request.user = { id: 'author', name: 'Avery', role: 'TEAM', organizationId: 'org-a' }; });
  app.decorate('notify', async (userId, notification) => {
    notifications.push({ userId, ...notification });
    return db.notification.create({ data: { userId, ...notification } });
  });
  const prisma = {
    task: { findUnique: async () => ({ id: 't1', title: 'Homepage', projectId: 'p1', assigneeId: 'assignee', project: { id: 'p1', name: 'Site' } }) },
    user: { findMany: async () => [{ id: 'dana', name: 'Dana' }] },
    taskComment: { create: async ({ data }) => ({ id: 'c1', ...data, author: { id: 'author', name: 'Avery' } }) },
    activity: { create: async () => ({}) },
    notification: { create: async () => { throw new Error('routes must not create notification rows directly'); } },
  };
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  return { app, db };
}

test('a comment with a mention and an assignee writes one row per recipient', async () => {
  const notifications = [];
  const { app, db } = commentApp({ notifications });
  await app.register(commentRoutes, { prefix: '/api' });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/tasks/t1/comments', payload: { content: 'Ping @Dana' } });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(db.rows.length, 2);
    assert.deepEqual(notifications.map((n) => [n.userId, n.type]), [['dana', 'MENTION'], ['assignee', 'TASK_COMMENT']]);
    assert.equal(notifications[0].title, 'You were mentioned in a comment');
    assert.deepEqual(notifications[1].data, { taskId: 't1', commentId: 'c1', projectId: 'p1' });
  } finally {
    await app.close();
  }
});

test('a chat mention writes one row', async () => {
  const notifications = [];
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'c123456789012345678901234', name: 'Avery', role: 'TEAM', organizationId: 'org-a' }; });
  app.decorate('notify', async (userId, notification) => { notifications.push({ userId, ...notification }); });
  app.decorate('io', recordingIo());
  const prisma = {
    project: { findFirst: async () => ({ id: 'p1' }) },
    chatMessage: { create: async ({ data }) => ({ id: 'm1', ...data, author: { id: data.authorId, name: 'Avery' }, reactions: [], replies: [] }) },
    activity: { create: async () => ({}) },
    user: { findMany: async () => [{ id: 'dana', name: 'Dana' }] },
    notification: { create: async () => { throw new Error('routes must not create notification rows directly'); } },
  };
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(chatRoutes, { prefix: '/api' });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/projects/p1/messages', payload: { content: 'Hi @Dana' } });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'MENTION');
    assert.equal(notifications[0].title, 'You were mentioned');
  } finally {
    await app.close();
  }
});

function usersDb({ project, users }) {
  return {
    project: { findFirst: async ({ where }) => (where.id === project.id && where.organizationId === project.organizationId ? project : null) },
    user: {
      findMany: async ({ where }) => users.filter((user) => user.organizationId === where.organizationId
        && user.isActive === where.isActive
        && (!where.id?.in || where.id.in.includes(user.id))
        && (!where.id?.not || user.id !== where.id.not)
        && (!where.role || user.role === where.role)),
    },
  };
}

test('blocked-task alerts go to the assignee and project owner, never a hardcoded address (M10)', async () => {
  const users = [
    { id: 'assignee', organizationId: 'org-a', role: 'TEAM', isActive: true },
    { id: 'owner', organizationId: 'org-a', role: 'TEAM', isActive: true },
    { id: 'admin', organizationId: 'org-a', role: 'ADMIN', isActive: true },
    { id: 'other-org-admin', organizationId: 'org-b', role: 'ADMIN', isActive: true },
  ];
  const project = { id: 'p1', organizationId: 'org-a', defaultOwnerId: 'owner' };
  const db = usersDb({ project, users });
  const actor = { id: 'blocker', name: 'Blake', organizationId: 'org-a' };
  assert.deepEqual(
    (await taskBlockedRecipients(db, { task: { projectId: 'p1', assigneeId: 'assignee' }, user: actor })).sort(),
    ['assignee', 'owner'],
  );
  // Nobody assigned and no owner: the organization's admins, not another org's.
  const unowned = usersDb({ project: { ...project, defaultOwnerId: null }, users });
  assert.deepEqual(await taskBlockedRecipients(unowned, { task: { projectId: 'p1', assigneeId: null }, user: actor }), ['admin']);
  // The actor never notifies themself.
  assert.deepEqual(await taskBlockedRecipients(unowned, { task: { projectId: 'p1', assigneeId: 'admin' }, user: { ...actor, id: 'admin' } }), []);

  const sent = [];
  await notifyTaskBlocked({ prisma: db, notify: async (userId, n) => sent.push({ userId, ...n }) }, {
    task: { id: 't1', title: 'Launch', projectId: 'p1', assigneeId: 'assignee' }, user: actor, reason: 'Waiting on DNS',
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, 'TASK_BLOCKED');
  assert.equal(sent[0].title, 'Blocked: Launch');
  assert.match(sent[0].message, /Waiting on DNS/);
  assert.deepEqual(sent[0].data, { taskId: 't1', projectId: 'p1' });

  const source = readFileSync(new URL('../../subscribers/notification.subscriber.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@ashbi\.ca/);
});
