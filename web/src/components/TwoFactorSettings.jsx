import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Copy, Download, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';
import { Button, LoadingState } from './ui';

const fieldClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

export function formatSecret(secret) {
  return (secret || '').replace(/(.{4})/g, '$1 ').trim();
}

function RecoveryCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false);
  const text = `Ashbi Hub recovery codes\nEach code can be used once.\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ashbi-hub-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div role="status" className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm text-foreground">
        <p className="font-medium flex items-center gap-1"><CheckCircle className="w-4 h-4" aria-hidden="true" /> Two-factor authentication is on.</p>
        <p className="mt-1">Save these recovery codes somewhere safe. Each code signs you in once if you lose your authenticator. They will not be shown again. Other sessions were signed out.</p>
      </div>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={copy} leftIcon={<Copy className="w-4 h-4" />}>Copy codes</Button>
        <Button type="button" variant="outline" onClick={download} leftIcon={<Download className="w-4 h-4" />}>Download codes</Button>
        <Button type="button" onClick={onDone}>I have saved my codes</Button>
        {copied && <span role="status" className="text-sm text-green-600">Copied</span>}
      </div>
    </div>
  );
}

function Enrollment({ onEnabled }) {
  const [enrollment, setEnrollment] = useState(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const start = useMutation({
    mutationFn: (value) => api.startMfaEnrollment(value),
    onSuccess: (data) => { setEnrollment(data); setPassword(''); setCode(''); setError(''); },
    onError: (err) => setError(err.message || 'Two-factor setup could not start. Try again.'),
  });
  const confirm = useMutation({
    mutationFn: (value) => api.confirmMfaEnrollment(value),
    onSuccess: (data) => onEnabled(data.recoveryCodes),
    onError: (err) => { setError(err.message || 'That code did not match.'); setCode(''); },
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const value = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code shown in your authenticator app.');
      return;
    }
    confirm.mutate(value);
  };

  if (!enrollment) {
    const begin = (e) => {
      e.preventDefault();
      setError('');
      if (!password) { setError('Enter your current password to continue.'); return; }
      start.mutate(password);
    };
    return (
      <form onSubmit={begin} className="space-y-3" aria-label="Set up two-factor authentication">
        <p className="text-sm text-muted-foreground">
          Add a second step to sign-in using an authenticator app such as 1Password, Google Authenticator, or Microsoft Authenticator.
        </p>
        <div>
          <label htmlFor="mfa-enroll-password" className="block text-sm font-medium mb-1">Current password</label>
          <input
            id="mfa-enroll-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'mfa-start-error' : undefined}
          />
        </div>
        {error && <p id="mfa-start-error" role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={start.isPending} leftIcon={<ShieldCheck className="w-4 h-4" />}>
          Set up two-factor authentication
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Confirm two-factor authentication">
      <ol className="list-decimal pl-5 space-y-3 text-sm">
        <li>
          Add Ashbi Hub to your authenticator app.{' '}
          <a href={enrollment.otpauthUri} className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            Open in authenticator app
          </a>{' '}
          on this device, or enter this setup key manually:
          <p className="mt-2">
            <span className="sr-only">Setup key: </span>
            <code data-testid="mfa-setup-key" className="inline-block rounded bg-muted px-2 py-1 font-mono text-sm break-all">{formatSecret(enrollment.secret)}</code>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Time-based, 6 digits, 30 seconds. Keep this key private.</p>
        </li>
        <li>
          <label htmlFor="mfa-enroll-code" className="block font-medium mb-1">Enter the 6-digit code from the app</label>
          <input
            id="mfa-enroll-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9 ]*"
            maxLength={7}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${fieldClass} w-40 font-mono tracking-widest`}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'mfa-enroll-error' : undefined}
          />
        </li>
      </ol>
      {error && <p id="mfa-enroll-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={confirm.isPending}>Turn on two-factor authentication</Button>
        <Button type="button" variant="ghost" onClick={() => { setEnrollment(null); setError(''); }}>Cancel</Button>
      </div>
    </form>
  );
}

function DisableForm({ onDisabled }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');

  const disable = useMutation({
    mutationFn: (body) => api.disableMfa(body),
    onSuccess: () => { setPassword(''); setCode(''); onDisabled(); },
    onError: (err) => { setError(err.message || 'Two-factor authentication could not be turned off.'); setCode(''); },
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const value = useRecovery ? code.trim() : code.replace(/\s+/g, '');
    if (!password) { setError('Enter your current password.'); return; }
    if (!useRecovery && !/^\d{6}$/.test(value)) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    if (useRecovery && value.length < 16) { setError('Enter one of your recovery codes.'); return; }
    disable.mutate(useRecovery ? { password, recoveryCode: value } : { password, code: value });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-border pt-4" aria-label="Turn off two-factor authentication">
      <p className="text-sm text-muted-foreground">Turning this off signs out your other sessions.</p>
      <div>
        <label htmlFor="mfa-disable-password" className="block text-sm font-medium mb-1">Current password</label>
        <input
          id="mfa-disable-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldClass}
          required
        />
      </div>
      <div>
        <label htmlFor="mfa-disable-code" className="block text-sm font-medium mb-1">
          {useRecovery ? 'Recovery code' : 'Authentication code'}
        </label>
        <input
          id="mfa-disable-code"
          type="text"
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete={useRecovery ? 'off' : 'one-time-code'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${fieldClass} font-mono`}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'mfa-disable-error' : undefined}
        />
        <button
          type="button"
          onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}
          className="mt-1 min-h-11 text-sm text-primary hover:text-primary/80 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </div>
      {error && <p id="mfa-disable-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="destructive" loading={disable.isPending} leftIcon={<ShieldOff className="w-4 h-4" />}>
        Turn off two-factor authentication
      </Button>
    </form>
  );
}

/** Settings → Security: optional TOTP two-factor authentication for staff. */
export default function TwoFactorSettings() {
  const queryClient = useQueryClient();
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [notice, setNotice] = useState('');
  const { data: status, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => api.getMfaStatus(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mfa-status'] });

  if (recoveryCodes) {
    return <RecoveryCodes codes={recoveryCodes} onDone={() => { setRecoveryCodes(null); refresh(); }} />;
  }
  if (isLoading) return <LoadingState label="Loading security settings…" compact />;
  if (error) {
    return <QueryErrorState error={error} onRetry={refetch} isRetrying={isFetching} />;
  }

  if (!status?.enabled) {
    return (
      <div className="space-y-3">
        {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}
        <p className="text-sm"><span className="font-medium">Two-factor authentication:</span> Off</p>
        <Enrollment onEnabled={(codes) => { setNotice(''); setRecoveryCodes(codes); }} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm flex items-center gap-1">
        <ShieldCheck className="w-4 h-4 text-green-600" aria-hidden="true" />
        <span className="font-medium">Two-factor authentication:</span> On
        {status.enabledAt && <span className="text-muted-foreground"> since {new Date(status.enabledAt).toLocaleDateString()}</span>}
      </p>
      <p className="text-sm text-muted-foreground">
        API keys you already created keep working with two-factor authentication on. Revoke any you no longer need under API Keys below.
      </p>
      <p className="text-sm text-muted-foreground">
        {status.recoveryCodesRemaining} of 10 recovery codes remaining.
        {status.recoveryCodesRemaining <= 3 && ' Turn two-factor authentication off and on again to get new codes.'}
      </p>
      <DisableForm onDisabled={() => { setNotice('Two-factor authentication is off. Other sessions were signed out.'); refresh(); }} />
    </div>
  );
}
