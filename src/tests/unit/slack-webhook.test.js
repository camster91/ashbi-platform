import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSlackEvent, sendSlackWebhook } from '../../webhooks/slack.js';

test('Slack formatter produces bounded, linkable plain-text payloads', () => {
  const payload = formatSlackEvent('Task assigned', { Task: 'Fix onboarding', Assignee: 'Bianca' }, 'https://hub.ashbi.ca/projects/p1');
  assert.match(payload.text, /\*Task assigned\*/);
  assert.match(payload.text, /\*Assignee:\* Bianca/);
  assert.match(payload.text, /<https:\/\/hub\.ashbi\.ca\/projects\/p1\|Open in Ashbi>/);
});

test('Slack delivery fails closed when no webhook is configured', async () => {
  const result = await sendSlackWebhook({ text: 'ignored' }, null);
  assert.deepEqual(result, { success: false, skipped: true, error: 'Slack webhook is not configured' });
});

test('Slack delivery posts JSON to an explicit webhook URL', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, statusText: 'OK' };
  };
  try {
    const result = await sendSlackWebhook({ text: 'hello' }, 'https://hooks.slack.test/incoming');
    assert.deepEqual(result, { success: true });
    assert.equal(request.url, 'https://hooks.slack.test/incoming');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), { text: 'hello' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
