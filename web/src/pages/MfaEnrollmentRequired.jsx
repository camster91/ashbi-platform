import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import TwoFactorSettings from '../components/TwoFactorSettings';
import { Button } from '../components/ui';

/**
 * Organization MFA requirement (docs/privileged-actions.md, "Organization MFA
 * requirement"). A staff member whose organization requires two-factor
 * authentication lands here until they set it up; the API refuses everything
 * else meanwhile (403 MFA_ENROLLMENT_REQUIRED). Enrolling lifts the
 * restriction for this same session, so the app continues without signing in
 * again.
 */
export default function MfaEnrollmentRequired() {
  const { user, logout, completeMfaEnrollment } = useAuth();
  const headingRef = useRef(null);

  // Move focus to the explanation: the person was sent here, often from
  // another screen, and should hear why.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Nothing to do here for someone the requirement does not restrict.
  if (user && !user.mfaEnrollmentRequired) return <Navigate to="/settings" replace />;

  return (
    <main className="flex min-h-screen items-start justify-center bg-background p-4 sm:items-center">
      <section className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm" aria-labelledby="mfa-required-title">
        <div className="space-y-2">
          <h1
            id="mfa-required-title"
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-2xl font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />
            Set up two-factor authentication
          </h1>
          <p className="text-sm text-muted-foreground">
            Your organization requires two-factor authentication for every staff account.
            {user?.email ? ` Set it up for ${user.email} to continue.` : ' Set it up to continue.'}
            {' '}Until then, the rest of Ashbi Hub is unavailable to this account.
          </p>
        </div>

        <TwoFactorSettings onEnrolled={() => completeMfaEnrollment()} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Lost access to your authenticator later? Ask an administrator to reset it.</p>
          <Button type="button" variant="ghost" onClick={() => logout()}>Sign out</Button>
        </div>
      </section>
    </main>
  );
}
