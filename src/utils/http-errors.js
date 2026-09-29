// Client-safe HTTP error shaping — never leak internal error.message in production.
import { STATUS_CODES } from 'node:http';

const PRISMA_ERROR_CODE = /^P\d{4}$/;

/** A Prisma client error (known request, validation, initialization, ...). */
export function isPrismaError(error) {
  return Boolean(error) && (
    (typeof error.code === 'string' && PRISMA_ERROR_CODE.test(error.code))
    || (typeof error.name === 'string' && error.name.startsWith('PrismaClient'))
  );
}

/** A tenant-isolation refusal from src/utils/prisma-tenant-proxy.js. */
export function isTenancyError(error) {
  return Boolean(error) && (
    error.name === 'TenancyError'
    || (typeof error.message === 'string' && error.message.startsWith('Tenancy Error'))
  );
}

/**
 * The HTTP status to answer for an error. Prisma and tenancy errors never
 * carry an HTTP status of their own: a unique-constraint conflict is a 409, a
 * missing record a 404, a record outside the caller's organization a 404
 * (never confirming it exists), and anything else a 500.
 */
export function clientErrorStatus(error) {
  if (isPrismaError(error)) {
    if (error.code === 'P2002') return 409;
    if (error.code === 'P2025') return 404;
    return 500;
  }
  if (isTenancyError(error)) {
    return error.statusCode === 400 || error.statusCode === 404 ? error.statusCode : 500;
  }
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

/**
 * Build a response body safe to send to API clients.
 *
 * - 5xx: a generic message (plus the raw message as `detail` only in local
 *   development, and never for Prisma or tenancy errors).
 * - Prisma / tenancy errors: a generic body for their mapped status. A unique
 *   conflict never names the field or value (no account enumeration through
 *   "email already exists"), and a tenancy refusal never names the model,
 *   record or organization.
 * - Other 4xx: the Fastify-compatible `{ statusCode, code?, error, message }`
 *   shape with the message the application or framework chose (validation
 *   errors, rate limits, explicit HTTP errors).
 */
export function toClientErrorBody(error, { traceId } = {}) {
  const statusCode = clientErrorStatus(error);
  const trace = traceId ? { traceId } : {};
  // AI control-plane errors (src/ai/errors.js: AI_DISABLED, AI_BUDGET_EXCEEDED,
  // AI_PROVIDER_*) carry fixed, caller-safe messages even when they are 5xx,
  // so a disabled or over-budget workspace sees why instead of a generic 500.
  if (error?.expose === true && typeof error.code === 'string' && error.code.startsWith('AI_') && typeof error.message === 'string') {
    return {
      error: error.message,
      code: error.code,
      statusCode,
      ...trace,
    };
  }

  const internal = isPrismaError(error) || isTenancyError(error);
  if (statusCode >= 500) {
    const detail = process.env.NODE_ENV === 'development' && !internal && typeof error?.message === 'string'
      ? { detail: error.message }
      : {};
    return {
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
      statusCode,
      ...trace,
      ...detail,
    };
  }

  if (internal) {
    if (statusCode === 409) {
      return { error: 'Conflict', code: 'CONFLICT', message: 'The request conflicts with existing data', statusCode, ...trace };
    }
    if (statusCode === 404) {
      return { error: 'Not Found', code: 'NOT_FOUND', message: 'Resource not found', statusCode, ...trace };
    }
    return { error: STATUS_CODES[statusCode] || 'Bad Request', message: 'Request failed', statusCode, ...trace };
  }

  return {
    error: STATUS_CODES[statusCode] || 'Request Error',
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    message: typeof error?.message === 'string' && error.message ? error.message : 'Request failed',
    statusCode,
    ...trace,
  };
}

/**
 * Log + return a sanitized 500 payload (for route catch blocks).
 */
export function internalErrorReply(reply, request, err, publicMessage = 'An unexpected error occurred') {
  request.log.error({ err }, 'Request failed');
  return reply.status(500).send({ error: 'InternalServerError', message: publicMessage });
}
