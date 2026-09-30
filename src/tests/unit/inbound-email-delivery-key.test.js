// Inbound email idempotency: every delivery carries a stable key through the
// job data (the pipeline stores it behind a unique index and resumes on a
// retry), which is what makes automatic retries of the email job safe.
// The database behaviour is proven by
// src/tests/integration/inbound-email-idempotency.database.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  MAX_INBOUND_DELIVERY_KEY_LENGTH,
  mailgunInboundDeliveryKey,
  normalizeInboundDeliveryKey,
} from '../../services/inbound-delivery-key.js';
import {
  emailQueue,
  hydrateEmailJobData,
  INBOUND_EMAIL_JOB_OPTIONS,
  queueInboundEmailDelivery,
} from '../../jobs/queue.js';

test('inbound email jobs retry with exponential backoff and keep their retention', () => {
  assert.equal(INBOUND_EMAIL_JOB_OPTIONS.attempts, 3);
  assert.deepEqual(INBOUND_EMAIL_JOB_OPTIONS.backoff, { type: 'exponential', delay: 5000 });
  assert.deepEqual(INBOUND_EMAIL_JOB_OPTIONS.removeOnComplete, { age: 24 * 60 * 60 });
  assert.deepEqual(INBOUND_EMAIL_JOB_OPTIONS.removeOnFail, { age: 30 * 24 * 60 * 60 });
  assert.ok(Object.isFrozen(INBOUND_EMAIL_JOB_OPTIONS));
});

test('a queued delivery carries its signature-derived job id as the delivery key', async (t) => {
  const jobs = [];
  const original = emailQueue.add;
  emailQueue.add = async (name, data, opts) => {
    jobs.push({ name, data, opts });
    return { id: opts.jobId };
  };
  t.after(() => { emailQueue.add = original; });

  const id = await queueInboundEmailDelivery({ subject: 'Hi' }, { organizationId: 'org-1', jobId: 'email-webhook-abc' });
  assert.equal(id, 'email-webhook-abc');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].data.inboundDeliveryKey, 'email-webhook-abc');
  assert.equal(jobs[0].data.organizationId, 'org-1');
  assert.equal(jobs[0].opts.jobId, 'email-webhook-abc');
  assert.equal(jobs[0].opts.attempts, 3);

  await assert.rejects(
    queueInboundEmailDelivery({ subject: 'Hi' }, { organizationId: 'org-1', jobId: '  ' }),
    /stable jobId/,
  );
  assert.equal(jobs.length, 1, 'a delivery without a key is never queued');
});

test('the worker passes the delivery key to the pipeline, falling back to a stable job id', () => {
  assert.equal(hydrateEmailJobData({ inboundDeliveryKey: 'email-webhook-a' }, { jobId: 'email-webhook-b' }).inboundDeliveryKey, 'email-webhook-a');
  // A job queued before the key was part of the job data.
  assert.equal(hydrateEmailJobData({ subject: 'Hi' }, { jobId: 'email-webhook-b' }).inboundDeliveryKey, 'email-webhook-b');
  // Auto-generated (numeric) job ids are not stable per delivery.
  assert.equal(hydrateEmailJobData({ subject: 'Hi' }, { jobId: '42' }).inboundDeliveryKey, undefined);
  assert.equal(hydrateEmailJobData({ subject: 'Hi' }).inboundDeliveryKey, undefined);
});

test('delivery keys are trimmed, non-empty and bounded', () => {
  assert.equal(normalizeInboundDeliveryKey('  key-1 '), 'key-1');
  assert.equal(normalizeInboundDeliveryKey(''), null);
  assert.equal(normalizeInboundDeliveryKey('   '), null);
  assert.equal(normalizeInboundDeliveryKey(undefined), null);
  assert.equal(normalizeInboundDeliveryKey(42), null);
  const long = 'x'.repeat(MAX_INBOUND_DELIVERY_KEY_LENGTH + 1);
  const hashed = normalizeInboundDeliveryKey(long);
  assert.match(hashed, /^sha256:[0-9a-f]{64}$/);
  assert.equal(normalizeInboundDeliveryKey(long), hashed, 'hashing is deterministic');
});

test('a Mailgun delivery is keyed by its Message-Id, else by a hash of the delivery', () => {
  assert.equal(mailgunInboundDeliveryKey({ 'Message-Id': ' <abc@mail.example> ', subject: 'Hi' }), 'mailgun:<abc@mail.example>');
  assert.equal(mailgunInboundDeliveryKey({ 'message-id': '<abc@mail.example>' }), 'mailgun:<abc@mail.example>');

  const delivery = { sender: 'a@example.test', subject: 'Hi', 'body-plain': 'Hello', timestamp: '1', token: 't' };
  const key = mailgunInboundDeliveryKey(delivery);
  assert.match(key, /^mailgun-sha256:[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(delivery).reverse());
  assert.equal(mailgunInboundDeliveryKey(reordered), key, 'field order does not change the key');
  assert.notEqual(mailgunInboundDeliveryKey({ ...delivery, 'body-plain': 'Other' }), key);
  assert.notEqual(mailgunInboundDeliveryKey({ ...delivery, 'Message-Id': '' }), undefined);
  assert.match(mailgunInboundDeliveryKey(undefined), /^mailgun-sha256:/);
});

test('the Mailgun inbound route hands its delivery key to the pipeline', () => {
  const source = fs.readFileSync(new URL('../../routes/mailgun.routes.js', import.meta.url), 'utf8');
  const inbound = source.slice(source.indexOf("fastify.post('/',"));
  assert.match(inbound, /processEmailPipeline\(\{[\s\S]*inboundDeliveryKey: mailgunInboundDeliveryKey\(body\)/);
});
