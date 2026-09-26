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

// Capability tokens carried in URL paths. Fastify's request log records
// `req.url`, so review share-link tokens (#417, docs/media-review.md) would
// otherwise be written to every request log line. The API route and the SPA
// page are both masked.
const CAPABILITY_URL_PATTERNS = Object.freeze([
  /^(\/api\/portal\/review\/)[^/?#]+/,
  /^(\/portal\/review\/)[^/?#]+/,
]);

/**
 * @param {unknown} url
 * @returns {unknown}
 */
export function redactCapabilityUrl(url) {
  if (typeof url !== 'string') return url;
  for (const pattern of CAPABILITY_URL_PATTERNS) {
    if (pattern.test(url)) return url.replace(pattern, '$1[Redacted]');
  }
  return url;
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
