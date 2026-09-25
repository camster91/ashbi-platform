import test from 'node:test';
import assert from 'node:assert/strict';
import { callSlackApi, postSlackMessage, revokeSlackToken } from '../../services/slack-outbound.service.js';

test('posts only the approved message to the mapped Slack channel', async () => {
  let request;
  const result = await postSlackMessage({
    botToken: 'xoxb-sensitive', channelId: 'C123', text: 'The client approved the draft.',
    fetchImpl: async (url, input) => {
      request = { url, input };
      return { ok: true, json: async () => ({ ok: true, channel: 'C123', ts: '1710000000.000001' }) };
    },
  });

  assert.equal(request.url, 'https://slack.com/api/chat.postMessage');
  assert.equal(request.input.headers.Authorization, 'Bearer xoxb-sensitive');
  assert.deepEqual(JSON.parse(request.input.body), { channel: 'C123', text: 'The client approved the draft.' });
  assert.deepEqual(result, { channelId: 'C123', slackTs: '1710000000.000001' });
});

test('posts a confirmed reply into the approved Slack thread', async () => {
  let request;
  await postSlackMessage({
    botToken: 'xoxb-sensitive', channelId: 'C123', text: 'I will take this.', threadTs: '1710000000.000001',
    fetchImpl: async (url, input) => {
      request = { url, input };
      return { ok: true, json: async () => ({ ok: true, channel: 'C123', ts: '1710000000.000002' }) };
    },
  });

  assert.equal(request.url, 'https://slack.com/api/chat.postMessage');
  assert.deepEqual(JSON.parse(request.input.body), {
    channel: 'C123', text: 'I will take this.', thread_ts: '1710000000.000001',
  });
});

test('fails closed when Slack rejects the post', async () => {
  await assert.rejects(() => postSlackMessage({
    botToken: 'xoxb-sensitive', channelId: 'C123', text: 'Hello',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false, error: 'not_in_channel' }) }),
  }), /SLACK_POST_NOT_IN_CHANNEL/);
});

function rateLimited(retryAfter) {
  return { ok: false, status: 429, headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) }, json: async () => ({ ok: false, error: 'ratelimited' }) };
}
const posted = { ok: true, status: 200, json: async () => ({ ok: true, channel: 'C123', ts: '1710000000.000003' }) };

test('waits for Slack Retry-After on 429 and then succeeds', async () => {
  const responses = [rateLimited('3'), posted];
  const waits = [];
  const result = await postSlackMessage({
    botToken: 'xoxb-sensitive', channelId: 'C123', text: 'Hello',
    fetchImpl: async () => responses.shift(),
    sleep: async (ms) => { waits.push(ms); },
  });

  assert.deepEqual(waits, [3000]);
  assert.deepEqual(result, { channelId: 'C123', slackTs: '1710000000.000003' });
});

test('gives up after a bounded number of 429 retries', async () => {
  let calls = 0;
  const waits = [];
  await assert.rejects(() => postSlackMessage({
    botToken: 'xoxb-sensitive', channelId: 'C123', text: 'Hello',
    fetchImpl: async () => { calls += 1; return rateLimited('1'); },
    sleep: async (ms) => { waits.push(ms); },
  }), (error) => error.message === 'SLACK_RATE_LIMITED');

  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 1000]);
});

test('does not sleep past the retry cap when Slack asks for a long wait', async () => {
  let calls = 0;
  let slept = false;
  await assert.rejects(() => callSlackApi({
    method: 'chat.postMessage', botToken: 'xoxb-sensitive',
    fetchImpl: async () => { calls += 1; return rateLimited('600'); },
    sleep: async () => { slept = true; },
  }), /SLACK_RATE_LIMITED/);

  assert.equal(calls, 1);
  assert.equal(slept, false);
});

test('caps the total 429 wait across retries, not just each wait', async () => {
  let calls = 0;
  const waits = [];
  await assert.rejects(() => callSlackApi({
    method: 'chat.postMessage', botToken: 'xoxb-sensitive',
    fetchImpl: async () => { calls += 1; return rateLimited('20'); },
    sleep: async (ms) => { waits.push(ms); },
  }), /SLACK_RATE_LIMITED/);

  assert.deepEqual(waits, [20000]);
  assert.equal(calls, 2);
});

test('every Slack request carries an abort timeout signal', async () => {
  let signal;
  await callSlackApi({
    method: 'auth.revoke', botToken: 'xoxb-sensitive',
    fetchImpl: async (_url, input) => { signal = input.signal; return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test('revokes a bot token through auth.revoke and treats an already-dead token as revoked', async () => {
  let request;
  const revoked = await revokeSlackToken({
    botToken: 'xoxb-sensitive',
    fetchImpl: async (url, input) => { request = { url, input }; return { ok: true, status: 200, json: async () => ({ ok: true, revoked: true }) }; },
  });
  assert.equal(request.url, 'https://slack.com/api/auth.revoke');
  assert.equal(request.input.headers.Authorization, 'Bearer xoxb-sensitive');
  assert.deepEqual(revoked, { revoked: true });

  const alreadyDead = await revokeSlackToken({
    botToken: 'xoxb-sensitive',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'invalid_auth' }) }),
  });
  assert.equal(alreadyDead.revoked, true);

  await assert.rejects(() => revokeSlackToken({
    botToken: 'xoxb-sensitive',
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'internal_error' }) }),
  }), /SLACK_REVOKE_INTERNAL_ERROR/);
});
