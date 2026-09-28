import { useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import ConfirmDialog from './ConfirmDialog';

export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 500;

/**
 * Admin action on the Team page: view the app as this team member or client
 * user (#416, docs/privileged-actions.md). Read-only, 30 minutes, needs a
 * written reason and recent re-authentication (the reauth prompt opens
 * automatically); the person is notified and it is recorded in the Activity
 * Log.
 */
export default function ImpersonateAction({ member }) {
  const { startImpersonation } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const fieldId = `impersonate-reason-${member.id}`;

  const close = () => {
    setOpen(false);
    setReason('');
    setError('');
  };

  const confirm = async () => {
    const text = reason.trim();
    setError('');
    if (text.length < IMPERSONATION_REASON_MIN) {
      setError(`Give a reason of at least ${IMPERSONATION_REASON_MIN} characters, for example a support ticket number.`);
      return;
    }
    if (text.length > IMPERSONATION_REASON_MAX) {
      setError(`Keep the reason under ${IMPERSONATION_REASON_MAX} characters.`);
      return;
    }
    setPending(true);
    try {
      await startImpersonation(member, text);
    } catch (err) {
      setError(err?.message || 'The support view could not be started.');
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View as ${member.name}`}
        title="View as (read only)"
        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Eye className="w-4 h-4" aria-hidden="true" />
      </button>
      <ConfirmDialog
        isOpen={open}
        title={`View as ${member.name}?`}
        description={`You will see the app as ${member.name} sees it, read only, for up to 30 minutes. Nothing can be changed while viewing. ${member.name} is notified with your reason, and the view is recorded in the Activity Log.`}
        confirmLabel="Start read-only view"
        destructive={false}
        onConfirm={confirm}
        onCancel={() => { if (!pending) close(); }}
        pending={pending}
        error={error}
      >
        <div className="mt-4">
          <label htmlFor={fieldId} className="block text-sm font-medium mb-1">Reason (shown to {member.name})</label>
          <textarea
            id={fieldId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={IMPERSONATION_REASON_MAX}
            required
            aria-describedby={`${fieldId}-hint`}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <p id={`${fieldId}-hint`} className="mt-1 text-xs text-muted-foreground">
            {IMPERSONATION_REASON_MIN} to {IMPERSONATION_REASON_MAX} characters, for example the support request you are investigating.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
