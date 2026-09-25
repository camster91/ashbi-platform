import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import ConfirmDialog from './ConfirmDialog';

/**
 * Admin action on the Team page: reset (and unlock) another member's
 * two-factor authentication. The admin re-enters their own password; the
 * member is signed out everywhere and notified.
 */
export default function MfaResetAction({ member, onReset }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const reset = useMutation({
    mutationFn: () => api.adminResetMfa(member.id, password),
    onSuccess: () => {
      setOpen(false);
      setPassword('');
      setError('');
      onReset?.();
    },
    onError: (err) => setError(err.message || 'Two-factor authentication could not be reset.'),
  });

  const confirm = () => {
    setError('');
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    reset.mutate();
  };

  const close = () => {
    setOpen(false);
    setPassword('');
    setError('');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Reset two-factor authentication for ${member.name}`}
        title="Reset two-factor authentication"
        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShieldOff className="w-4 h-4" aria-hidden="true" />
      </button>
      <ConfirmDialog
        isOpen={open}
        title={`Reset two-factor authentication for ${member.name}?`}
        description={`This turns off two-factor authentication${member.mfaLocked ? ' and clears the lockout' : ''} for ${member.email}, deletes their recovery codes, and signs them out everywhere. They can set it up again from Settings. Only do this after confirming their identity.`}
        confirmLabel="Reset two-factor authentication"
        onConfirm={confirm}
        onCancel={close}
        pending={reset.isPending}
        error={error}
      >
        <div className="mt-4">
          <label htmlFor={`mfa-reset-password-${member.id}`} className="block text-sm font-medium mb-1">Your password</label>
          <input
            id={`mfa-reset-password-${member.id}`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            required
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
