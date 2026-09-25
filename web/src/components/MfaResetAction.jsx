import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import ConfirmDialog from './ConfirmDialog';

const fieldClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

/**
 * Admin action on the Team page: reset (and unlock) another member's
 * two-factor authentication. The admin re-enters their own password and,
 * when their own account uses two-factor authentication, a code as well.
 * The member is signed out everywhere and notified.
 */
export default function MfaResetAction({ member, onReset }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');

  // The admin's own MFA status decides whether a code is required.
  const { data: ownStatus } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => api.getMfaStatus(),
    enabled: open,
  });
  const [serverNeedsCode, setServerNeedsCode] = useState(false);
  const needsCode = Boolean(ownStatus?.enabled) || serverNeedsCode;

  const reset = useMutation({
    mutationFn: (body) => api.adminResetMfa(member.id, body),
    onSuccess: () => {
      close();
      onReset?.();
    },
    onError: (err) => {
      if (err?.data?.code === 'MFA_CODE_REQUIRED') setServerNeedsCode(true);
      setError(err.message || 'Two-factor authentication could not be reset.');
      setCode('');
    },
  });

  function close() {
    setOpen(false);
    setPassword('');
    setCode('');
    setUseRecovery(false);
    setError('');
  }

  const confirm = () => {
    setError('');
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    const body = { password };
    if (needsCode) {
      const value = useRecovery ? code.trim() : code.replace(/\s+/g, '');
      if (!useRecovery && !/^\d{6}$/.test(value)) { setError('Enter the 6-digit code from your authenticator app.'); return; }
      if (useRecovery && value.length < 16) { setError('Enter one of your recovery codes.'); return; }
      if (useRecovery) body.recoveryCode = value; else body.code = value;
    }
    reset.mutate(body);
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
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={`mfa-reset-password-${member.id}`} className="block text-sm font-medium mb-1">Your password</label>
            <input
              id={`mfa-reset-password-${member.id}`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
              required
            />
          </div>
          {needsCode && (
            <div>
              <label htmlFor={`mfa-reset-code-${member.id}`} className="block text-sm font-medium mb-1">
                {useRecovery ? 'Your recovery code' : 'Your authentication code'}
              </label>
              <input
                id={`mfa-reset-code-${member.id}`}
                type="text"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete={useRecovery ? 'off' : 'one-time-code'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${fieldClass} font-mono`}
                required
              />
              <button
                type="button"
                onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}
                className="mt-1 min-h-11 text-sm text-primary hover:text-primary/80 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
              </button>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
