const SLACK_API_BASE_URL = 'https://slack.com/api/';

// Slack answers rate-limited Web API calls with HTTP 429 and a Retry-After
// header (seconds). Honour it a bounded number of times so a burst does not
// fail an approved action outright, but never wait longer than the cap: a
// caller blocked for minutes is worse than a clear, retryable failure.
export const SLACK_MAX_RATE_LIMIT_RETRIES = 2;
export const SLACK_MAX_RETRY_WAIT_MS = 30_000;
const SLACK_DEFAULT_RETRY_AFTER_SECONDS = 1;

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function retryAfterMs(response) {
  const raw = typeof response?.headers?.get === 'function' ? response.headers.get('retry-after') : null;
  const seconds = Number.parseInt(raw ?? '', 10);
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : SLACK_DEFAULT_RETRY_AFTER_SECONDS) * 1000;
}

/**
 * Calls a Slack Web API method with a bot token. The token only ever travels
 * in the Authorization header and is never included in thrown errors.
 */
export async function callSlackApi({
  method, botToken, body = {}, fetchImpl = fetch, sleep = defaultSleep,
  maxRetries = SLACK_MAX_RATE_LIMIT_RETRIES, maxWaitMs = SLACK_MAX_RETRY_WAIT_MS,
}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(`${SLACK_API_BASE_URL}${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (response.status === 429) {
      const waitMs = retryAfterMs(response);
      if (attempt >= maxRetries || waitMs > maxWaitMs) throw new Error('SLACK_RATE_LIMITED');
      await sleep(waitMs);
      continue;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('SLACK_INVALID_RESPONSE');
    }
    return { response, payload };
  }
}

export async function postSlackMessage({ botToken, channelId, text, threadTs, fetchImpl = fetch, sleep }) {
  let result;
  try {
    result = await callSlackApi({
      method: 'chat.postMessage', botToken, fetchImpl, sleep,
      body: { channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) },
    });
  } catch (error) {
    if (error.message === 'SLACK_INVALID_RESPONSE') throw new Error('SLACK_POST_INVALID_RESPONSE');
    throw error;
  }
  const { response, payload: body } = result;
  if (!response.ok || !body?.ok || typeof body.channel !== 'string' || typeof body.ts !== 'string') {
    throw new Error(`SLACK_POST_${typeof body?.error === 'string' ? body.error.toUpperCase() : 'FAILED'}`);
  }
  return { channelId: body.channel, slackTs: body.ts };
}

/**
 * Revokes a bot token with Slack (auth.revoke). A token Slack already
 * considers invalid or revoked counts as revoked: the goal is that it can no
 * longer be used, not that this particular call performed the revocation.
 */
export async function revokeSlackToken({ botToken, fetchImpl = fetch, sleep }) {
  const { response, payload } = await callSlackApi({ method: 'auth.revoke', botToken, fetchImpl, sleep });
  if (response.ok && payload?.ok) return { revoked: true };
  if (['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'].includes(payload?.error)) {
    return { revoked: true, alreadyInvalid: true };
  }
  throw new Error(`SLACK_REVOKE_${typeof payload?.error === 'string' ? payload.error.toUpperCase() : 'FAILED'}`);
}
