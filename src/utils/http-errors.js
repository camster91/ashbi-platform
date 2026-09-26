// Client-safe HTTP error shaping — never leak internal error.message in production.

/**
 * Build a response body safe to send to API clients.
 * Server errors return a generic message; 4xx may expose `error.expose` messages.
 */
export function toClientErrorBody(error, { traceId } = {}) {
  const statusCode = error.statusCode || 500;
  // AI control-plane errors (src/ai/errors.js: AI_DISABLED, AI_BUDGET_EXCEEDED,
  // AI_PROVIDER_*) carry fixed, caller-safe messages even when they are 5xx,
  // so a disabled or over-budget workspace sees why instead of a generic 500.
  if (error.expose === true && typeof error.code === 'string' && error.code.startsWith('AI_') && typeof error.message === 'string') {
    return {
      error: error.message,
      code: error.code,
      statusCode,
      ...(traceId ? { traceId } : {}),
    };
  }
  const isServerError = statusCode >= 500;
  const isDev = process.env.NODE_ENV !== 'production';
  const exposeMessage = error.expose === true && typeof error.message === 'string';

  return {
    error: isServerError
      ? 'InternalServerError'
      : (error.code || error.name || 'RequestError'),
    message: isServerError && !isDev
      ? 'An unexpected error occurred'
      : (exposeMessage ? error.message : (isServerError ? 'An unexpected error occurred' : 'Request failed')),
    statusCode,
    ...(traceId ? { traceId } : {}),
    ...(isDev && isServerError ? { detail: error.message } : {}),
  };
}

/**
 * Log + return a sanitized 500 payload (for route catch blocks).
 */
export function internalErrorReply(reply, request, err, publicMessage = 'An unexpected error occurred') {
  request.log.error({ err }, 'Request failed');
  return reply.status(500).send({ error: 'InternalServerError', message: publicMessage });
}
