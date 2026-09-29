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
const {
  signEmailWebhook, verifyEmailWebhook, recordEmailWebhookReceipt, emailWebhookJobId,
} = await import('../../webhooks/email-webhook-signature.js');
const { emailQueue, hydrateEmailJobData } = await import('../../jobs/queue.js');

function receiptStore() {
  const rows = new Map();
  const matches = (row, where) => Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date) && 'lt' in condition) return row[key] < condition.lt;
    return row[key] === condition;
  });
  return {
    get seen() { return new Set(rows.keys()); },
    rows,
    emailWebhookReceipt: {
      findUnique: async ({ where }) => (rows.has(where.signature) ? { id: where.signature } : null),
      create: async ({ data }) => {
        if (rows.has(data.signature)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        rows.set(data.signature, { ...data });
        return data;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count += 1; }
        return { count };
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [key, row] of rows) if (matches(row, where)) { rows.delete(key); count += 1; }
        return { count };
      },
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
  assert.equal(await recordEmailWebhookReceipt(store, 'abc'), true);
  assert.equal(await recordEmailWebhookReceipt(store, 'abc'), false);
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

function signedApp(t, store) {
  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    done(null, body ? JSON.parse(body) : {});
  });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', store);
  app.addHook('onRequest', async (request) => { request.prisma = store; });
  t.after(() => app.close());
  return app;
}

function captureQueue(t, { failTimes = 0 } = {}) {
  const jobs = [];
  const original = emailQueue.add;
  let failures = failTimes;
  emailQueue.add = async (name, data, opts) => {
    if (failures > 0) { failures -= 1; throw Object.assign(new Error('redis down'), { code: 'QUEUE_UNAVAILABLE' }); }
    jobs.push({ name, data, opts });
    return { id: opts.jobId };
  };
  t.after(() => { emailQueue.add = original; });
  return jobs;
}

const signedDelivery = (rawBody) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signEmailWebhook(process.env.WEBHOOK_SECRET, timestamp, rawBody);
  return { signature, headers: { 'content-type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature } };
};

test('an accepted delivery is queued durably, keyed by its signature, and a replay is refused', async (t) => {
  const store = receiptStore();
  const jobs = captureQueue(t);
  const app = signedApp(t, store);
  await app.register(webhookRoutes);

  const rawBody = JSON.stringify({ from: 'a@example.test', subject: 'Hi', text: 'Hello' });
  const { signature, headers } = signedDelivery(rawBody);
  const accepted = await app.inject({ method: 'POST', url: '/email', headers, payload: rawBody });
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].opts.jobId, emailWebhookJobId(signature));
  assert.equal(jobs[0].data.organizationId, 'org-bot');
  // The pipeline is not idempotent: the job runs once and a failure is kept for replay.
  assert.equal(jobs[0].opts.attempts, 1);
  assert.ok(jobs[0].opts.removeOnFail.age >= 7 * 24 * 60 * 60, 'failed deliveries are retained for replay');
  assert.equal(store.seen.has(signature), true);

  const replay = await app.inject({ method: 'POST', url: '/email', headers, payload: rawBody });
  assert.equal(replay.statusCode, 409, replay.body);
  assert.equal(jobs.length, 1, 'a replay is never queued');
});

test('when the queue is unavailable nothing is recorded, so the sender\'s retry is accepted', async (t) => {
  const store = receiptStore();
  const jobs = captureQueue(t, { failTimes: 1 });
  const app = signedApp(t, store);
  await app.register(webhookRoutes);

  const rawBody = JSON.stringify({ from: 'b@example.test', subject: 'Retry', text: 'Hello' });
  const { signature, headers } = signedDelivery(rawBody);
  const first = await app.inject({ method: 'POST', url: '/email', headers, payload: rawBody });
  assert.equal(first.statusCode, 503, first.body);
  assert.equal(store.seen.has(signature), false);

  const retry = await app.inject({ method: 'POST', url: '/email', headers, payload: rawBody });
  assert.equal(retry.statusCode, 202, retry.body);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].opts.jobId, emailWebhookJobId(signature));
});

test('the route never re-serialises the body and queues before recording the receipt', () => {
  return import('node:fs').then((fs) => {
    const source = fs.readFileSync(new URL('../../routes/webhook.routes.js', import.meta.url), 'utf8');
    const emailRoute = source.slice(source.indexOf("fastify.post('/email'"), source.indexOf("fastify.post('/email/test'"));
    assert.doesNotMatch(emailRoute, /JSON\.stringify\(request\.body\)/);
    assert.doesNotMatch(emailRoute, /processEmailPipeline/, 'processing happens in the worker, not the request');
    assert.ok(emailRoute.indexOf('queueInboundEmailDelivery(') < emailRoute.indexOf('recordEmailWebhookReceipt('));
    const worker = fs.readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
    const emailWorker = worker.slice(worker.indexOf('QUEUES.EMAIL_PROCESSING'), worker.indexOf('// Project Health Worker'));
    assert.match(emailWorker, /try \{\s*await scheduleEscalationCheck/, 'a scheduling failure never fails a processed email job');
    assert.match(emailWorker, /maxStalledCount: 0/, 'a stalled email job is failed for replay, never re-run');
  });
});

test('queued email data gets its receivedAt back as a Date before the pipeline runs', () => {
  const sent = { subject: 'Hi', receivedAt: new Date('2026-09-29T10:00:00.000Z') };
  const overTheWire = JSON.parse(JSON.stringify(sent));
  assert.equal(typeof overTheWire.receivedAt, 'string');
  const hydrated = hydrateEmailJobData(overTheWire);
  assert.ok(hydrated.receivedAt instanceof Date);
  assert.equal(hydrated.receivedAt.toISOString(), '2026-09-29T10:00:00.000Z');
  assert.equal(hydrateEmailJobData({ receivedAt: 'not a date' }).receivedAt, undefined);
  assert.equal(hydrateEmailJobData({}).receivedAt, undefined);
});
