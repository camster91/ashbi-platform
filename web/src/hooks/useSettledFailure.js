import { useRef } from 'react';

/**
 * Whether a query's most recent settled outcome was a failure, plus that
 * failure's error.
 *
 * When TanStack Query refetches a query that has no data, it drops back to
 * `status: 'pending'` and clears `error`. `isError` therefore flickers off
 * during every retry or background refetch, which unmounts and remounts
 * error or partial notices and re-announces them. This stays true (and keeps
 * the last error) until a fetch actually succeeds.
 */
export default function useSettledFailure({ error, errorUpdatedAt = 0, dataUpdatedAt = 0 }) {
  const lastError = useRef(null);
  const failed = errorUpdatedAt > dataUpdatedAt;
  if (error) lastError.current = error;
  if (!failed) lastError.current = null;
  return { failed, error: failed ? lastError.current : null };
}
