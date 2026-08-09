import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { sendOperationalAlert } from '../../observability/alerts.js';

test('operational alert is scrubbed, signed, release-tagged, and owner-routed', async () => {
  let request;
  const result = await sendOperationalAlert({
    event: 'job_failed',
    service: 'worker',
    queue: 'embedding',
    jobName: 'generate-embedding',
    jobId: 'job-3',
    attemptsMade: 3,
    error: 'client@example.com private payload',
    payload: { clientName: 'Private Client' },
  }, {
    webhookUrl: 'https://alerts.example.test/ingest',
    owner: 'platform-on-call',
    webhookSecret: 'signing-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202 };
    },
  });

  assert.deepEqual(result, { delivered: true, status: 202 });
  assert.equal(request.url, 'https://alerts.example.test/ingest');
  const body = JSON.parse(request.options.body);
  assert.equal(body.owner, 'platform-on-call');
  assert.equal(body.revision, process.env.APP_REVISION || 'unknown');
  assert.doesNotMatch(request.options.body, /client@example\.com|Private Client|payload/);
  assert.equal(
    request.options.headers['X-Ashbi-Signature'],
    crypto.createHmac('sha256', 'signing-secret').update(request.options.body).digest('hex'),
  );
});

test('operational alert skips safely until both destination and owner exist', async () => {
  assert.equal((await sendOperationalAlert({}, { webhookUrl: '', owner: 'on-call' })).skipped, true);
  assert.equal((await sendOperationalAlert({}, { webhookUrl: 'https://example.test', owner: '' })).skipped, true);
});

test('operational alert propagates delivery failure for logging and retry visibility', async () => {
  await assert.rejects(
    sendOperationalAlert({ event: 'job_failed' }, {
      webhookUrl: 'https://example.test',
      owner: 'on-call',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /status 503/,
  );
});
