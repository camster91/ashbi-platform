import crypto from 'crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import slackEventRoutes, { isBotAuthoredEvent } from '../../routes/slack-events.routes.js';

const signingSecret = 'test-signing-secret';

async function buildApp(prisma = {}) {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body;
    done(null, JSON.parse(body));
  });
  app.decorate('prisma', { ...prisma, $transaction: async (callback) => callback(prisma) });
  await app.register(slackEventRoutes, { signingSecret });
  return app;
}

function injectSigned(app, payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  return app.inject({
    method: 'POST', url: '/', payload: rawBody,
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
  });
}

for (const [label, event] of [
  ['a bot_id', { bot_id: 'B1', user: 'U9' }],
  ['the bot_message subtype', { subtype: 'bot_message' }],
  ['the installation\'s own bot user', { user: 'UBOT' }],
]) {
  test(`does not import Slack messages authored by ${label}`, async (t) => {
    let writes = 0;
    const app = await buildApp({
      slackInstallation: { findFirst: async () => ({ id: 'installation-1', organizationId: 'org-1', botUserId: 'UBOT' }) },
      slackChannelMapping: { findFirst: async () => ({ id: 'mapping-1', projectId: 'project-1' }) },
      slackEventReceipt: { create: async () => { writes += 1; return {}; } },
      chatMessage: { create: async () => { writes += 1; return {}; } },
    });
    t.after(() => app.close());

    const response = await injectSigned(app, {
      type: 'event_callback', team_id: 'T1', event_id: 'Ev-bot',
      event: { type: 'message', channel: 'C1', text: 'Posted by the Hub', ts: '1710000000.000900', ...event },
    });

    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { ok: true, ignored: true });
    assert.equal(writes, 0);
  });
}

test('still imports ordinary human messages', async (t) => {
  let chatWrites = 0;
  const app = await buildApp({
    slackInstallation: { findFirst: async () => ({ id: 'installation-1', organizationId: 'org-1', botUserId: 'UBOT' }) },
    slackChannelMapping: { findFirst: async () => ({ id: 'mapping-1', projectId: 'project-1' }) },
    slackEventReceipt: { create: async () => ({}) },
    chatMessage: { create: async () => { chatWrites += 1; return { id: 'chat-1' }; } },
  });
  t.after(() => app.close());

  const response = await injectSigned(app, {
    type: 'event_callback', team_id: 'T1', event_id: 'Ev-human',
    event: { type: 'message', channel: 'C1', user: 'U1', text: 'From a person' },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(chatWrites, 1);
  assert.equal(isBotAuthoredEvent({ type: 'message', user: 'U1' }, null), false);
});

test('app_uninstalled disconnects the installation and clears its token idempotently', async (t) => {
  const installation = { teamId: 'T1', status: 'ACTIVE', botTokenEncrypted: 'ciphertext' };
  const wheres = [];
  const app = await buildApp({
    slackInstallation: {
      updateMany: async ({ where, data }) => {
        wheres.push(where);
        if (where.teamId !== installation.teamId || installation.status === where.status.not) return { count: 0 };
        Object.assign(installation, data);
        return { count: 1 };
      },
    },
  });
  t.after(() => app.close());

  const first = await injectSigned(app, { type: 'event_callback', team_id: 'T1', event_id: 'Ev-uninstall', event: { type: 'app_uninstalled' } });
  const second = await injectSigned(app, { type: 'event_callback', team_id: 'T1', event_id: 'Ev-uninstall-2', event: { type: 'app_uninstalled' } });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { ok: true, revoked: true });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { ok: true, revoked: false });
  assert.equal(installation.status, 'DISCONNECTED');
  assert.equal(installation.botTokenEncrypted, null);
  assert.ok(installation.disconnectedAt instanceof Date);
  assert.deepEqual(wheres[0], { teamId: 'T1', status: { not: 'DISCONNECTED' } });
});

test('tokens_revoked naming the installation bot disconnects it', async (t) => {
  let update;
  const app = await buildApp({
    slackInstallation: {
      findFirst: async () => ({ id: 'installation-1', botUserId: 'UBOT' }),
      updateMany: async (args) => { update = args; return { count: 1 }; },
    },
  });
  t.after(() => app.close());

  const response = await injectSigned(app, {
    type: 'event_callback', team_id: 'T1', event_id: 'Ev-revoke',
    event: { type: 'tokens_revoked', tokens: { oauth: [], bot: ['UBOT'] } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(update.data.status, 'DISCONNECTED');
  assert.equal(update.data.botTokenEncrypted, null);
});

test('tokens_revoked for user tokens or a different bot leaves the installation active', async (t) => {
  let updated = false;
  const app = await buildApp({
    slackInstallation: {
      findFirst: async () => ({ id: 'installation-1', botUserId: 'UBOT' }),
      updateMany: async () => { updated = true; return { count: 1 }; },
    },
  });
  t.after(() => app.close());

  const userOnly = await injectSigned(app, {
    type: 'event_callback', team_id: 'T1', event_id: 'Ev-revoke-user',
    event: { type: 'tokens_revoked', tokens: { oauth: ['U1'] } },
  });
  const otherBot = await injectSigned(app, {
    type: 'event_callback', team_id: 'T1', event_id: 'Ev-revoke-other',
    event: { type: 'tokens_revoked', tokens: { bot: ['UOTHER'] } },
  });

  assert.deepEqual(userOnly.json(), { ok: true, ignored: true });
  assert.deepEqual(otherBot.json(), { ok: true, ignored: true });
  assert.equal(updated, false);
});

test('an unsigned app_uninstalled event cannot disconnect an installation', async (t) => {
  let updated = false;
  const app = await buildApp({ slackInstallation: { updateMany: async () => { updated = true; return { count: 1 }; } } });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/',
    payload: JSON.stringify({ type: 'event_callback', team_id: 'T1', event_id: 'Ev-forged', event: { type: 'app_uninstalled' } }),
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)), 'x-slack-signature': 'v0=forged' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(updated, false);
});
