import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it, test } from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import env from '../../config/env.js';
import mailgunRoutes from '../../routes/mailgun.routes.js';
import mailgunHitlRoutes from '../../routes/mailgun-hitl.routes.js';
import { parseEmailAddress, parseUrlEncodedFields } from '../../services/mailgun-webhook-request.js';
import { hitlApproverEmail, sendApprovalHITLEmail } from '../../utils/hitl-email.service.js';

// Mailgun inbound routes post form fields (urlencoded, or multipart when the
// message has attachments). The app only had a JSON parser and multipart
// without attachFieldsToBody, so inbound client email and HITL replies were
// refused (415) or reached the handler with no body and were dropped behind a
// 200. These tests drive the real route plugins with Mailgun-shaped posts.

const KEY = 'test-inbound-signing-key';

function signed({ ageSeconds = 0, token = crypto.randomUUID(), key = KEY } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
  return { timestamp, token, signature };
}

function urlencoded(fields) {
  return {
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

function multipartForm(fields, attachment) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  if (attachment) form.append('attachment-1', Buffer.from(attachment), { filename: 'brief.pdf', contentType: 'application/pdf' });
  return { payload: form.getBuffer(), headers: form.getHeaders() };
}

function fakePrisma({ users = [], notifications = [], approvals = [], tasks = [] } = {}) {
  const state = {
    receipts: new Map(),
    users: new Map(users.map(u => [u.id, { ...u }])),
    notifications: new Map(notifications.map(n => [n.id, { ...n }])),
    approvals: new Map(approvals.map(a => [a.id, { ...a }])),
    tasks: new Map(tasks.map(t => [t.id, { ...t }])),
    notes: [],
    comments: [],
  };
  const matchesUser = (user, where = {}) => {
    if (where.organizationId !== undefined && user.organizationId !== where.organizationId) return false;
    if (where.isActive !== undefined && user.isActive !== where.isActive) return false;
    if (where.OR && !where.OR.some(clause => matchesUser(user, clause))) return false;
    if (where.id !== undefined && user.id !== where.id) return false;
    if (where.role !== undefined && user.role !== where.role) return false;
    return true;
  };
  return {
    state,
    mailgunWebhookReceipt: {
      create: async ({ data }) => {
        if (state.receipts.has(data.token)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        state.receipts.set(data.token, data);
        return data;
      },
      deleteMany: async ({ where }) => {
        if (where.token) state.receipts.delete(where.token);
        return { count: 0 };
      },
    },
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) || null,
      findMany: async ({ where }) => [...state.users.values()].filter(u => matchesUser(u, where)),
    },
    notification: {
      findUnique: async ({ where }) => state.notifications.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(state.notifications.get(where.id), data),
    },
    approval: {
      findUnique: async ({ where }) => state.approvals.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(state.approvals.get(where.id), data),
    },
    task: {
      findUnique: async ({ where }) => state.tasks.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(state.tasks.get(where.id), data),
    },
    note: { create: async ({ data }) => { state.notes.push(data); return data; } },
    taskComment: { create: async ({ data }) => { state.comments.push(data); return data; } },
  };
}

const saved = {
  signingKey: env.mailgunSigningKey,
  botOrganizationId: env.botOrganizationId,
  hitlApproverEmail: env.hitlApproverEmail,
};

async function buildApp(prisma, processed) {
  const app = Fastify({ logger: false });
  // Same global multipart registration as src/index.js (no attachFieldsToBody).
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', prisma);
  await app.register(mailgunHitlRoutes, { prefix: '/api/mailgun-hitl' });
  await app.register(mailgunRoutes, {
    prefix: '/api/mailgun',
    processInboundEmail: async (_fastify, body) => {
      if (processed.fail) throw new Error('pipeline down');
      processed.calls.push({ ...body });
    },
  });
  await app.ready();
  return app;
}

before(() => {
  env.mailgunSigningKey = KEY;
  env.botOrganizationId = 'org-1';
});

after(() => {
  env.mailgunSigningKey = saved.signingKey;
  env.botOrganizationId = saved.botOrganizationId;
  env.hitlApproverEmail = saved.hitlApproverEmail;
});

