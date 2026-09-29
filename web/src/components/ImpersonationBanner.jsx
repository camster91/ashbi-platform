import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const TICK_MS = 15_000;

function minutesLeft(expiresAt, now) {
  const remaining = new Date(expiresAt).getTime() - now;
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 60_000)) : 0;
}

/**
 * Persistent banner while an administrator views the app as another person
 * (#416, docs/privileged-actions.md). Sticky at the top of every page,
 * including the client portal, with the remaining time and a Stop button.
 * When the window runs out it ends the view and returns to the Team page.
 */
export default function ImpersonationBanner() {
  const { user, stopImpersonation } = useAuth();
  const view = user?.impersonation;
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!view) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [view]);

  const minutes = view ? minutesLeft(view.expiresAt, now) : 0;
  const expired = Boolean(view) && new Date(view.expiresAt).getTime() <= now;

  useEffect(() => {
    if (!expired || endedRef.current) return;
    endedRef.current = true;
    setStopping(true);
    stopImpersonation();
  }, [expired, stopImpersonation]);

  if (!view) return null;
  const name = view.subject?.name || 'this person';

  const stop = async () => {
    if (stopping) return;
    endedRef.current = true;
    setStopping(true);
    await stopImpersonation();
  };

  return (
    <div
      role="region"
      aria-label="Support view"
      data-testid="impersonation-banner"
      className="sticky top-0 z-[70] w-full border-b border-warning bg-warning text-warning-foreground shadow-sm"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Viewing as {name}</strong>
          <span aria-hidden="true"> — </span>
          <span className="sr-only">, </span>
          read only
          <span aria-hidden="true"> — </span>
          <span className="sr-only">, </span>
          {expired ? 'ending now' : `ends in ${minutes} min`}
        </p>
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          aria-label={`Stop viewing as ${name}`}
          className="min-h-11 rounded-full border border-current bg-background px-4 py-1.5 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>
    </div>
  );
}
