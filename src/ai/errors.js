// Typed AI control-plane errors (#413, docs/ai-byok.md).
//
// Every error here is safe to show to the caller: messages never carry a
// provider key, a response body from the provider, or tenant data. Routes and
// the global error handler map them to a stable `code` and HTTP status instead
// of a generic 500.

export class AiControlError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, statusCode: number }} options
   */
  constructor(message, { code, statusCode }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.expose = true;
  }
}

/** AI is switched off for the whole deployment or for this organization. */
export class AiDisabledError extends AiControlError {
  /** @param {'platform' | 'organization'} scope */
  constructor(scope) {
    super(
      scope === 'platform'
        ? 'AI features are temporarily turned off for this deployment.'
        : 'AI features are turned off for this workspace. An admin can turn them back on in Settings.',
      { code: 'AI_DISABLED', statusCode: 503 },
    );
    this.scope = scope;
  }
}

/** The organization's month-to-date BYOK spend reached its budget. */
export class AiBudgetExceededError extends AiControlError {
  constructor() {
    super(
      'This workspace has reached its monthly AI budget. An admin can raise the budget in Settings.',
      { code: 'AI_BUDGET_EXCEEDED', statusCode: 402 },
    );
  }
}

export const AI_PROVIDER_ERROR_TYPES = Object.freeze([
  'auth', 'quota', 'rate_limit', 'timeout', 'invalid_request', 'upstream', 'invalid_response',
]);

const PROVIDER_MESSAGES = {
  auth: 'The AI provider rejected the workspace API key.',
  quota: 'The AI provider account is out of credit or quota.',
  rate_limit: 'The AI provider is rate limiting this workspace. Try again shortly.',
  timeout: 'The AI provider did not answer in time.',
  invalid_request: 'The AI provider rejected the request (check the model name).',
  upstream: 'The AI provider is unavailable.',
  invalid_response: 'The AI provider returned an unreadable response.',
};

/**
 * A failed call to a BYOK provider. The message is fixed per type and the
 * upstream HTTP status is kept separately; the provider's response body is
 * never included, because some providers echo part of the key back.
 */
export class AiProviderError extends AiControlError {
  /**
   * @param {typeof AI_PROVIDER_ERROR_TYPES[number]} type
   * @param {{ upstreamStatus?: number | null }} [options]
   */
  constructor(type, { upstreamStatus = null } = {}) {
    const known = AI_PROVIDER_ERROR_TYPES.includes(type) ? type : 'upstream';
    super(PROVIDER_MESSAGES[known], {
      code: `AI_PROVIDER_${known.toUpperCase()}`,
      statusCode: known === 'timeout' ? 504 : 502,
    });
    this.type = known;
    this.upstreamStatus = upstreamStatus;
  }
}

/** @param {unknown} error */
export function isAiControlError(error) {
  return error instanceof AiControlError;
}

/**
 * Response body for an AI control error, in the `{ error, code }` shape the
 * web client reads.
 * @param {AiControlError} error
 */
export function aiErrorBody(error) {
  return { error: error.message, code: error.code };
}

/**
 * Route helper: answer an AI control error with its status and code. Returns
 * undefined for any other error so the caller keeps its own handling:
 *
 *   catch (err) {
 *     if (isAiControlError(err)) return sendAiError(reply, err);
 *     ...
 *   }
 * @param {any} reply Fastify reply
 * @param {AiControlError} error
 */
export function sendAiError(reply, error) {
  return reply.status(error.statusCode).send(aiErrorBody(error));
}
