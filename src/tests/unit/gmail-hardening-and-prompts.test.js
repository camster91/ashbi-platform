// Review follow-ups: Gmail fails closed and cannot be used to inject email
// headers; paste output is coerced and saved atomically; AI prompts use the
// signed-in person and their workspace instead of one agency's names.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { default: env } = await import('../../config/env.js');
const { gmailSendSchema } = await import('../../validators/schemas.js');
const {
  default: gmailRoutes, buildMimeMessage, encodeSubject, headerValue, gmailNotConnectedMessage,
} = await import('../../routes/gmail.routes.js');
const { default: messageRoutes, pastePriority, pasteSender, pasteIntent } = await import('../../routes/message.routes.js');
const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const { default: aiClient } = await import('../../ai/client.js');

const USER = { id: 'u1', name: 'Pat Lee', email: 'pat@studio.test', organizationId: 'org-owner', role: 'TEAM' };

function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  Object.assign(env, values);
  t.after(() => Object.assign(env, saved));
}

function headersOf(raw) {
  return raw.split('\r\n\r\n')[0].split('\r\n');
}

// ---------------------------------------------------------------- fail closed

async function gmailApp({ user = USER, prisma = {} } = {}) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { ...user }; });
  app.decorate('adminOnly', async () => {});
  app.addHook('preHandler', async (request) => {
    request.prisma = {
      organization: { findUnique: async () => ({ name: 'Northwind Studio' }) },
      thread: { findFirst: async () => ({ id: 'thr-1' }), update: async () => ({}) },
      message: { create: async () => ({}) },
      ...prisma,
    };
  });
  await app.register(gmailRoutes);
  return app;
}

