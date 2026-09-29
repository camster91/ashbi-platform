import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import chatRoutes from '../../routes/chat.routes.js';

// C3: clients must only ever see the client-visible part of project chat.
// Internal team chat (including Slack imports) stays staff-only over both the
// portal API and realtime sockets.

const PROJECT = 'project-a';

function recordingIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return { emit: (event, payload) => emitted.push({ room, event, payload }) };
    },
  };
}

/** A tiny in-memory chatMessage delegate that honours the filters used. */
function chatStore(rows) {
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((clause) => matches(row, clause));
    if ((key === 'createdAt' || key === 'id') && value && typeof value === 'object' && !('in' in value)) {
      const current = key === 'createdAt' ? row.createdAt.getTime() : row.id;
      const bound = (edge) => (key === 'createdAt' ? edge.getTime() : edge);
      if (value.lt !== undefined && !(current < bound(value.lt))) return false;
      if (value.gt !== undefined && !(current > bound(value.gt))) return false;
      return true;
    }
    if (key === 'createdAt') return row.createdAt.getTime() === value.getTime();
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return (row[key] ?? null) === value;
  });
  return {
    rows,
    findMany: async ({ where, orderBy, take }) => {
      let result = rows.filter((row) => matches(row, where));
      const order = Array.isArray(orderBy) ? orderBy : [orderBy ?? { createdAt: 'asc' }];
      result = result.sort((a, b) => {
        for (const clause of order) {
          const [key, direction] = Object.entries(clause)[0];
          const x = key === 'createdAt' ? a.createdAt.getTime() : a[key];
          const y = key === 'createdAt' ? b.createdAt.getTime() : b[key];
          if (x !== y) return (x < y ? -1 : 1) * (direction === 'asc' ? 1 : -1);
        }
        return 0;
      });
      if (take) result = result.slice(0, take);
      return result.map((row) => ({ ...row, author: { id: row.authorId, name: 'Someone', email: 'someone@example.com' } }));
    },
    count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
    create: async ({ data }) => {
      const row = { id: `msg-${rows.length + 1}`, createdAt: new Date(), metadata: null, visibility: 'INTERNAL', parentId: null, ...data };
      rows.push(row);
      return { ...row, author: { id: data.authorId, name: 'Portal User', email: 'client@example.com' } };
    },
  };
}

