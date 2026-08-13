const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

export async function postSlackMessage({ botToken, channelId, text, threadTs, fetchImpl = fetch }) {
  const response = await fetchImpl(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('SLACK_POST_INVALID_RESPONSE');
  }
  if (!response.ok || !body?.ok || typeof body.channel !== 'string' || typeof body.ts !== 'string') {
    throw new Error(`SLACK_POST_${typeof body?.error === 'string' ? body.error.toUpperCase() : 'FAILED'}`);
  }
  return { channelId: body.channel, slackTs: body.ts };
}