test('with no owning workspace configured, Gmail is off for everyone, even with tokens', async (t) => {
  withEnv(t, {
    gmailSyncOrganizationId: undefined,
    gmailTokensJson: JSON.stringify({ access_token: 'token', refresh_token: 'r', created_at: Math.floor(Date.now() / 1000), expires_in: 3600 }),
  });
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not reach Gmail'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await gmailApp();
  t.after(() => app.close());

  const status = await app.inject({ method: 'GET', url: '/status' });
  assert.equal(status.json().connected, false);
  assert.equal(status.json().reason, 'not_configured');
  assert.equal(status.json().email, undefined, 'the mailbox address is not revealed');
  assert.match(status.json().error, /isn't set up on this deployment/);
  assert.match(status.json().error, /GMAIL_SYNC_ORGANIZATION_ID/);

  const send = await app.inject({ method: 'POST', url: '/send', payload: { to: 'olivia@northwind.test', subject: 'Hi', body: 'Hello' } });
  assert.equal(send.statusCode, 409, send.body);
  assert.equal(send.json().code, 'GMAIL_NOT_CONNECTED');
  assert.equal(send.json().reason, 'not_configured');
  assert.equal(fetches, 0);
});

test('each "not connected" reason has its own plain explanation', () => {
  assert.match(gmailNotConnectedMessage('other_organization'), /belongs to another workspace/);
  assert.match(gmailNotConnectedMessage('no_tokens'), /connect the Gmail mailbox/);
  for (const reason of ['not_configured', 'other_organization', 'no_tokens']) {
    assert.match(gmailNotConnectedMessage(reason), /copy your reply/i);
  }
});

// ---------------------------------------------------------------- header injection

test('the send schema refuses line breaks in header fields', () => {
  const base = { to: 'olivia@northwind.test', subject: 'Re: launch', body: 'Line one\r\nLine two is fine in the body' };
  assert.equal(gmailSendSchema.safeParse(base).success, true);
  for (const [field, value] of [
    ['subject', 'Hi\r\nBcc: attacker@evil.test'],
    ['subject', 'Hi\nContent-Type: text/html'],
    ['in_reply_to', '<a@b>\r\nFrom: ceo@victim.test'],
    ['references', '<a@b>\nBcc: attacker@evil.test'],
    ['threadId', 'abc\r\nBcc: x'],
  ]) {
    assert.equal(gmailSendSchema.safeParse({ ...base, [field]: value }).success, false, `${field} accepted a line break`);
  }
});

test('the MIME builder keeps every header on one line, so an injected header cannot appear', () => {
  const raw = buildMimeMessage({
    from: 'studio@gmail.test\r\nBcc: attacker@evil.test',
    to: 'olivia@northwind.test\nBcc: attacker@evil.test',
    subject: 'Hello\r\nBcc: attacker@evil.test\r\nContent-Type: text/html',
    body: 'Body\r\n\r\nBcc: not-a-header@evil.test',
    inReplyTo: '<id@mail>\r\nFrom: ceo@victim.test',
    references: '<id@mail>\nX-Injected: yes',
  });
  const headers = headersOf(raw);
  const names = headers.map((line) => line.split(':')[0].toLowerCase());
  assert.equal(names.filter((name) => name === 'from').length, 1, 'exactly one From');
  assert.equal(names.includes('bcc'), false);
  assert.equal(names.includes('x-injected'), false);
  assert.equal(names.filter((name) => name === 'content-type').length, 1);
  assert.ok(headers.includes('Content-Type: text/plain; charset=utf-8'));
  assert.ok(headers[0].startsWith('From: studio@gmail.test'));
  // The body is base64, so nothing in it can be read as a header either.
  const body = Buffer.from(raw.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.equal(body, 'Body\r\n\r\nBcc: not-a-header@evil.test');
});

test('non-ASCII subjects are RFC 2047 encoded and ASCII ones are left alone', () => {
  assert.equal(encodeSubject('Re: launch'), 'Re: launch');
  const encoded = encodeSubject('Re: café ☕');
  assert.match(encoded, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8'), 'Re: café ☕');
  assert.equal(headerValue('a\r\nb'), 'a b');
});

test('a send goes out from the connected mailbox, with one From, and is recorded under that address', async (t) => {
  withEnv(t, {
    gmailSyncOrganizationId: 'org-owner',
    gmailTokensJson: JSON.stringify({ access_token: 'token', refresh_token: 'r', created_at: Math.floor(Date.now() / 1000), expires_in: 3600 }),
  });
  const originalFetch = globalThis.fetch;
  let sentRaw = '';
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/profile')) return new Response(JSON.stringify({ emailAddress: 'studio@gmail.test' }), { status: 200 });
    if (String(url).endsWith('/messages/send')) {
      const payload = JSON.parse(init.body);
      sentRaw = Buffer.from(payload.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      assert.equal('threadId' in payload, false, 'no Gmail thread for a hub-only conversation');
      return new Response(JSON.stringify({ id: 'gm-1', threadId: 'gt-1' }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const recorded = [];
  const app = await gmailApp({ prisma: { message: { create: async ({ data }) => { recorded.push(data); return data; } } } });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/send',
    payload: { to: 'olivia@northwind.test', subject: 'Re: café', body: 'Friday works.', threadId: null, in_reply_to: null, hubThreadId: 'thr-1' },
  });
  assert.equal(response.statusCode, 200, response.body);
  const headers = headersOf(sentRaw);
  assert.deepEqual(headers.filter((line) => /^from:/i.test(line)), ['From: studio@gmail.test']);
  assert.ok(headers.some((line) => line.startsWith('Subject: =?UTF-8?B?')));
  assert.equal(recorded[0].senderEmail, 'studio@gmail.test');
  assert.equal(recorded[0].senderName, 'Pat Lee');
});

// ---------------------------------------------------------------- paste

test('AI output is coerced to values the app knows', () => {
  assert.equal(pastePriority('high'), 'HIGH');
  assert.equal(pastePriority('URGENT!!'), 'NORMAL');
  assert.equal(pastePriority(undefined), 'NORMAL');
  assert.equal(pasteIntent('question'), 'question');
  assert.equal(pasteIntent('<script>'), null);
  assert.deepEqual(pasteSender({ email: 'Olivia@Northwind.test', name: 'Olivia Chen' }, 'slack'), { senderEmail: 'olivia@northwind.test', senderName: 'Olivia Chen' });
  assert.deepEqual(pasteSender({ email: 'not an email', name: 'null' }, 'slack'), { senderEmail: 'slack@paste.agencyhub', senderName: 'slack paste' });
  assert.deepEqual(pasteSender({ email: 'a@b.co\r\nBcc: x@y.z', name: 'x'.repeat(500) }, 'email'), { senderEmail: 'email@paste.agencyhub', senderName: 'email paste' });
});

function pasteApp(prisma) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { ...USER }; });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  return app.register(messageRoutes).then(() => app);
}

function transactionalPrisma({ failOnTask = false } = {}) {
  const saved = { threads: [], tasks: [] };
  const prisma = {
    saved,
    project: { findUnique: async () => ({ clientId: 'client-1' }) },
    $transaction: async (callback) => {
      const pending = { threads: [], tasks: [] };
      const tx = {
        thread: { create: async ({ data }) => { pending.threads.push(data); return { id: 'thr-1', ...data }; } },
        task: {
          create: async ({ data }) => {
            if (failOnTask && pending.tasks.length === 1) throw new Error('task insert failed');
            pending.tasks.push(data);
            return { id: `task-${pending.tasks.length}`, ...data };
          },
        },
      };
      const result = await callback(tx);
      saved.threads.push(...pending.threads);
      saved.tasks.push(...pending.tasks);
      return result;
    },
  };
  return prisma;
}

test('paste saves the thread, message and tasks together, with coerced values', async (t) => {
  const original = aiClient.chatJSON;
  aiClient.chatJSON = async () => ({
    summary: 'Launch questions',
    sender: { name: 'Olivia', email: 'not-an-email' },
    actionItems: [{ task: 'Confirm date', priority: 'super-urgent' }, { task: 'Fix logo', priority: 'high' }],
    suggestedIntent: 'drop table',
  });
  t.after(() => { aiClient.chatJSON = original; });
  const prisma = transactionalPrisma();
  const app = await pasteApp(prisma);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content: 'Two things', source: 'slack', projectId: 'proj-1' } });
  assert.equal(response.statusCode, 201, response.body);
  const [thread] = prisma.saved.threads;
  assert.equal(thread.priority, 'NORMAL');
  assert.equal(thread.intent, null);
  assert.equal(thread.messages.create.senderEmail, 'slack@paste.agencyhub');
  assert.deepEqual(prisma.saved.tasks.map((task) => task.priority), ['NORMAL', 'HIGH']);
  assert.deepEqual(prisma.saved.tasks.map((task) => task.category), ['THIS_WEEK', 'IMMEDIATE']);
});

