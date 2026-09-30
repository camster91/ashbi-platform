import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LoadingState } from './ui';
import QueryErrorState from './QueryErrorState';
import ConfirmDialog from './ConfirmDialog';

// Organization MFA requirement (docs/privileged-actions.md, "Organization MFA
// requirement"). Admins only. Changing it asks for step-up re-authentication
// (handled centrally by the API client); turning it on is refused until the
// admin has two-factor authentication on their own account.

const QUERY_KEY = ['mfa-requirement'];
// The signed-in person's own two-factor status, fetched by TwoFactorSettings
// (Settings → Security, above this section).
const OWN_MFA_QUERY_KEY = ['mfa-status'];

function staffSummary(count) {
  if (!count) return 'Every active staff member has two-factor authentication on.';
  return count === 1
    ? '1 active staff member has not set up two-factor authentication.'
    : `${count} active staff members have not set up two-factor authentication.`;
}

function errorMessage(error) {
  if (!error) return null;
  if (error.data?.code === 'MFA_SELF_ENROLLMENT_REQUIRED') {
    return 'Turn on two-factor authentication for your own account (above) before requiring it for everyone.';
  }
  return error.message || 'The setting could not be changed. Try again.';
}

export default function OrganizationMfaPolicy() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.getMfaRequirement() });
  const change = useMutation({
    mutationFn: (required) => api.setMfaRequirement(required),
    onSuccess: (policy) => queryClient.setQueryData(QUERY_KEY, policy),
  });
  // Observe (never fetch) the admin's own two-factor status. When it changes,
  // for example once they finish enrolling above, refetch the policy so the
  // "set up your own first" hint and the count of staff without two-factor
  // are current.
  const { data: ownMfa } = useQuery({ queryKey: OWN_MFA_QUERY_KEY, queryFn: () => api.getMfaStatus(), enabled: false });
  const ownEnabled = ownMfa?.enabled;
  const previousOwnEnabled = useRef(ownEnabled);
  useEffect(() => {
    const previous = previousOwnEnabled.current;
    previousOwnEnabled.current = ownEnabled;
    if (typeof previous === 'boolean' && typeof ownEnabled === 'boolean' && previous !== ownEnabled) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }, [ownEnabled, queryClient]);

  if (isLoading) return <LoadingState label="Loading organization security…" compact className="justify-start" size="sm" />;
  if (error) return <QueryErrorState error={error} message="Failed to load the two-factor requirement" onRetry={refetch} isRetrying={isFetching} />;

  const required = data?.required === true;
  const onToggle = () => {
    change.reset();
    if (required) change.mutate(false);
    else setConfirmOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="org-mfa-label" className="text-sm font-medium text-foreground">Require two-factor authentication for all staff</p>
          <p id="org-mfa-help" className="mt-1 text-sm text-muted-foreground">
            Staff without it can still sign in, but can only set it up until they do. Client portal users are not affected.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={required}
          aria-labelledby="org-mfa-label"
          aria-describedby="org-mfa-help org-mfa-status"
          aria-busy={change.isPending || undefined}
          disabled={change.isPending}
          onClick={onToggle}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors motion-reduce:transition-none ${required ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${required ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </div>

      <p id="org-mfa-status" role="status" className="text-sm text-foreground">
        {required ? 'Required for all staff. ' : 'Optional. '}
        {staffSummary(data?.staffWithoutMfa)}
      </p>
      {!required && data?.actorMfaEnabled === false && (
        <p className="text-sm text-muted-foreground">Set up two-factor authentication for your own account first; it is needed to turn this on.</p>
      )}
      {change.error && <p role="alert" className="text-sm text-destructive">{errorMessage(change.error)}</p>}

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Require two-factor authentication?"
        description={`${staffSummary(data?.staffWithoutMfa)} Until they set it up, they will only be able to set up two-factor authentication or sign out. You will be asked to confirm your identity.`}
        confirmLabel="Require two-factor"
        destructive={false}
        onConfirm={() => { setConfirmOpen(false); change.mutate(true); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
