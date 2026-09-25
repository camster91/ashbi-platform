import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, setReauthHandler } from '../lib/api';
import Button from './ui/Button';
import Modal, { ModalFooter } from './Modal';

const fieldClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

/**
 * Step-up re-authentication prompt (#416, docs/privileged-actions.md).
 *
 * Asks for the password, or for a two-factor code (authenticator or recovery
 * code) when the account uses two-factor authentication, and calls
 * /auth/reauth. `onSuccess` runs once the server accepted it; `onCancel`
 * when the user dismisses the dialog. Built on Modal, so it is a labelled,
 * focus-trapped `role="dialog"`; errors are announced with `role="alert"`.
 */
export function ReauthDialog({ isOpen, onSuccess, onCancel }) {
  const [mfaEnabled, setMfaEnabled] = useState(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const fieldId = useId();
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setPassword('');
    setCode('');
    setUseRecovery(false);
    setError('');
    setMfaEnabled(null);
    // Staff accounts only; if the status cannot be read, offer the password
    // and let the server ask for a code instead (MFA_CODE_REQUIRED).
    api.request('/auth/mfa', { silent: true })
      .then((status) => { if (active) setMfaEnabled(Boolean(status?.enabled)); })
      .catch(() => { if (active) setMfaEnabled(false); });
    return () => { active = false; };
  }, [isOpen]);

  // Move focus to the field once the sign-in options are known, and after
  // switching between authenticator and recovery codes.
  useEffect(() => {
    if (isOpen && mfaEnabled !== null) inputRef.current?.focus();
  }, [isOpen, mfaEnabled, useRecovery]);

  const cancel = () => {
    if (pending) return;
    onCancel();
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError('');
    let body;
    if (mfaEnabled) {
      const value = useRecovery ? code.trim() : code.replace(/\s+/g, '');
      if (!useRecovery && !/^\d{6}$/.test(value)) { setError('Enter the 6-digit code from your authenticator app.'); return; }
      if (useRecovery && value.length < 16) { setError('Enter one of your recovery codes.'); return; }
      body = { code: value };
    } else {
      if (!password) { setError('Enter your password to continue.'); return; }
      body = { password };
    }
    setPending(true);
    try {
      await api.reauth(body);
      setPending(false);
      onSuccess();
    } catch (err) {
      setPending(false);
      if (err?.data?.code === 'MFA_CODE_REQUIRED') setMfaEnabled(true);
      setError(err?.message || 'We could not confirm your identity. Try again.');
      setPassword('');
      setCode('');
    }
  };

  const loading = mfaEnabled === null;
  const inputId = `${fieldId}-secret`;
  const helpId = `${fieldId}-help`;

  return (
    <Modal isOpen={isOpen} onClose={cancel} title="Confirm it’s you" size="sm" showCloseButton={!pending}>
      <form onSubmit={submit} noValidate>
        <p id={helpId} className="text-sm text-muted-foreground">
          {mfaEnabled
            ? 'This is a sensitive action. Enter a code from your authenticator app to continue.'
            : 'This is a sensitive action. Enter your password to continue.'}
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">Checking your sign-in options…</p>
        ) : (
          <div className="mt-4">
            {mfaEnabled ? (
              <>
                <label htmlFor={inputId} className="block text-sm font-medium mb-1">
                  {useRecovery ? 'Recovery code' : 'Authentication code'}
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete={useRecovery ? 'off' : 'one-time-code'}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-describedby={helpId}
                  aria-invalid={error ? true : undefined}
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
              </>
            ) : (
              <>
                <label htmlFor={inputId} className="block text-sm font-medium mb-1">Password</label>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={helpId}
                  aria-invalid={error ? true : undefined}
                  className={fieldClass}
                  required
                />
              </>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <ModalFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="outline" onClick={cancel} disabled={pending} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending} disabled={pending || loading} className="w-full sm:w-auto">
            Confirm
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * Mount once near the app root. Registers the API-layer handler so any
 * request answered with 403 REAUTH_REQUIRED opens the dialog and, after a
 * successful re-authentication, is retried once (web/src/lib/api.js).
 */
export function ReauthProvider({ children }) {
  const [open, setOpen] = useState(false);
  const resolver = useRef(null);

  const settle = useCallback((result) => {
    setOpen(false);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(result);
  }, []);

  useEffect(() => {
    setReauthHandler(() => new Promise((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    }));
    return () => {
      setReauthHandler(null);
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  return (
    <>
      {children}
      <ReauthDialog isOpen={open} onSuccess={() => settle(true)} onCancel={() => settle(false)} />
    </>
  );
}

export default ReauthDialog;
