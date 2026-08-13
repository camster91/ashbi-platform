import test from 'node:test';
import assert from 'node:assert/strict';
import { postSlackMessage } from '../../services/slack-outbound.service.js';

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