describe('POST /api/mailgun (inbound client email)', () => {
  let app;
  let prisma;
  const processed = { calls: [], fail: false };

  before(async () => {
    prisma = fakePrisma();
    app = await buildApp(prisma, processed);
  });
  after(async () => { await app.close(); });
  beforeEach(() => { processed.calls.length = 0; processed.fail = false; });

  const message = {
    sender: 'jane@client.example',
    from: 'Jane Doe <jane@client.example>',
    recipient: 'hub@agency.example',
    subject: 'Homepage feedback',
    'body-plain': 'Looks great & ready = yes',
    'Message-Id': '<abc@mail.example>',
  };

  it('accepts a urlencoded post and hands its fields to the pipeline', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signed() }) });
    assert.equal(response.statusCode, 200);
    assert.equal(processed.calls.length, 1);
    assert.equal(processed.calls[0].subject, 'Homepage feedback');
    assert.equal(processed.calls[0]['body-plain'], 'Looks great & ready = yes');
    assert.equal(processed.calls[0].sender, 'jane@client.example');
  });

  it('accepts a multipart post with an attachment and hands its fields to the pipeline', async () => {
    const form = multipartForm({ ...message, 'attachment-count': '1', ...signed() }, '%PDF-1.4 test');
    const response = await app.inject({ method: 'POST', url: '/api/mailgun', ...form });
    assert.equal(response.statusCode, 200);
    assert.equal(processed.calls.length, 1);
    assert.equal(processed.calls[0].from, 'Jane Doe <jane@client.example>');
    assert.equal(processed.calls[0]['Message-Id'], '<abc@mail.example>');
    assert.equal(processed.calls[0]['attachment-1'], undefined, 'attachment bytes are not passed as a field');
  });

  it('rejects a stale timestamp with 406 and does not process it', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signed({ ageSeconds: 16 * 60 }) }) });
    assert.equal(response.statusCode, 406);
    assert.equal(processed.calls.length, 0);
  });

  it('rejects a replayed token with 406', async () => {
    const signature = signed();
    const first = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signature }) });
    assert.equal(first.statusCode, 200);
    const replay = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signature }) });
    assert.equal(replay.statusCode, 406);
    assert.equal(processed.calls.length, 1);
  });

  it('rejects a bad signature with 401 and a missing body with 4xx', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signed({ key: 'attacker' }) }) });
    assert.equal(bad.statusCode, 401);
    const empty = await app.inject({ method: 'POST', url: '/api/mailgun' });
    assert.ok(empty.statusCode >= 400 && empty.statusCode < 500, `got ${empty.statusCode}`);
    assert.equal(processed.calls.length, 0);
  });

  it('answers 500 on a processing failure and accepts the retry of the same token', async () => {
    const signature = signed();
    processed.fail = true;
    const failed = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signature }) });
    assert.equal(failed.statusCode, 500);
    processed.fail = false;
    const retry = await app.inject({ method: 'POST', url: '/api/mailgun', ...urlencoded({ ...message, ...signature }) });
    assert.equal(retry.statusCode, 200);
    assert.equal(processed.calls.length, 1);
  });

  it('keeps form bodies off the other Mailgun routes', async () => {
    const send = await app.inject({ method: 'POST', url: '/api/mailgun/send', ...urlencoded({ to: 'a@b.test', subject: 's', text: 't' }) });
    assert.equal(send.statusCode, 415);
    const events = await app.inject({ method: 'POST', url: '/api/mailgun/events', ...urlencoded({ x: '1' }) });
    assert.equal(events.statusCode, 415);
  });
});

