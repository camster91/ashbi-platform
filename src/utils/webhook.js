// Webhook notification utility
// POSTs to NOTIFICATION_WEBHOOK_URL when notifications are created

const WEBHOOK_URL = process.env.NOTIFICATION_WEBHOOK_URL;

/**
 * Send a notification payload to the configured webhook URL.
 * Silently skips if NOTIFICATION_WEBHOOK_URL is not set.
 * Never throws — failures are logged but don't block the caller.
 */
export async function sendWebhookNotification(notification) {
  if (!WEBHOOK_URL) return;

  const payload = {
    event: notification.type,
    title: notification.title,
    message: notification.message,
    url: 'https://hub.ashbi.ca',
    data: notification.data || null,
    createdAt: notification.createdAt || new Date().toISOString(),
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(`[webhook] POST failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[webhook] Error sending notification:`, err.message);
  }
}
