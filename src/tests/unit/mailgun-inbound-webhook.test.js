import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { after, afterEach, before, beforeEach, describe, it, test } from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import env from '../../config/env.js';
import mailgunRoutes, { allowUnsignedInbound } from '../../routes/mailgun.routes.js';
import mailgunHitlRoutes from '../../routes/mailgun-hitl.routes.js';
import {
  mailgunSenderAuthentication,
  parseEmailAddress,
  parseUrlEncodedFields,
} from '../../services/mailgun-webhook-request.js';
import { hitlApproverEmail, resolveHitlApprover, sendApprovalHITLEmail } from '../../utils/hitl-email.service.js';

// Mailgun inbound routes post form fields (urlencoded, or multipart when the
// message has attachments). The app only had a JSON parser and multipart
// without attachFieldsToBody, so inbound client email and HITL replies were
// refused (415) or reached the handler with no body and were dropped behind a
// 200. These tests drive the real route plugins with Mailgun-shaped posts.

const KEY = 'test-inbound-signing-key';
const MB = 1024 * 1024;

function signed({ ageSeconds = 0, token = crypto.randomUUID(), key = KEY } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
  return { timestamp, token, signature };
}

const entriesOf = fields => (Array.isArray(fields) ? fields : Object.entries(fields));

function urlencoded(fields) {
  return {
    payload: new URLSearchParams(entriesOf(fields)).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

function multipartForm(fields, attachment) {
  const form = new FormData();
  for (const [name, value] of entriesOf(fields)) form.append(name, value);
  if (attachment) form.append('attachment-1', Buffer.from(attachment), { filename: 'brief.pdf', contentType: 'application/pdf' });
  return { payload: form.getBuffer(), headers: form.getHeaders() };
}

/** Mailgun's message-headers JSON with its SPF/DKIM verdicts. */
function mailgunHeaders({ from, spf = 'Pass', dkim = 'Pass', dkimDomains = ['agency.example'], extra = [] } = {}) {
  const headers = [];
  if (from) headers.push(['From', from]);
  if (spf) headers.push(['X-Mailgun-Spf', spf]);
  if (dkim) headers.push(['X-Mailgun-Dkim-Check-Result', dkim]);
  for (const d of dkimDomains) headers.push(['DKIM-Signature', `v=1; a=rsa-sha256; d=${d}; s=sel; b=abc`]);
  return JSON.stringify([...headers, ...extra]);
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
    failNotificationUpdates: 0,
    transactions: 0,
  };
  const matchesUser = (user, where = {}) => {
    if (where.organizationId !== undefined && user.organizationId !== where.organizationId) return false;
    if (where.isActive !== undefined && user.isActive !== where.isActive) return false;
    if (where.OR && !where.OR.some(clause => matchesUser(user, clause))) return false;
    if (where.id !== undefined && user.id !== where.id) return false;
    if (typeof where.role === 'string' && user.role !== where.role) return false;
    if (where.role?.in && !where.role.in.includes(user.role)) return false;
    if (where.email?.equals !== undefined) {
      const insensitive = where.email.mode === 'insensitive';
      const a = insensitive ? user.email.toLowerCase() : user.email;
      const b = insensitive ? where.email.equals.toLowerCase() : where.email.equals;
      if (a !== b) return false;
    }
    return true;
  };
  const client = {
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
      findFirst: async ({ where }) => [...state.users.values()].find(u => matchesUser(u, where)) || null,
      findMany: async ({ where }) => [...state.users.values()].filter(u => matchesUser(u, where)),
    },
    notification: {
      findUnique: async ({ where }) => state.notifications.get(where.id) || null,
      update: async ({ where, data }) => {
        if (state.failNotificationUpdates > 0) {
          state.failNotificationUpdates -= 1;
          throw new Error('database hiccup');
        }
        return Object.assign(state.notifications.get(where.id), data);
      },
    },
    approval: {
      findUnique: async ({ where }) => state.approvals.get(where.id) || null,
      updateMany: async ({ where, data }) => {
        const row = state.approvals.get(where.id);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    task: {
      findUnique: async ({ where }) => state.tasks.get(where.id) || null,
      update: async ({ where, data }) => Object.assign(state.tasks.get(where.id), data),
    },
    note: { create: async ({ data }) => { state.notes.push(data); return data; } },
    taskComment: { create: async ({ data }) => { state.comments.push(data); return data; } },
  };
  // Interactive transaction with rollback: restore the written collections
  // when the callback throws.
  client.$transaction = async (fn) => {
    state.transactions += 1;
    const snapshot = {
      notifications: structuredClone(state.notifications),
      approvals: structuredClone(state.approvals),
      tasks: structuredClone(state.tasks),
      notes: structuredClone(state.notes),
      comments: structuredClone(state.comments),
    };
    try {
      return await fn(client);
    } catch (err) {
      Object.assign(state, snapshot);
      throw err;
    }
  };
  return client;
}

const saved = {
  signingKey: env.mailgunSigningKey,
  botOrganizationId: env.botOrganizationId,
  hitlApproverEmail: env.hitlApproverEmail,
  isTest: env.isTest,
  isDevelopment: env.isDevelopment,
  allowUnsigned: env.mailgunAllowUnsignedInbound,
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
  const inject = encoded => app.inject({ method: 'POST', url: '/api/mailgun', ...encoded });

  it('accepts a urlencoded post and hands its fields to the pipeline', async () => {
    const response = await inject(urlencoded({ ...message, ...signed() }));
    assert.equal(response.statusCode, 200);
    assert.equal(processed.calls.length, 1);
    assert.equal(processed.calls[0].subject, 'Homepage feedback');
    assert.equal(processed.calls[0]['body-plain'], 'Looks great & ready = yes');
    assert.equal(processed.calls[0].sender, 'jane@client.example');
  });

  it('accepts a multipart post with an attachment and hands its fields to the pipeline', async () => {
    const response = await inject(multipartForm({ ...message, 'attachment-count': '1', ...signed() }, '%PDF-1.4 test'));
    assert.equal(response.statusCode, 200);
    assert.equal(processed.calls.length, 1);
    assert.equal(processed.calls[0].from, 'Jane Doe <jane@client.example>');
    assert.equal(processed.calls[0]['Message-Id'], '<abc@mail.example>');
    assert.equal(processed.calls[0]['attachment-1'], undefined, 'attachment bytes are not passed as a field');
  });

  it('rejects a stale timestamp with 406 and does not process it', async () => {
    const response = await inject(urlencoded({ ...message, ...signed({ ageSeconds: 16 * 60 }) }));
    assert.equal(response.statusCode, 406);
    assert.equal(processed.calls.length, 0);
  });

  it('rejects a replayed token with 406', async () => {
    const signature = signed();
    assert.equal((await inject(urlencoded({ ...message, ...signature }))).statusCode, 200);
    const replay = await inject(urlencoded({ ...message, ...signature }));
    assert.equal(replay.statusCode, 406);
    assert.equal(processed.calls.length, 1);
  });

  it('rejects a bad signature with 401, and a missing or JSON body with 406', async () => {
    const bad = await inject(urlencoded({ ...message, ...signed({ key: 'attacker' }) }));
    assert.equal(bad.statusCode, 401);
    const empty = await app.inject({ method: 'POST', url: '/api/mailgun' });
    assert.equal(empty.statusCode, 406);
    const json = await app.inject({ method: 'POST', url: '/api/mailgun', payload: { ...message, ...signed() } });
    assert.equal(json.statusCode, 406, 'Mailgun never posts JSON; only the form parsers are trusted');
    assert.equal(processed.calls.length, 0);
  });

  it('answers 500 on a processing failure and accepts the retry of the same token', async () => {
    const signature = signed();
    processed.fail = true;
    assert.equal((await inject(urlencoded({ ...message, ...signature }))).statusCode, 500);
    processed.fail = false;
    assert.equal((await inject(urlencoded({ ...message, ...signature }))).statusCode, 200);
    assert.equal(processed.calls.length, 1);
  });

  it('refuses a security-relevant field posted twice, in either encoding', async () => {
    for (const name of ['from', 'recipient', 'token', 'body-plain', 'X-Mailgun-Spf']) {
      const pairs = [...Object.entries({ ...message, ...signed() }), [name, 'second value']];
      if (name === 'X-Mailgun-Spf') pairs.push([name, 'Pass']);
      assert.equal((await inject(urlencoded(pairs))).statusCode, 406, `urlencoded ${name}`);
      assert.equal((await inject(multipartForm(pairs))).statusCode, 406, `multipart ${name}`);
    }
    // A repeated ordinary header field is fine.
    const pairs = [...Object.entries({ ...message, ...signed() }), ['Received', 'a'], ['Received', 'b']];
    assert.equal((await inject(urlencoded(pairs))).statusCode, 200);
    assert.equal(processed.calls.length, 1);
  });

  it('refuses prototype-named fields the same way in both parsers', async () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const pairs = [...Object.entries({ ...message, ...signed() }), [name, 'polluted']];
      const viaForm = await inject(urlencoded(pairs));
      const viaMultipart = await inject(multipartForm(pairs));
      assert.equal(viaForm.statusCode, 406, `urlencoded ${name}`);
      assert.equal(viaMultipart.statusCode, 406, `multipart ${name}`);
      assert.deepEqual(viaForm.json(), viaMultipart.json());
    }
    assert.equal(processed.calls.length, 0);
    assert.equal({}.polluted, undefined);
    // An ordinary field whose name merely starts like one is accepted.
    const ok = await inject(urlencoded({ ...message, __proto__field: 'kept', ...signed() }));
    assert.equal(ok.statusCode, 200);
    assert.equal(processed.calls[0].__proto__field, 'kept');
  });

  it('caps the total size of form fields before the signature is checked (413)', async () => {
    const big = 'a'.repeat(16 * MB);
    // Each field is under the per-field limit; together they exceed the cap.
    const multi = multipartForm({ ...message, 'body-html': big, 'stripped-html': big, ...signed() });
    // Declared length over the cap: refused before reading.
    assert.equal((await inject(multi)).statusCode, 413);
    // Streamed without a length: refused by the running field total.
    const { 'content-length': _length, ...streamHeaders } = multi.headers;
    const streamed = await inject({ payload: Readable.from([multi.payload]), headers: streamHeaders });
    assert.equal(streamed.statusCode, 413);
    const form = await inject(urlencoded({ ...message, 'body-html': 'a'.repeat(31 * MB), ...signed() }));
    assert.equal(form.statusCode, 413);
    assert.equal(processed.calls.length, 0);
  });

  it('keeps form bodies off the other Mailgun routes', async () => {
    const send = await app.inject({ method: 'POST', url: '/api/mailgun/send', ...urlencoded({ to: 'a@b.test', subject: 's', text: 't' }) });
    assert.equal(send.statusCode, 415);
    const events = await app.inject({ method: 'POST', url: '/api/mailgun/events', ...urlencoded({ x: '1' }) });
    assert.equal(events.statusCode, 415);
  });

  it('fails closed without a signing key unless unsigned posts were explicitly allowed', async () => {
    env.mailgunSigningKey = undefined;
    try {
      env.isTest = false;
      env.isDevelopment = true;
      env.mailgunAllowUnsignedInbound = false;
      assert.equal(allowUnsignedInbound(), false, 'NODE_ENV=development alone is not enough');
      assert.equal((await inject(urlencoded(message))).statusCode, 503);

      env.mailgunAllowUnsignedInbound = true;
      assert.equal(allowUnsignedInbound(), true);
      assert.equal((await inject(urlencoded(message))).statusCode, 200);

      env.isDevelopment = false; // staging / production ignore the opt-in
      assert.equal(allowUnsignedInbound(), false);
      assert.equal((await inject(urlencoded(message))).statusCode, 503);
    } finally {
      env.mailgunSigningKey = KEY;
      env.isTest = saved.isTest;
      env.isDevelopment = saved.isDevelopment;
      env.mailgunAllowUnsignedInbound = saved.allowUnsigned;
    }
    assert.equal(processed.calls.length, 1);
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

  const replyFields = (from, notificationId = 'n-approval', text = 'APPROVED - ship it', headers = {}) => ({
    recipient: `reply+${notificationId}@mg.agency.example`,
    sender: parseEmailAddress(from) || 'bounce@agency.example',
    from,
    'body-plain': `${text}\n\nOn Mon, Hub wrote:\n> Approval needed`,
    'message-headers': mailgunHeaders({ from, ...headers }),
    ...signed(),
  });

  const post = (fields, encode = urlencoded) => app.inject({ method: 'POST', url: '/api/mailgun-hitl/hitl-reply', ...encode(fields) });
  const approvalStatus = () => prisma.state.approvals.get('ap-1').status;

  it('applies an APPROVED reply from the notified user (case-insensitive From)', async () => {
    const response = await post(replyFields('Owner <owner@agency.EXAMPLE>'));
    assert.equal(response.statusCode, 200);
    const approval = prisma.state.approvals.get('ap-1');
    assert.equal(approval.status, 'APPROVED');
    assert.equal(approval.reviewedBy, 'Owner@Agency.example');
    assert.equal(approval.reviewNote, 'ship it');
    assert.equal(prisma.state.notifications.get('n-approval').read, true);
    assert.equal(prisma.state.notes[0].authorId, 'u-owner');
    assert.equal(prisma.state.transactions, 1);
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
    assert.equal(approvalStatus(), 'PENDING');
    assert.equal(prisma.state.notifications.get('n-approval').read, false);
  });

  it('rejects a From header that names more than one mailbox', async () => {
    for (const from of [
      'attacker@evil.example, Admin <admin@agency.example>',
      '<a@evil.example>, <admin@agency.example>',
      'Evil <a@evil.example> <admin@agency.example>',
    ]) {
      const response = await post(replyFields(from, 'n-approval', 'APPROVED', { from: 'admin@agency.example' }));
      assert.equal(response.statusCode, 406, from);
    }
    assert.equal(approvalStatus(), 'PENDING');
  });

  it('requires an SPF or DKIM pass aligned with the From domain', async () => {
    const cases = [
      ['no Mailgun verdicts', { spf: null, dkim: null, dkimDomains: [] }],
      ['SPF and DKIM failed', { spf: 'Fail', dkim: 'Fail' }],
      ['DKIM pass for another domain', { spf: null, dkimDomains: ['evil.example'] }],
      ['DKIM pass with one unaligned signature', { spf: null, dkimDomains: ['agency.example', 'evil.example'] }],
      ['verdict injected by the sender', { spf: null, extra: [['X-Mailgun-Dkim-Check-Result', 'Pass']] }],
      ['second From header', { extra: [['From', 'attacker@evil.example']] }],
    ];
    for (const [label, headers] of cases) {
      const response = await post(replyFields('admin@agency.example', 'n-approval', 'APPROVED', headers));
      assert.equal(response.statusCode, 406, label);
    }
    // SPF pass counts only for an envelope sender aligned with the From domain.
    const unalignedSpf = await post({
      ...replyFields('admin@agency.example', 'n-approval', 'APPROVED', { dkim: null, dkimDomains: [] }),
      sender: 'bounce@evil.example',
    });
    assert.equal(unalignedSpf.statusCode, 406);
    assert.equal(approvalStatus(), 'PENDING');

    const alignedSpf = await post({
      ...replyFields('admin@agency.example', 'n-approval', 'APPROVED', { dkim: null, dkimDomains: [] }),
      sender: 'bounces@mail.agency.example',
    });
    assert.equal(alignedSpf.statusCode, 200);
    assert.equal(approvalStatus(), 'APPROVED');
  });

  it('does not let a later reply flip a decided approval', async () => {
    assert.equal((await post(replyFields('owner@agency.example', 'n-approval', 'APPROVED'))).statusCode, 200);
    const flip = await post(replyFields('admin@agency.example', 'n-approval', 'REJECTED changed my mind'));
    assert.equal(flip.statusCode, 406);
    assert.equal(approvalStatus(), 'APPROVED');
    assert.equal(prisma.state.approvals.get('ap-1').reviewedBy, 'Owner@Agency.example');
    assert.equal(prisma.state.notes.length, 1);
  });

  it('rejects a stale timestamp and a replayed token', async () => {
    const stale = await post({ ...replyFields('owner@agency.example'), ...signed({ ageSeconds: 3600 }) });
    assert.equal(stale.statusCode, 406);
    assert.equal(approvalStatus(), 'PENDING');

    const fields = replyFields('owner@agency.example', 'n-approval', 'REJECTED not yet');
    assert.equal((await post(fields)).statusCode, 200);
    assert.equal(approvalStatus(), 'REJECTED');
    prisma.state.approvals.get('ap-1').status = 'PENDING';
    const replay = await post(fields);
    assert.equal(replay.statusCode, 406);
    assert.equal(approvalStatus(), 'PENDING');
  });

  it('refuses a repeated security-relevant field', async () => {
    const pairs = [...Object.entries(replyFields('owner@agency.example')), ['from', 'attacker@evil.example']];
    assert.equal((await post(pairs)).statusCode, 406);
    assert.equal((await post(pairs, multipartForm)).statusCode, 406);
    assert.equal(approvalStatus(), 'PENDING');
  });

  it('rolls back a failed reply and releases the token, so the retry applies it once', async () => {
    const fields = replyFields('owner@agency.example', 'n-task', 'Use the blue logo');
    prisma.state.failNotificationUpdates = 1; // fails after the task and comment writes
    const failed = await post(fields);
    assert.equal(failed.statusCode, 500);
    assert.equal(prisma.state.comments.length, 0, 'comment rolled back');
    assert.equal(prisma.state.tasks.get('t-1').status, 'WAITING_US', 'task update rolled back');
    assert.equal(prisma.state.receipts.has(fields.token), false, 'token released');

    const retry = await post(fields);
    assert.equal(retry.statusCode, 200);
    assert.equal(prisma.state.comments.length, 1);
    assert.equal(prisma.state.tasks.get('t-1').status, 'IN_PROGRESS');

    const duplicate = await post(fields);
    assert.equal(duplicate.statusCode, 406, 'the committed token stays claimed');
    assert.equal(prisma.state.comments.length, 1);
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
    assert.equal(approvalStatus(), 'PENDING');
  });
});

test('form field parsing keeps the first value and builds a null-prototype map', () => {
  // Prototype names are never stored (the route then refuses the post).
  const fields = parseUrlEncodedFields('a=1&a=2&__proto__=x&constructor=y&b=hello+world%21');
  assert.equal(fields.a, '1');
  assert.equal(fields.b, 'hello world!');
  assert.equal(Object.getPrototypeOf(fields), null);
  assert.equal(Object.prototype.hasOwnProperty.call(fields, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'constructor'), false);
});

test('email address parsing accepts exactly one mailbox', () => {
  assert.equal(parseEmailAddress('Jane Doe <Jane@Example.COM>'), 'jane@example.com');
  assert.equal(parseEmailAddress('"Doe, Jane" <jane@example.com>'), 'jane@example.com');
  assert.equal(parseEmailAddress(' jane@example.com '), 'jane@example.com');
  assert.equal(parseEmailAddress('attacker@evil.com, Admin <admin@corp.com>'), null);
  assert.equal(parseEmailAddress('<a@evil.com>, <admin@corp.com>'), null);
  assert.equal(parseEmailAddress('Evil <a@evil.com> <admin@corp.com>'), null);
  assert.equal(parseEmailAddress('admin@corp.com <a@evil.com>'), 'a@evil.com');
  assert.equal(parseEmailAddress('"unterminated <admin@corp.com>'), null);
  assert.equal(parseEmailAddress('not an address'), null);
  assert.equal(parseEmailAddress(undefined), null);
});

test('sender authentication reads Mailgun verdicts only when each appears once', () => {
  const fields = { 'message-headers': mailgunHeaders({ spf: 'Pass', dkim: null, dkimDomains: [] }), sender: 'x@agency.example' };
  assert.equal(mailgunSenderAuthentication(fields, 'admin@agency.example').ok, true);
  const doubled = { ...fields, 'message-headers': mailgunHeaders({ spf: 'Pass', dkim: null, dkimDomains: [], extra: [['x-mailgun-spf', 'Pass']] }) };
  assert.equal(mailgunSenderAuthentication(doubled, 'admin@agency.example').ok, false);
  assert.equal(mailgunSenderAuthentication({ ...fields, 'message-headers': 'not json' }, 'admin@agency.example').ok, false);
});

test('the HITL approver is resolved from HITL_APPROVER_EMAIL, case-insensitively, staff only', async () => {
  const log = { warn: () => {} };
  const prisma = fakePrisma({
    users: [
      { id: 'u-client', email: 'client@agency.example', role: 'CLIENT', isActive: true, organizationId: 'org-1' },
      { id: 'u-off', email: 'off@agency.example', role: 'ADMIN', isActive: false, organizationId: 'org-1' },
      { id: 'u-ok', email: 'Approver@Agency.example', role: 'TEAM', isActive: true, organizationId: 'org-1' },
    ],
  });
  try {
    env.hitlApproverEmail = null;
    assert.equal(await resolveHitlApprover(prisma, log), null);
    env.hitlApproverEmail = 'approver@agency.EXAMPLE';
    assert.equal((await resolveHitlApprover(prisma, log)).id, 'u-ok');
    env.hitlApproverEmail = 'client@agency.example';
    assert.equal(await resolveHitlApprover(prisma, log), null);
    env.hitlApproverEmail = 'off@agency.example';
    assert.equal(await resolveHitlApprover(prisma, log), null);
  } finally {
    env.hitlApproverEmail = saved.hitlApproverEmail;
  }
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

test('the bot routes no longer look up a hardcoded HITL person', async () => {
  const { readFileSync } = await import('node:fs');
  const bot = readFileSync(new URL('../../routes/bot.routes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bot, /findFirst\(\{ where: \{ email: '[^']+@/);
  assert.equal((bot.match(/resolveHitlApprover\(/g) || []).length, 3);
});
