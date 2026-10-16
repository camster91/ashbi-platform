import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, LoadingState } from '../components/ui';

const OPTIONAL_ACCESS = {
  'workspace:client-tasks:write': 'Create client task proposals and confirm them',
  'workspace:service-reports:publish': 'Publish saved client reports, including replacement or removal',
};

function ConsentRequest({ state }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState([]);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    let current = true;
    alive.current = true;
    setPreview(null);
    setError('');
    api.getMcpConsent(state).then(result => { if (current) setPreview(result); })
      .catch(() => { if (current) setError('This connection request is unavailable or has expired. Start again from ChatGPT.'); });
    return () => { current = false; alive.current = false; };
  }, [state]);
  const options = Object.entries(OPTIONAL_ACCESS).filter(([scope]) => preview?.requestedScopes?.includes(scope)
    && preview?.optionalScopes?.some(option => option.scope === scope));
  const selectedOptions = options.filter(([scope]) => selected.includes(scope));
  const hasActions = selectedOptions.length > 0;
  async function respond(approved) {
    if (busy.current || !preview) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = await api.respondMcpConsent({ state, nonce: preview.nonce, approved,
        ...(approved && options.length ? { scopes: ['workspace:read', ...selectedOptions.map(([scope]) => scope)] } : {}) });
      if (!alive.current) return;
      // Only the published ChatGPT callback is a valid exit from this page.
      const target = new URL(result.redirect);
      if (target.origin !== 'https://chatgpt.com' || target.pathname !== '/connector_platform_oauth_redirect') throw new Error('Invalid callback');
      window.location.assign(target.href);
    } catch {
      if (!alive.current) return;
      setError('The connection could not be completed. Start again from ChatGPT, or retry if you cancelled password confirmation.');
      setPending(false);
      busy.current = false;
    }
  }
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg p-6 space-y-5">
        <h1 className="text-2xl font-semibold">Connect ChatGPT to Ashbi</h1>
        {!preview && !error && <LoadingState label="Checking connection request…" />}
        {preview && <>
          <p>Signed in as <strong className="break-all">{preview.accountEmail}</strong></p>
          <p>ChatGPT will be able to read projects, clients and tasks in your Ashbi workspace.{!hasActions && ' It cannot create, change, send or delete records through this connection.'}</p>
          {options.length > 0 && <fieldset className="space-y-3" disabled={pending}>
            <legend className="font-medium">Optional actions requested by this connection</legend>
            <p className="text-sm text-muted-foreground">Leave these unchecked for read-only access. Existing connections remain read-only.</p>
            {options.map(([scope, label]) => <label key={scope} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={selected.includes(scope)} onChange={event => setSelected(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))} />{label}
            </label>)}
          </fieldset>}
          {hasActions && <div className="space-y-2 text-sm" role="status">
            <p>Selected actions:</p><ul className="list-disc pl-5">{selectedOptions.map(([scope, label]) => <li key={scope}>{label}</li>)}</ul>
            <p>ChatGPT or another authorized API caller can review a preview and call confirm_action. This does not require a new human click in Ashbi for each action.</p>
            <p>These permissions do not enable email sending or external provider actions.</p>
          </div>}
          <p className="text-sm text-muted-foreground">Access lasts up to 30 days. Revoke “{hasActions ? 'ChatGPT (scoped MCP actions)' : 'ChatGPT (read-only MCP)'}” at any time in Settings → API Keys. Signing out of Ashbi, changing your password or changing account access also ends this connection.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => respond(true)} loading={pending} disabled={pending}>{hasActions ? 'Allow selected access' : 'Allow read-only access'}</Button>
            <Button variant="secondary" onClick={() => respond(false)} disabled={pending}>Cancel connection</Button>
          </div>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Link className="inline-block underline text-sm" to="/settings">Back to Settings</Link>
      </Card>
    </main>
  );
}

export default function ConnectChatGPT() {
  const [params] = useSearchParams();
  const state = params.get('state') || '';
  return <ConsentRequest key={state} state={state} />;
}
