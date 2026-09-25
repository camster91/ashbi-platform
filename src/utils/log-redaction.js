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
