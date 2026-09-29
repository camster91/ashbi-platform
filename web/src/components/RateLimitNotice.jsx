// Non-blocking notice while the session check waits out a 429 (see
// useAuth: rate limiting is "retry later", never a sign-out).
export default function RateLimitNotice({ authState }) {
  if (authState?.reason !== 'rate_limited') return null;
  const seconds = Math.max(1, Math.round((authState.retryInMs || 0) / 1000));
  return (
    <p role="status" aria-live="polite" className="mx-auto my-2 w-fit rounded-full border border-warning/40 bg-warning/10 px-4 py-1.5 text-sm text-foreground">
      The server is busy. Retrying in {seconds}s; you have not been signed out.
    </p>
  );
}
