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
