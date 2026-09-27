// Decides whether a failed API request deserves a global toast, and which one.
//
// Reads (GETs are the only requests dispatched with a `retry`) back queries
// whose pages render their own inline error state (QueryErrorState and
// friends), so a failing background read must not also raise a toast — only a
// lost connection is global. Writes keep their toast because the user just
// acted and needs to know whether it happened. Returns null for "no toast".
export function apiErrorToast(error, retry) {
  if (!error || error.status === 401) return null;
  const isNetworkError = error.name === 'NetworkError';
  const isTimeout = error.name === 'TimeoutError';

  if (isNetworkError) {
    return {
      title: 'Network error',
      message: retry
        ? 'Check your connection. Pages will show what could not be loaded.'
        : 'Check your connection. Your action was not retried to avoid a duplicate change.',
      duration: 0,
      action: retry ? { label: 'Try again', onClick: retry } : undefined,
    };
  }
  if (retry) return null;
  if (isTimeout) {
    return {
      title: 'Request timed out',
      message: 'The result is uncertain, so the action was not retried. Check the page before trying again.',
      duration: 0,
    };
  }
  if (error.status >= 500) {
    return {
      title: 'Server error',
      message: 'The action may not have completed. Check the current record before trying again.',
      duration: 0,
    };
  }
  if (error.status >= 400) {
    return { title: 'Request failed', message: error.message || 'Please check your input and try again.' };
  }
  return null;
}
