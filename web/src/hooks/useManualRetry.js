import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks a user-initiated retry separately from background fetching.
 *
 * `isFetching` also turns true for polling and automatic refetches. Using it
 * as a "Retrying…" flag toggles the retry control and re-announces live
 * regions on every poll. This flag is set only when the person clicks retry
 * and clears when that refetch settles. Repeated clicks while one is in flight
 * are ignored.
 */
export default function useManualRetry(refetch) {
  const [isRetrying, setIsRetrying] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const retry = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRetrying(true);
    try {
      await refetch();
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsRetrying(false);
    }
  }, [refetch]);

  return [retry, isRetrying];
}
