import Button from './ui/Button';

export function getQueryErrorGuidance(error, online = typeof navigator === 'undefined' || navigator.onLine) {
  if (!online || error?.name === 'NetworkError') {
    return { title: 'You are offline', detail: 'Reconnect to the internet, then retry. Your current page input has not been cleared.' };
  }
  const status = error?.status;
  if (status === 401) return { title: 'Your session ended', detail: 'Sign in again, then return to this page.' };
  if (status === 403) return { title: 'You do not have access', detail: 'Ask an administrator for the required role or return to a permitted page.' };
  if (status === 404) return { title: 'This item is no longer available', detail: 'It may have been moved or deleted. Return to the list and refresh it.' };
  if (status === 409) return { title: 'A newer change already exists', detail: 'Refresh the latest version before retrying so you do not overwrite someone else’s work.' };
  if (status === 422) return { title: 'Some information needs attention', detail: 'Review the highlighted fields. Your entered values are still available.' };
  if (status === 429) return { title: 'Too many requests', detail: 'Wait a moment before retrying. Repeated clicks will not make this finish sooner.' };
  if (status >= 500) return { title: 'The service could not complete this request', detail: 'Your input has not been cleared. Retry once; if it still fails, keep the page open and share the error details.' };
  return { title: 'This data could not be loaded', detail: 'Retry the request. Your current page input has not been cleared.' };
}

export function QueryErrorState({ onRetry, error, message, isRetrying = false }) {
  const guidance = getQueryErrorGuidance(error);
  return (
    <div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-6 text-center">
      <p className="font-medium text-red-700 dark:text-red-300">{message || guidance.title}</p>
      <p className="text-sm text-red-600 dark:text-red-400 mt-1">
        {guidance.detail}
      </p>
      {onRetry && (
        <Button onClick={onRetry} className="mt-4" variant="outline" disabled={isRetrying}>
          {isRetrying ? 'Retrying…' : 'Retry'}
        </Button>
      )}
    </div>
  );
}

export default QueryErrorState;