describe('client portal chat only exposes client-visible messages', () => {
  let app;
  let io;
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1,
  };
  const contact = { id: 'contact-a', email: user.email, name: user.name, clientId: 'client-a' };
  const client = { id: 'client-a', organizationId: 'org-a', name: 'Example Client' };
  const base = Date.parse('2026-09-01T00:00:00Z');
  const rows = [
    { id: 'internal-1', projectId: PROJECT, content: 'Client is slow to pay, chase them', visibility: 'INTERNAL', authorId: 'staff', createdAt: new Date(base + 1000) },
    { id: 'slack-1', projectId: PROJECT, content: 'Imported from Slack #internal', visibility: 'INTERNAL', externalSource: 'SLACK', authorId: null, createdAt: new Date(base + 2000) },
    // A staff aside replying inside the client conversation stays internal.
    { id: 'aside-1', projectId: PROJECT, parentId: 'client-0', content: 'Internal aside: chase them', visibility: 'INTERNAL', authorId: 'staff', createdAt: new Date(base + 3000) },
    ...Array.from({ length: 60 }, (_, i) => ({
      id: `client-${i}`, projectId: PROJECT, content: `Client-visible ${i}`, visibility: 'CLIENT', authorId: 'portal-user', createdAt: new Date(base + 10_000 + i * 1000),
    })),
  ];
  const chatMessage = chatStore(rows);

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'portal-chat-test-secret', cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: {
        findUnique: async ({ where }) => (where.id === user.id ? user : null),
        findFirst: async ({ where }) => (where.email === user.email ? user : null),
      },
      contact: {
        findFirst: async ({ where }) => (where.id === contact.id ? contact : null),
        findUnique: async ({ where }) => (where.id === contact.id ? contact : null),
      },
      client: { findFirst: async ({ where }) => (where.id === client.id ? client : null) },
      project: {
        findFirst: async ({ where }) => (where.id === PROJECT && where.clientId === client.id ? { id: PROJECT } : null),
        findMany: async () => [{ id: PROJECT }],
      },
      chatMessage,
      task: { count: async () => 0 },
    };
    io = recordingIo();
    app.decorate('prisma', prisma);
    app.decorate('io', io);
    app.addHook('preHandler', async (request) => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });

  after(async () => app.close());

  const auth = () => ({ authorization: `Bearer ${app.jwt.sign({ ...user, contactId: contact.id, typ: 'client_session' }, { expiresIn: '1h' })}` });

  it('never returns internal or Slack-imported messages to the client', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/client-portal/projects/${PROJECT}/messages`, headers: auth() });
    assert.equal(response.statusCode, 200, response.body);
    const messages = response.json();
    assert.ok(messages.length > 0);
    assert.ok(messages.every((message) => message.visibility === 'CLIENT'), 'only CLIENT messages');
    assert.ok(!messages.some((message) => /chase them|Slack/.test(message.content)));
    for (const message of messages) {
      assert.equal(message.author?.email, undefined, 'staff emails are not exposed');
      assert.equal('metadata' in message, false);
    }
  });

  it('returns the newest 50 messages in chronological order (M3)', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/client-portal/projects/${PROJECT}/messages`, headers: auth() });
    const ids = response.json().map((message) => message.id);
    assert.equal(ids.length, 50);
    assert.equal(ids[0], 'client-10');
    assert.equal(ids.at(-1), 'client-59');
  });

  it('pages through messages that share a timestamp with the (createdAt, id) cursor', async () => {
    const tiedAt = new Date('2031-01-01T00:00:00.000Z');
    for (const n of [1, 2, 3]) {
      chatMessage.rows.push({ id: `tie-${n}`, projectId: PROJECT, authorId: 'portal-user', content: `tie ${n}`, visibility: 'CLIENT', removedAt: null, parentId: null, metadata: null, createdAt: tiedAt });
    }
    try {
      const first = (await app.inject({ method: 'GET', url: `/api/client-portal/projects/${PROJECT}/messages?limit=2`, headers: auth() })).json();
      assert.deepEqual(first.map((message) => message.id), ['tie-2', 'tie-3']);
      const cursor = first[0];
      const url = `/api/client-portal/projects/${PROJECT}/messages?limit=2&before=${encodeURIComponent(tiedAt.toISOString())}&beforeId=${cursor.id}`;
      const next = (await app.inject({ method: 'GET', url, headers: auth() })).json();
      assert.equal(next.at(-1).id, 'tie-1', 'the tied message left over from the first page is not skipped');
    } finally {
      chatMessage.rows.splice(chatMessage.rows.findIndex((row) => row.id === 'tie-1'), 3);
    }
  });

  it('validates and caps the page size (M6)', async () => {
    const bad = await app.inject({ method: 'GET', url: `/api/client-portal/projects/${PROJECT}/messages?limit=abc`, headers: auth() });
    assert.equal(bad.statusCode, 400);
    const huge = await app.inject({ method: 'GET', url: `/api/client-portal/projects/${PROJECT}/messages?limit=100000`, headers: auth() });
    assert.equal(huge.statusCode, 200);
    assert.equal(huge.json().length, 60, 'capped at 100, and only CLIENT rows exist beyond the cap');
  });

  it('stores client posts as CLIENT and broadcasts them to both project rooms only', async () => {
    io.emitted.length = 0;
    const response = await app.inject({
      method: 'POST', url: `/api/client-portal/projects/${PROJECT}/messages`, headers: auth(), payload: { content: 'Hello team' },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(rows.at(-1).visibility, 'CLIENT');
    const rooms = io.emitted.filter((entry) => entry.event === 'chat:message').map((entry) => entry.room).sort();
    assert.deepEqual(rooms, [`project:${PROJECT}`, `project:${PROJECT}:client`]);
    const clientEmit = io.emitted.find((entry) => entry.room === `project:${PROJECT}:client`);
    assert.equal(clientEmit.payload.author.email, undefined);
  });

  it('counts only client-visible messages as recent portal messages', async () => {
    const counted = [];
    const originalCount = chatMessage.count;
    chatMessage.count = async (args) => { counted.push(args.where); return originalCount(args); };
    try {
      await app.inject({ method: 'GET', url: '/api/client-portal/unread-count', headers: auth() });
    } finally {
      chatMessage.count = originalCount;
    }
    assert.ok(counted.length > 0, 'dashboard counts messages');
    assert.ok(counted.every((where) => where.visibility === 'CLIENT'));
  });
});

