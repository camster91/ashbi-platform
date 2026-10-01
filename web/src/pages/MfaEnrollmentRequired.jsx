import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import TwoFactorSettings from '../components/TwoFactorSettings';
import { Button } from '../components/ui';
import { MFA_ENROLLMENT_PATH } from '../lib/mfa-enrollment';

/**
 * Organization MFA requirement (docs/privileged-actions.md, "Organization MFA
 * requirement"). A staff member whose organization requires two-factor
 * authentication lands here until they set it up; the API refuses everything
 * else meanwhile (403 MFA_ENROLLMENT_REQUIRED). Enrolling lifts the
 * restriction for this same session, so the app continues without signing in
 * again.
 *
 * During a support view the requirement is the viewing admin's, and the view
 * blocks two-factor changes, so the page offers to stop viewing (the same
 * action as the support-view banner) and comes back here as the admin.
 */
export default function MfaEnrollmentRequired() {
  const { user, logout, completeMfaEnrollment, stopImpersonation } = useAuth();
  const headingRef = useRef(null);
  const [stopping, setStopping] = useState(false);
  const view = user?.impersonation;
  const viewedName = view?.subject?.name || 'this person';

  const stopViewing = async () => {
    if (stopping) return;
    setStopping(true);
    await stopImpersonation({ to: MFA_ENROLLMENT_PATH });
  };

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
          {view ? (
            <p className="text-sm text-muted-foreground">
              Your organization requires two-factor authentication for every staff account, including yours.
              You are viewing as {viewedName}, and two-factor settings cannot be changed during a support view.
              Stop viewing to set up two-factor authentication for your own account.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your organization requires two-factor authentication for every staff account.
              {user?.email ? ` Set it up for ${user.email} to continue.` : ' Set it up to continue.'}
              {' '}Until then, the rest of Ashbi Hub is unavailable to this account.
            </p>
          )}
        </div>

        {view ? (
          <Button type="button" onClick={stopViewing} disabled={stopping} aria-label={`Stop viewing as ${viewedName}`}>
            {stopping ? 'Stopping…' : 'Stop viewing'}
          </Button>
        ) : (
          <TwoFactorSettings onEnrolled={() => completeMfaEnrollment()} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Lost access to your authenticator later? Ask an administrator to reset it.</p>
          <Button type="button" variant="ghost" onClick={() => logout()}>Sign out</Button>
        </div>
      </section>
    </main>
  );
}