test('a task failure leaves no half-saved paste behind', async (t) => {
  const original = aiClient.chatJSON;
  aiClient.chatJSON = async () => ({ summary: 'S', actionItems: [{ task: 'One' }, { task: 'Two' }] });
  t.after(() => { aiClient.chatJSON = original; });
  const prisma = transactionalPrisma({ failOnTask: true });
  const app = await pasteApp(prisma);
  app.setErrorHandler((_error, _request, reply) => reply.status(500).send({ error: 'Internal error' }));
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content: 'Two things', projectId: 'proj-1' } });
  assert.equal(response.statusCode, 500);
  assert.equal(prisma.saved.threads.length, 0);
  assert.equal(prisma.saved.tasks.length, 0);
});

// ---------------------------------------------------------------- prompts

function promptCapture() {
  const seen = [];
  const provider = {
    isConfigured: () => true,
    chat: async (options) => { seen.push(options); return 'ok'; },
    chatJSON: async (options) => { seen.push(options); return { subject: 's', body: 'b', urgency: 'friendly reminder', tone: 'friendly' }; },
  };
  return { seen, platformProvider: () => provider };
}

const NAMES = /Cameron|Bianca|Ashbi Design/;

test('the paste, draft-update, chat and invoice chaser prompts name the person and workspace, not one agency', async (t) => {
  const { seen, platformProvider } = promptCapture();
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider }));
  const { default: aiRoutes } = await import('../../routes/ai.routes.js');
  const { default: invoiceChaserRoutes } = await import('../../routes/invoice-chaser.routes.js');
  const empty = { findMany: async () => [] };
  const prisma = {
    organization: { findUnique: async () => ({ name: 'Northwind Studio' }) },
    project: {
      findUnique: async () => ({ id: 'proj-1', clientId: 'client-1', name: 'Rebrand', status: 'ACTIVE', health: 'ON_TRACK', client: { name: 'Contoso' }, tasks: [], revisionRounds: [] }),
      findMany: async () => [],
    },
    thread: empty,
    task: empty,
    retainerPlan: empty,
    invoice: {
      findMany: async () => [{
        id: 'inv-1', invoiceNumber: 'INV-001', status: 'OVERDUE', total: 500, dueDate: new Date(Date.now() - 20 * 86400000),
        client: { name: 'Contoso', contacts: [{ name: 'Ada', email: 'ada@contoso.test' }] }, lineItems: [{ description: 'Logo' }], payments: [],
      }],
    },
    $transaction: async (callback) => callback({ thread: { create: async ({ data }) => data }, task: { create: async ({ data }) => data } }),
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { ...USER, role: 'ADMIN' }; });
  app.decorate('adminOnly', async (request) => { request.user = { ...USER, role: 'ADMIN' }; });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(messageRoutes, { prefix: '/messages' });
  await app.register(invoiceChaserRoutes, { prefix: '/invoice-chaser' });
  t.after(() => app.close());

  for (const [url, payload] of [
    ['/ai/draft-update', { projectId: 'proj-1', rawNotes: 'Round two done.' }],
    ['/ai/chat', { message: 'What is overdue?' }],
    ['/messages/paste', { content: 'Hello', projectId: 'proj-1' }],
    ['/invoice-chaser/chase', {}],
  ]) {
    const before = seen.length;
    const response = await app.inject({ method: 'POST', url, payload });
    assert.ok(response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
    assert.equal(seen.length, before + 1, `${url} made one AI call`);
    const { system = '', prompt = '' } = seen.at(-1);
    assert.doesNotMatch(`${system}\n${prompt}`, NAMES, url);
    assert.doesNotMatch(`${system}\n${prompt}`, /\bcameron\b/i, url);
    if (url !== '/messages/paste') assert.match(`${system}\n${prompt}`, /Northwind Studio/, url);
  }
  const chaser = seen.at(-1);
  assert.match(chaser.prompt, /Sign off as Pat Lee, Northwind Studio\./);
});
