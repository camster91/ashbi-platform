import * as Sentry from '@sentry/node';

import env from '../config/env.js';

const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|body|payload|content|email/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function sanitizeString(value) {
  return value.replace(EMAIL, '[redacted-email]').replace(BEARER, 'Bearer [redacted]');
}

function redactValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(item, seen);
  }
  return output;
}

function sanitizeUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value, 'https://telemetry.invalid');
    return url.pathname
      .split('/')
      .map((segment) => (/^[a-z0-9_-]{20,}$/i.test(segment) ? ':id' : segment))
      .join('/');
  } catch {
    return String(value).split('?')[0];
  }
}

export function scrubTelemetryEvent(event) {
  const scrubbed = { ...event };
  delete scrubbed.user;
  if (scrubbed.request) {
    scrubbed.request = {
      method: scrubbed.request.method,
      url: sanitizeUrl(scrubbed.request.url),
    };
  }
  scrubbed.extra = redactValue(scrubbed.extra || {});
  scrubbed.tags = redactValue(scrubbed.tags || {});
  scrubbed.breadcrumbs = (scrubbed.breadcrumbs || []).map((breadcrumb) => ({
    ...breadcrumb,
    message: breadcrumb.message ? sanitizeString(breadcrumb.message) : breadcrumb.message,
    data: redactValue(breadcrumb.data || {}),
  }));
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((exception) => ({
        ...exception,
        value: exception.value ? '[redacted error message]' : exception.value,
      })),
    };
  }
  return scrubbed;
}

let initialized = false;

export function initSentry(service, integrations = []) {
  if (!env.sentryDsn || initialized) return false;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    release: process.env.APP_REVISION || 'unknown',
    sendDefaultPii: false,
    tracesSampleRate: env.isProduction ? 0.2 : 1.0,
    integrations: integrations.length
      ? (defaultIntegrations) => [...defaultIntegrations, ...integrations]
      : undefined,
    initialScope: {
      tags: {
        service,
        revision: process.env.APP_REVISION || 'unknown',
      },
    },
    beforeSend: scrubTelemetryEvent,
    beforeSendTransaction: scrubTelemetryEvent,
  });
  initialized = true;
  return true;
}

export { Sentry };
