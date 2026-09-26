// Browser telemetry scrubbing (#417 security review). With VITE_SENTRY_DSN
// set, the Sentry SDK reports page URLs, transaction names, spans and
// breadcrumbs (navigation, fetch/XHR). Capability links carry their secret
// in the URL, so every such token is rewritten to `:token` before an event,
// transaction or breadcrumb leaves the browser. The server applies the same
// rules to request logs (src/utils/log-redaction.js).

const SEGMENT = '[^/?#\\s"\'<>]+';
const CAPABILITY_PATTERNS = [
  // Share links and document links: /portal/review/:token, /api/portal/proposal/:token, ...
  new RegExp(`(/(?:api/)?portal/(?:review|proposal|contract|invoice|form|estimate)/)${SEGMENT}`, 'g'),
  // Legacy public API paths.
  new RegExp(`(/api/(?:proposals/client|contracts/sign|estimates/view|invoices/client)/)${SEGMENT}`, 'g'),
  // The project status link /portal/:token (not the named portal pages).
  new RegExp(`(/(?:api/)?portal/)(?!(?:review|proposal|contract|invoice|form|estimate|book|booking|:token)(?=[/?#\\s"'<>]|$))${SEGMENT}`, 'g'),
  // Magic-link, reset and view tokens in query strings.
  /([?&](?:token|viewToken|signToken)=)[^&#\s"'<>]+/g,
];

/** Rewrite every capability token in a string to `:token`. */
export function scrubCapabilityTokens(value) {
  if (typeof value !== 'string') return value;
  let result = value;
  for (const pattern of CAPABILITY_PATTERNS) {
    result = result.replace(pattern, (_match, prefix) => `${prefix}:token`);
  }
  return result;
}

const MAX_DEPTH = 12;

/** Deep copy with every string scrubbed (object keys included). */
export function scrubTelemetry(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return scrubCapabilityTokens(value);
  if (!value || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubTelemetry(item, depth + 1, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[scrubCapabilityTokens(key)] = scrubTelemetry(item, depth + 1, seen);
  }
  return output;
}

/** Sentry.init options that scrub events, transactions and breadcrumbs. */
export const sentryScrubOptions = {
  beforeSend: (event) => scrubTelemetry(event),
  beforeSendTransaction: (event) => scrubTelemetry(event),
  beforeBreadcrumb: (breadcrumb) => scrubTelemetry(breadcrumb),
};
