// Pino redaction for credential-bearing fields (#416: service credentials are
// never exposed in ordinary logs). Fastify's default request serializer does
// not log headers, so these paths are defense in depth for code that logs a
// request, its headers, or a credential-shaped field directly.
// Pino path syntax: dotted for plain names, bracketed for hyphenated ones.
const CREDENTIAL_HEADERS = ['.authorization', '["x-api-key"]', '.cookie', '["set-cookie"]'];

export const LOG_REDACT_PATHS = Object.freeze([
  ...CREDENTIAL_HEADERS.flatMap((header) => [
    `req.headers${header}`,
    `request.headers${header}`,
    `headers${header}`,
    `res.headers${header}`,
  ]),
  'apiKey',
  'rawKey',
  'password',
  'newPassword',
  'currentPassword',
  '*.apiKey',
  '*.rawKey',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
]);

export const LOG_REDACT_OPTIONS = Object.freeze({ paths: [...LOG_REDACT_PATHS], censor: '[Redacted]' });

// Capability tokens carried in URLs. Fastify's request log records
// `req.url`, so every capability link (media review share links, #417, and
// the portal proposal/contract/invoice/form/estimate and project view links)
// would otherwise be written to every request log line. Both the API routes
// and the SPA pages are masked, and so are `token`/`viewToken`/`signToken`
// query parameters (magic links, password resets). web/src/lib/telemetry-scrub.js
// applies the same rules to browser telemetry.
const SEGMENT = '[^/?#\\s"\'<>]+';
const CAPABILITY_URL_PATTERNS = Object.freeze([
  new RegExp(`(/(?:api/)?portal/(?:review|proposal|contract|invoice|form|estimate)/)${SEGMENT}`, 'g'),
  new RegExp(`(/api/(?:proposals/client|contracts/sign|estimates/view|invoices/client)/)${SEGMENT}`, 'g'),
  // The project status link /portal/:token (not the named portal pages).
  new RegExp(`(/(?:api/)?portal/)(?!(?:review|proposal|contract|invoice|form|estimate|book|booking)(?=[/?#\\s"'<>]|$))${SEGMENT}`, 'g'),
  /([?&](?:token|viewToken|signToken)=)[^&#\s"'<>]+/g,
]);

/**
 * @param {unknown} url
 * @param {string} [mask]
 * @returns {unknown}
 */
export function redactCapabilityUrl(url, mask = '[Redacted]') {
  if (typeof url !== 'string') return url;
  let result = url;
  for (const pattern of CAPABILITY_URL_PATTERNS) {
    result = result.replace(pattern, (_match, prefix) => `${prefix}${mask}`);
  }
  return result;
}

/**
 * Fastify's default `req` log serializer, with capability tokens masked in
 * the URL.
 * @param {any} req
 */
export function serializeRequestForLog(req) {
  return {
    method: req.method,
    url: redactCapabilityUrl(req.url),
    version: req.headers && req.headers['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket ? req.socket.remotePort : undefined,
  };
}
