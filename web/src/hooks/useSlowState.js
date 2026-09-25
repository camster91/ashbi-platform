import { useEffect, useState } from 'react';

/**
 * Milliseconds a read or write may stay pending before the UI switches to the
 * "Slow" workflow state (docs/workflow-state-matrix.md). Long enough that
 * normal requests never flash the message, short enough that people are told
 * something is still happening before they give up or click again.
 */
export const SLOW_THRESHOLD_MS = 8000;

/**
 * Returns true once `active` has stayed truthy for `thresholdMs`.
 * Resets as soon as `active` becomes falsy. Pass `false`/`0` to disable.
 */
export default function useSlowState(active, thresholdMs = SLOW_THRESHOLD_MS) {
  const [slow, setSlow] = useState(false);
  const enabled = Boolean(active) && typeof thresholdMs === 'number' && thresholdMs > 0;

  useEffect(() => {
    if (!enabled) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), thresholdMs);
    return () => clearTimeout(timer);
  }, [enabled, thresholdMs]);

  return enabled && slow;
}
