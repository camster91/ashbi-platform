// L1 (security audit at 8687cf9): the inbound email webhook HMAC'd
// JSON.stringify(body) with no timestamp or nonce, so a captured request could
// be replayed forever (and re-serialisation made the signature depend on key
// order). It now signs `${timestamp}.${rawBody}`, bounds the timestamp, and
// accepts each signature once.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

process.env.WEBHOOK_SECRET = 'email-webhook-test-secret';
process.env.BOT_ORGANIZATION_ID = 'org-bot';

const { default: webhookRoutes } = await import('../../routes/webhook.routes.js');
const { signEmailWebhook, verifyEmailWebhook, claimEmailWebhookSignature } = await import('../../webhooks/email-webhook-signature.js');

function receiptStore() {
  const seen = new Set();
  return {
    seen,
    emailWebhookReceipt: {
      create: async ({ data }) => {
        if (seen.has(data.signature)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        seen.add(data.signature);
        return data;
      },
      deleteMany: async ({ where }) => { if (where.signature) seen.delete(where.signature); return { count: 0 }; },
    },
  };
}

test('verification uses the raw body and a bounded timestamp', () => {
  const secret = 's';
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const rawBody = '{"b":2,"a":1}';
  const signature = signEmailWebhook(secret, timestamp, rawBody);
  assert.equal(verifyEmailWebhook({ secret, timestamp, signature, rawBody }, { now }).ok, true);
  // Same JSON, different bytes: not the signed body.
  assert.equal(verifyEmailWebhook({ secret, timestamp, signature, rawBody: '{"a":1,"b":2}' }, { now }).reason, 'invalid');
  assert.equal(verifyEmailWebhook({ secret, timestamp, signature, rawBody }, { now: now + 6 * 60 * 1000 }).reason, 'stale');
  assert.equal(verifyEmailWebhook({ secret, timestamp: undefined, signature, rawBody }, { now }).reason, 'missing');
  // The old contract (HMAC of JSON.stringify(body), no timestamp) is refused.
  const legacy = signEmailWebhook(secret, '', rawBody).slice(0, 64);
  assert.equal(verifyEmailWebhook({ secret, timestamp, signature: legacy, rawBody }, { now }).ok, false);
});

test('a signature is accepted once', async () => {
  const store = receiptStore();
  assert.equal(await claimEmailWebhookSignature(store, 'abc'), true);
  assert.equal(await claimEmailWebhookSignature(store, 'abc'), false);
});

test('the route refuses unsigned, legacy-signed, stale and replayed deliveries', async (t) => {
  const store = receiptStore();
  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    done(null, body ? JSON.parse(body) : {});
  });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', store);
  app.addHook('onRequest', async (request) => { request.prisma = store; });
  await app.register(webhookRoutes);
  t.after(() => app.close());

  const rawBody = JSON.stringify({ from: 'a@example.test', subject: 'Hi', text: 'Hello' });
  const legacySignature = (await import('node:crypto')).createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(JSON.stringify(JSON.parse(rawBody))).digest('hex');

  const unsigned = await app.inject({ method: 'POST', url: '/email', headers: { 'content-type': 'application/json' }, payload: rawBody });
  assert.equal(unsigned.statusCode, 401);

  const legacy = await app.inject({
    method: 'POST', url: '/email', headers: { 'content-type': 'application/json', 'x-webhook-signature': legacySignature }, payload: rawBody,
  });
  assert.equal(legacy.statusCode, 401, 'the old body-only signature without a timestamp is refused');

  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
  const stale = await app.inject({
    method: 'POST', url: '/email',
    headers: { 'content-type': 'application/json', 'x-webhook-timestamp': staleTimestamp, 'x-webhook-signature': signEmailWebhook(process.env.WEBHOOK_SECRET, staleTimestamp, rawBody) },
    payload: rawBody,
  });
  assert.equal(stale.statusCode, 401);
  assert.match(stale.json().error, /timestamp/);
  assert.equal(store.seen.size, 0);
});

test('the route claims the signature before processing and rejects a replay', async (t) => {
  const store = receiptStore();
  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    done(null, body ? JSON.parse(body) : {});
  });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', store);
  app.addHook('onRequest', async (request) => { request.prisma = store; });
  await app.register(webhookRoutes);
  t.after(() => app.close());

  const rawBody = JSON.stringify({ from: 'a@example.test', subject: 'Hi', text: 'Hello' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signEmailWebhook(process.env.WEBHOOK_SECRET, timestamp, rawBody);
  // An earlier delivery of exactly this request was accepted.
  await claimEmailWebhookSignature(store, signature);
  const replay = await app.inject({
    method: 'POST', url: '/email',
    headers: { 'content-type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature },
    payload: rawBody,
  });
  assert.equal(replay.statusCode, 409, replay.body);

  const source = (await import('node:fs')).readFileSync(new URL('../../routes/webhook.routes.js', import.meta.url), 'utf8');
  const emailRoute = source.slice(source.indexOf("fastify.post('/email'"), source.indexOf("fastify.post('/email/test'"));
  assert.doesNotMatch(emailRoute, /JSON\.stringify\(request\.body\)/);
  assert.ok(emailRoute.indexOf('claimEmailWebhookSignature') < emailRoute.indexOf('parseEmail(request.body)'));
});