describe('POST /api/mailgun-hitl/hitl-reply', () => {
  let app;
  let prisma;

  const users = [
    { id: 'u-owner', email: 'Owner@Agency.example', role: 'TEAM', isActive: true, organizationId: 'org-1' },
    { id: 'u-admin', email: 'admin@agency.example', role: 'ADMIN', isActive: true, organizationId: 'org-1' },
    { id: 'u-team', email: 'team@agency.example', role: 'TEAM', isActive: true, organizationId: 'org-1' },
    { id: 'u-other-admin', email: 'boss@other.example', role: 'ADMIN', isActive: true, organizationId: 'org-2' },
    { id: 'u-gone', email: 'gone@agency.example', role: 'ADMIN', isActive: false, organizationId: 'org-1' },
  ];

  beforeEach(async () => {
    prisma = fakePrisma({
      users,
      notifications: [
        { id: 'n-approval', type: 'HITL_REQUIRED', userId: 'u-owner', read: false, data: JSON.stringify({ type: 'APPROVAL', refId: 'ap-1' }) },
        { id: 'n-task', type: 'HITL_REQUIRED', userId: 'u-owner', read: false, data: JSON.stringify({ type: 'TASK', refId: 't-1' }) },
      ],
      approvals: [{ id: 'ap-1', status: 'PENDING', projectId: 'p-1' }],
      tasks: [{ id: 't-1', status: 'WAITING_US' }],
    });
    app = await buildApp(prisma, { calls: [], fail: false });
  });
  afterEach(async () => { await app.close(); });

  const replyFields = (from, notificationId = 'n-approval', text = 'APPROVED - ship it') => ({
    recipient: `reply+${notificationId}@mg.agency.example`,
    sender: parseEmailAddress(from) || from,
    from,
    'body-plain': `${text}\n\nOn Mon, Hub wrote:\n> Approval needed`,
    ...signed(),
  });

  const post = (fields, encode = urlencoded) => app.inject({ method: 'POST', url: '/api/mailgun-hitl/hitl-reply', ...encode(fields) });

  it('applies an APPROVED reply from the notified user (case-insensitive From)', async () => {
    const response = await post(replyFields('Owner <owner@agency.EXAMPLE>'));
    assert.equal(response.statusCode, 200);
    const approval = prisma.state.approvals.get('ap-1');
    assert.equal(approval.status, 'APPROVED');
    assert.equal(approval.reviewedBy, 'Owner@Agency.example');
    assert.equal(approval.reviewNote, 'ship it');
    assert.equal(prisma.state.notifications.get('n-approval').read, true);
    assert.equal(prisma.state.notes[0].authorId, 'u-owner');
  });

  it('applies a multipart reply from an active admin of the same org', async () => {
    const response = await post(replyFields('admin@agency.example', 'n-task', 'Go ahead with option B'), f => multipartForm(f, 'sig.png'));
    assert.equal(response.statusCode, 200);
    assert.equal(prisma.state.tasks.get('t-1').status, 'IN_PROGRESS');
    assert.equal(prisma.state.comments[0].authorId, 'u-admin');
  });

  it('rejects APPROVED from senders who are not authorized for the notification', async () => {
    for (const from of [
      'attacker@evil.example',
      'team@agency.example', // staff, but neither the recipient nor an admin
      'boss@other.example', // admin of another org
      'gone@agency.example', // deactivated admin
      'Owner <owner@agency.example.evil.example>',
    ]) {
      const response = await post(replyFields(from));
      assert.equal(response.statusCode, 406, from);
    }
    // The envelope sender cannot stand in for an unauthorized From header.
    const spoof = await post({ ...replyFields('attacker@evil.example'), sender: 'owner@agency.example' });
    assert.equal(spoof.statusCode, 406);
    assert.equal(prisma.state.approvals.get('ap-1').status, 'PENDING');
    assert.equal(prisma.state.notifications.get('n-approval').read, false);
  });

  it('rejects a stale timestamp and a replayed token', async () => {
    const stale = await post({ ...replyFields('owner@agency.example'), ...signed({ ageSeconds: 3600 }) });
    assert.equal(stale.statusCode, 406);
    assert.equal(prisma.state.approvals.get('ap-1').status, 'PENDING');

    const fields = replyFields('owner@agency.example', 'n-approval', 'REJECTED not yet');
    assert.equal((await post(fields)).statusCode, 200);
    assert.equal(prisma.state.approvals.get('ap-1').status, 'REJECTED');
    prisma.state.approvals.get('ap-1').status = 'PENDING';
    const replay = await post(fields);
    assert.equal(replay.statusCode, 406);
    assert.equal(prisma.state.approvals.get('ap-1').status, 'PENDING');
  });

  it('rejects an invalid signature and fails closed without a signing key', async () => {
    const bad = await post({ ...replyFields('owner@agency.example'), ...signed({ key: 'attacker' }) });
    assert.equal(bad.statusCode, 401);
    env.mailgunSigningKey = undefined;
    try {
      const unconfigured = await post(replyFields('owner@agency.example'));
      assert.equal(unconfigured.statusCode, 503);
    } finally {
      env.mailgunSigningKey = KEY;
    }
    assert.equal(prisma.state.approvals.get('ap-1').status, 'PENDING');
  });
});

test('form field parsing keeps the first value and never sets the prototype', () => {
  const fields = parseUrlEncodedFields('a=1&a=2&__proto__=x&b=hello+world%21');
  assert.equal(fields.a, '1');
  assert.equal(fields.b, 'hello world!');
  assert.equal(Object.getPrototypeOf(fields), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(fields, '__proto__'), false);
});

test('email address parsing extracts and lower-cases the bare address', () => {
  assert.equal(parseEmailAddress('Jane Doe <Jane@Example.COM>'), 'jane@example.com');
  assert.equal(parseEmailAddress(' jane@example.com '), 'jane@example.com');
  assert.equal(parseEmailAddress('not an address'), null);
  assert.equal(parseEmailAddress(undefined), null);
});

test('HITL emails go to HITL_APPROVER_EMAIL and are skipped when it is unset', async () => {
  env.hitlApproverEmail = null;
  assert.equal(hitlApproverEmail(), null);
  const skipped = await sendApprovalHITLEmail({ notificationId: 'n-1', approval: { id: 'ap-1', title: 'T', type: 'EMAIL', content: 'x' } });
  assert.deepEqual(skipped, { ok: false, error: 'HITL_APPROVER_EMAIL not set' });
  env.hitlApproverEmail = 'approver@agency.example';
  assert.equal(hitlApproverEmail(), 'approver@agency.example');
  env.hitlApproverEmail = saved.hitlApproverEmail;
});
