import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card } from './ui';

const END_LABELS = {
  stopped: 'Stopped',
  expired: 'Expired',
  superseded: 'Replaced by another view',
  signed_out: 'Admin signed out',
  revoked_password_reset: 'Ended by a password reset',
  revoked_password_change: 'Ended by a password change',
  revoked_role_change: 'Ended by a role change',
  revoked_deactivated: 'Ended by deactivation',
};

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * Recent read-only support views in this organization, with who looked,
 * whose account, why, and how each view ended (#416). Admins only.
 */
export default function SupportAccessLog() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['impersonation-sessions'],
    queryFn: () => api.getImpersonationSessions(),
  });
  const sessions = data?.sessions ?? [];

  return (
    <section aria-labelledby="support-access-title">
      <h2 id="support-access-title" className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Support views</h2>
      <Card className="p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading support views…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">Support views could not be loaded.</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No administrator has viewed the app as anyone yet. Each view is read only, limited to 30 minutes and announced to the person viewed.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {sessions.map((session) => (
              <li key={session.id} className="py-2">
                <p className="text-foreground">
                  <span className="font-medium">{session.actor?.name || 'An administrator'}</span>
                  {' viewed as '}
                  <span className="font-medium">{session.subject?.name || 'a former member'}</span>
                  {' · '}
                  {session.active ? <span className="font-medium">Active now</span> : (END_LABELS[session.endReason] || 'Ended')}
                </p>
                <p className="text-xs text-muted-foreground">{when(session.startedAt)} · {session.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