describe('staff chat visibility and realtime rooms', () => {
  function staffApp({ rows = [], io = recordingIo() } = {}) {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { id: 'c123456789012345678901234', name: 'Avery', organizationId: 'org-a', role: 'TEAM' };
    });
    app.decorate('notify', async () => {});
    app.decorate('io', io);
    const store = chatStore(rows);
    const prisma = {
      project: { findFirst: async () => ({ id: PROJECT }) },
      chatMessage: {
        ...store,
        findFirst: async ({ where }) => rows.find((row) => row.id === where.id && row.projectId === where.projectId) ?? null,
        count: store.count,
        create: async ({ data }) => {
          const row = { id: `msg-${rows.length + 1}`, createdAt: new Date(), metadata: null, parentId: null, ...data };
          rows.push(row);
          return { ...row, author: { id: data.authorId, name: 'Avery', email: 'avery@example.com' }, reactions: [], replies: [] };
        },
      },
      activity: { create: async () => ({}) },
      user: { findMany: async () => [] },
      notification: { create: async () => ({}) },
    };
    app.decorate('prisma', prisma);
    app.addHook('onRequest', async (request) => { request.prisma = prisma; });
    return { app, io, rows, prisma };
  }

  it('defaults staff messages to INTERNAL and never emits them to the client room', async () => {
    const { app, io, rows } = staffApp();
    await app.register(chatRoutes, { prefix: '/api' });
    try {
      const response = await app.inject({ method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'Internal note' } });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(rows[0].visibility, 'INTERNAL');
      assert.deepEqual(io.emitted.map((entry) => entry.room), [`project:${PROJECT}`]);
    } finally {
      await app.close();
    }
  });

  it('delivers a staff reply marked "to client" to the client room', async () => {
    const { app, io, rows } = staffApp();
    await app.register(chatRoutes, { prefix: '/api' });
    try {
      const response = await app.inject({
        method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'Hi Dana', visibility: 'CLIENT' },
      });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(rows[0].visibility, 'CLIENT');
      assert.deepEqual(io.emitted.map((entry) => entry.room).sort(), [`project:${PROJECT}`, `project:${PROJECT}:client`]);
      const clientPayload = io.emitted.find((entry) => entry.room.endsWith(':client')).payload;
      assert.equal(clientPayload.author.email, undefined);
      assert.equal('metadata' in clientPayload, false);
    } finally {
      await app.close();
    }
  });

  it('a reply under a CLIENT parent keeps the requested visibility and is never promoted', async () => {
    const parentId = 'c123456789012345678901298';
    const { app, io, rows } = staffApp({
      rows: [{ id: parentId, projectId: PROJECT, content: 'client root', visibility: 'CLIENT', createdAt: new Date() }],
    });
    await app.register(chatRoutes, { prefix: '/api' });
    try {
      const aside = await app.inject({
        method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'staff aside', parentId },
      });
      assert.equal(aside.statusCode, 201, aside.body);
      assert.equal(rows.at(-1).visibility, 'INTERNAL', 'default INTERNAL is kept under a CLIENT parent');
      assert.deepEqual(io.emitted.map((entry) => entry.room), [`project:${PROJECT}`], 'the aside never reaches the client room');

      const answer = await app.inject({
        method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'answer', parentId, visibility: 'CLIENT' },
      });
      assert.equal(answer.statusCode, 201, answer.body);
      assert.equal(rows.at(-1).visibility, 'CLIENT');
    } finally {
      await app.close();
    }
  });

  it('a reply under an INTERNAL parent is always INTERNAL', async () => {
    const parentId = 'c123456789012345678901299';
    const { app, rows } = staffApp({
      rows: [{ id: parentId, projectId: PROJECT, content: 'internal root', visibility: 'INTERNAL', createdAt: new Date() }],
    });
    await app.register(chatRoutes, { prefix: '/api' });
    try {
      const response = await app.inject({
        method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'reply', parentId, visibility: 'CLIENT' },
      });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(rows.at(-1).visibility, 'INTERNAL');
    } finally {
      await app.close();
    }
  });

  it('rejects an unknown visibility', async () => {
    const { app } = staffApp();
    await app.register(chatRoutes, { prefix: '/api' });
    try {
      const response = await app.inject({
        method: 'POST', url: `/api/projects/${PROJECT}/messages`, payload: { content: 'x', visibility: 'PUBLIC' },
      });
      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});
