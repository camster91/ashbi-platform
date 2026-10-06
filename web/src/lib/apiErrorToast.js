// Decides whether a failed API request deserves a global toast, and which one.
//
// Reads (GETs are the only requests dispatched with a `retry`) back queries
// whose pages render their own inline error state (QueryErrorState and
// friends), so a failing background read must not also raise a toast — only a
// lost connection is global. A read the user triggered directly (a click that
// fetches, e.g. revealing a password) is sent with `userInitiated: true` and is
// reported like a write, because nothing else on the page will show the
// failure. Writes keep their toast because the user just acted and needs to
// know whether it happened. Returns null for "no toast".
/** Codes from src/ai/errors.js: AI_UNAVAILABLE, AI_DISABLED, AI_PROVIDER_*, ... */
export function isAiErrorCode(code) {
  return typeof code === 'string' && code.startsWith('AI_');
}

/**
 * The toast for an AI error, by code. Only "AI is off or not set up" stays
 * until dismissed (someone has to act); the rest are passing problems.
 * The server message already says what happened; it is kept as the body.
 */
export function aiErrorToast(code, message) {
  const body = (fallback) => message || fallback;
  if (code === 'AI_UNAVAILABLE' || code === 'AI_DISABLED' || code === 'AI_CONNECTION_DISABLED' || code === 'AI_CONNECTION_UNAVAILABLE') {
    return { title: 'AI unavailable', message: body('AI is not available for this workspace. Ask an admin to check the AI settings.'), duration: 0 };
  }
  if (code === 'AI_BUDGET_EXCEEDED') {
    return { title: 'AI budget reached', message: body('This workspace has used its monthly AI budget. An admin can raise it in Settings.') };
  }
  if (code === 'AI_PROVIDER_RATE_LIMIT') {
    return { title: 'AI is busy', message: 'The AI provider is handling too many requests. Try again in a minute.' };
  }
  if (code === 'AI_PROVIDER_TIMEOUT') {
    return { title: 'AI took too long', message: 'The AI provider did not answer in time. Try again in a minute.' };
  }
  if (code === 'AI_PROVIDER_INVALID_REQUEST') {
    return { title: 'AI refused the request', message: body('The AI provider rejected the request.') };
  }
  if (code === 'AI_ANALYSIS_FAILED') {
    return { title: 'Message not analyzed', message: body('AI could not analyze this message. Try again in a minute.') };
  }
  return { title: 'AI request failed', message: body('The AI provider could not complete this. Try again in a minute.') };
}

export function apiErrorToast(error, retry) {
  if (!error || error.status === 401) return null;
  const isNetworkError = error.name === 'NetworkError';
  const isTimeout = error.name === 'TimeoutError';
  const isRead = Boolean(retry);
  const retryAction = isRead ? { label: 'Try again', onClick: retry } : undefined;

  if (isNetworkError) {
    return {
      title: 'Network error',
      message: isRead
        ? 'Check your connection. Pages will show what could not be loaded.'
        : 'Check your connection. Your action was not retried to avoid a duplicate change.',
      duration: 0,
      action: retryAction,
    };
  }
  if (isRead && !error.userInitiated) return null;
  if (isTimeout) {
    return {
      title: 'Request timed out',
      message: isRead
        ? 'The server took too long. You can safely try again.'
        : 'The result is uncertain, so the action was not retried. Check the page before trying again.',
      duration: 0,
      action: retryAction,
    };
  }
  // AI control errors (src/ai/errors.js) carry a message written for people:
  // what is wrong with AI for this workspace and who can fix it.
  if (isAiErrorCode(error.data?.code)) {
    return aiErrorToast(error.data.code, error.message);
  }
  if (error.status >= 500) {
    return {
      title: 'Server error',
      message: isRead
        ? 'The request failed on the server. Try again in a moment.'
        : 'The action may not have completed. Check the current record before trying again.',
      duration: 0,
      action: retryAction,
    };
  }
  if (error.status === 403 && String(error.data?.code || '').startsWith('IMPERSONATION_')) {
    return { title: 'Read-only support view', message: error.message || 'Changes are not allowed while viewing as another person.' };
  }
  if (error.status >= 400) {
    return { title: 'Request failed', message: error.message || 'Please check your input and try again.' };
  }
  return null;
}
