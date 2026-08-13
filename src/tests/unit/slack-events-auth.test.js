import crypto from 'crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySlackEventRequest } from '../../security/slack-events-auth.js';

const signingSecret = 'test-signing-secret';
const now = Date.parse('2026-08-13T12:00:00.000Z');
const rawBody = '{"type":"event_callback","event_id":"Ev123"}';

function sign(timestamp) {
  const signature = crypto
    .createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return `v0=${signature}`;
}

test('accepts a Slack event signed over the exact raw request body', () => {
  const timestamp = String(Math.floor(now / 1000));

  assert.deepEqual(
    verifySlackEventRequest({ rawBody, timestamp, signature: sign(timestamp), signingSecret, now }),
    { valid: true },
  );
});

test('rejects Slack requests with tampered signatures', () => {
  const timestamp = String(Math.floor(now / 1000));

  assert.deepEqual(
    verifySlackEventRequest({ rawBody, timestamp, signature: 'v0=invalid', signingSecret, now }),
    { valid: false, reason: 'invalid_signature' },
  );
});

test('rejects stale Slack event replays', () => {
  const timestamp = String(Math.floor((now - 301_000) / 1000));

  assert.deepEqual(
    verifySlackEventRequest({ rawBody, timestamp, signature: sign(timestamp), signingSecret, now }),
    { valid: false, reason: 'stale_timestamp' },
  );
});
