import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from '../components/ui';

const fieldClass = 'w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Read the token from the URL fragment (never sent to the server or logged). */
export function tokenFromHash(hash) {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]{20,200})(?:&|$)/.exec(hash || '');
  return match ? match[1] : null;
}

/**
 * Break-glass administrator recovery (#416,
 * docs/privileged-actions.md#break-glass-administrator-recovery). A platform
 * operator gives the verified administrator a single-use, 30-minute link;
 * redeeming it sets a new password, turns two-factor authentication off (to
 * be set up again after signing in) and signs every other session out.
 */
export default function BreakGlass() {
  const [token, setToken] = useState(() => tokenFromHash(typeof window === 'undefined' ? '' : window.location.hash));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(null);

  // Drop the token from the address bar and history once read.
  useEffect(() => {
    if (token && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setPending(true);
    try {
      const result = await api.redeemBreakGlass(token, password);
      setDone(result);
      setToken(null);
    } catch (err) {
      setError(err?.status === 404
        ? 'Emergency access is not enabled on this server. Contact your platform operator.'
        : (err?.message || 'This emergency access link could not be used.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-md space-y-6" aria-labelledby="break-glass-title">
        <div className="space-y-2 text-center">
          <h1 id="break-glass-title" className="text-2xl font-semibold text-foreground">Restore administrator access</h1>
          <p className="text-sm text-muted-foreground">
            This single-use link was issued by a platform operator after verifying your identity. It expires 30 minutes after it was issued.
          </p>
        </div>

        {done ? (
          <div role="status" className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm text-foreground">
            <p className="font-medium">Your password was changed and your other sessions were signed out.</p>
            {done.mfaReset && <p>Two-factor authentication was turned off. Set it up again in Settings right after you sign in.</p>}
            <p>Your organization&apos;s administrators were notified, and the recovery is recorded in the Activity Log.</p>
            <Link to="/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign in</Link>
          </div>
        ) : !token ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-5 text-sm text-foreground">
            This emergency access link is missing its token or was already opened. Ask your platform operator for a new link.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1">
              <label htmlFor="break-glass-password" className="text-sm font-medium text-foreground">New password</label>
              <input id="break-glass-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} required minLength={8} />
            </div>
            <div className="space-y-1">
              <label htmlFor="break-glass-confirm" className="text-sm font-medium text-foreground">Confirm new password</label>
              <input id="break-glass-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fieldClass} required minLength={8} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" loading={pending}>Restore access</Button>
          </form>
        )}
      </section>
    </main>
  );
}
