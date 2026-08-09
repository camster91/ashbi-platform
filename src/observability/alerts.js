import crypto from 'node:crypto';

import env from '../config/env.js';

export async function sendOperationalAlert(event, {
  webhookUrl = env.notificationWebhookUrl,
  owner = env.observabilityOwner,
  webhookSecret = env.webhookSecret,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!webhookUrl || !owner) return { skipped: true, reason: 'alert destination or owner is not configured' };
  const payload = JSON.stringify({
    schemaVersion: 1,
    event: event.event,
    severity: event.severity || 'error',
    service: event.service,
    queue: event.queue,
    jobName: event.jobName,
    jobId: event.jobId,
    attemptsMade: event.attemptsMade,
    statusCode: event.statusCode,
    route: event.route,
    revision: process.env.APP_REVISION || 'unknown',
    environment: env.nodeEnv,
    owner,
    timestamp: new Date().toISOString(),
  });
  const headers = { 'Content-Type': 'application/json' };
  if (webhookSecret) {
    headers['X-Ashbi-Signature'] = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  }
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Operational alert delivery failed with status ${response.status}`);
  return { delivered: true, status: response.status };
}
