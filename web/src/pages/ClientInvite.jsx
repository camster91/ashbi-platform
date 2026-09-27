import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui';

// Landing page for the client invitation email (`/client/invite?token=…`).
// The invitee confirms the invited email address and chooses a password;
// the server derives the client and organization from the token, creates the
// client account and signs a client-portal session, then we hand off to the
// existing client portal.
const inputClass =
  'w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:bg-card';

export default function ClientInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/client/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(inviteErrorMessage(res.status, data.error));
      }
      window.location.assign('/client-portal');
    } catch (err) {
      setError(err.message || 'We could not accept this invitation. Try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-heading font-bold">Accept your invitation</h1>
          <p className="text-muted-foreground">
            Create a password to open your client portal, where you can follow project progress, review files and message the team.
          </p>
        </div>

        {!token ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-medium">This invitation link is incomplete.</p>
            <p className="mt-1 text-muted-foreground">Open the link from your invitation email again, or ask your project contact to resend it.</p>
            <Link to="/client-portal" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
              Already have access? Sign in to the client portal
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6" noValidate>
            <div className="space-y-2">
              <label htmlFor="invite-email" className="text-sm font-medium">Email address</label>
              <input
                id="invite-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                aria-describedby="invite-email-hint"
              />
              <p id="invite-email-hint" className="text-xs text-muted-foreground">Use the address the invitation was sent to.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="invite-password" className="text-sm font-medium">Password</label>
              <input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                aria-describedby="invite-password-hint"
              />
              <p id="invite-password-hint" className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="invite-confirm" className="text-sm font-medium">Confirm password</label>
              <input
                id="invite-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting || !email || !password}>
              {isSubmitting ? 'Creating your account…' : 'Create account and open portal'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already set up?{' '}
              <Link to="/client-portal" className="font-medium text-primary underline underline-offset-4">Sign in to the client portal</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

function inviteErrorMessage(status, serverMessage) {
  if (status === 404) return 'This invitation link is not valid. Ask your project contact to send a new one.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status === 400 && typeof serverMessage === 'string') {
    if (/expired/i.test(serverMessage)) return 'This invitation has expired. Ask your project contact to send a new one.';
    if (/already used/i.test(serverMessage)) return 'This invitation has already been used. Sign in to the client portal instead.';
    if (/does not match/i.test(serverMessage)) return 'That email address does not match the invitation. Use the address the invitation was sent to.';
    if (/already exists/i.test(serverMessage)) return 'An account already exists for this email. Sign in to the client portal instead.';
  }
  return 'We could not accept this invitation. Try again in a moment.';
}
