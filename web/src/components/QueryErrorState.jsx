import Button from './ui/Button';

export function QueryErrorState({ onRetry, message = 'Failed to load data' }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-6 text-center">
      <p className="font-medium text-red-700 dark:text-red-300">{message}</p>
      <p className="text-sm text-red-600 dark:text-red-400 mt-1">
        Please check your connection and try again.
      </p>
      {onRetry && (
        <Button onClick={onRetry} className="mt-4" variant="outline">
          Retry
        </Button>
      )}
    </div>
  );
}

export default QueryErrorState;
