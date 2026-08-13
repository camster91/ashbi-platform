import crypto from 'crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import slackEventRoutes from '../../routes/slack-events.routes.js';

const signingSecret = 'test-signing-secret';

function signedPayload(payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  return { rawBody, timestamp, signature };
}

async function buildApp(prisma = {}) {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body;
    done(null, JSON.parse(body));
  });
  app.decorate('prisma', prisma);
  await app.register(slackEventRoutes, { signingSecret });
  return app;
}

test('returns Slack URL verification challenges only after signature verification', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());
  const signed = signedPayload({ type: 'url_verification', challenge: 'challenge-value' });

  const response = await app.inject({
    method: 'POST', url: '/', payload: signed.rawBody,
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': signed.timestamp, 'x-slack-signature': signed.signature },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { challenge: 'challenge-value' });
});

test('records a mapped Slack event exactly once', async (t) => {
  let receiptData;
  const app = await buildApp({
    slackInstallation: { findFirst: async () => ({ id: 'installation-1', organizationId: 'org-1' }) },
    slackChannelMapping: { findFirst: async () => ({ id: 'mapping-1', projectId: 'project-1' }) },
    slackEventReceipt: { create: async ({ data }) => { receiptData = data; return { id: 'receipt-1', ...data }; } },
  });
  t.after(() => app.close());
  const signed = signedPayload({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1', event: { type: 'message', channel: 'C1' } });

  const response = await app.inject({
    method: 'POST', url: '/', payload: signed.rawBody,
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': signed.timestamp, 'x-slack-signature': signed.signature },
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { ok: true, accepted: true });
  assert.deepEqual(receiptData, { organizationId: 'org-1', installationId: 'installation-1', eventId: 'Ev1', eventType: 'message', channelId: 'C1', status: 'RECEIVED' });
});

test('acknowledges an already-recorded Slack event without duplicating it', async (t) => {
  const app = await buildApp({
    slackInstallation: { findFirst: async () => ({ id: 'installation-1', organizationId: 'org-1' }) },
    slackChannelMapping: { findFirst: async () => ({ id: 'mapping-1', projectId: 'project-1' }) },
    slackEventReceipt: { create: async () => { const error = new Error('unique'); error.code = 'P2002'; throw error; } },
  });
  t.after(() => app.close());
  const signed = signedPayload({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1', event: { type: 'message', channel: 'C1' } });

  const response = await app.inject({
    method: 'POST', url: '/', payload: signed.rawBody,
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': signed.timestamp, 'x-slack-signature': signed.signature },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, duplicate: true });
});
