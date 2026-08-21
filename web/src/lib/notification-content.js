export function resolveNotificationContent(notification) {
  const fallback = {
    title: notification?.title || '',
    message: typeof notification?.message === 'string' ? notification.message : '',
  };
  const rawMessage = fallback.message.trim();
  if (!rawMessage.startsWith('{') || !rawMessage.endsWith('}')) return fallback;

  try {
    const payload = JSON.parse(rawMessage);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
    return {
      title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : fallback.title,
      message: typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallback.message,
    };
  } catch {
    return fallback;
  }
}
