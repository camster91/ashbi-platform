import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, LoadingState } from '../components/ui';

export default function ConnectChatGPT() {
  const [params] = useSearchParams();
  const state = params.get('state') || '';
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let current = true;
    setPreview(null);
    setError('');
    api.getMcpConsent(state).then(result => { if (current) setPreview(result); })
      .catch(() => { if (current) setError('This connection request is unavailable or has expired. Start again from ChatGPT.'); });
    return () => { current = false; };
  }, [state]);
  async function respond(approved) {
    setPending(true);
    setError('');
    try {
      const result = await api.respondMcpConsent({ state, nonce: preview.nonce, approved });
      // Only the published ChatGPT callback is a valid exit from this page.
      const target = new URL(result.redirect);
      if (target.origin !== 'https://chatgpt.com' || target.pathname !== '/connector_platform_oauth_redirect') throw new Error('Invalid callback');
      window.location.assign(target.href);
    } catch {
      setError('The connection could not be completed. Start again from ChatGPT, or retry if you cancelled password confirmation.');
      setPending(false);
    }
  }
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg p-6 space-y-5">
        <h1 className="text-2xl font-semibold">Connect ChatGPT to Ashbi</h1>
        {!preview && !error && <LoadingState label="Checking connection request…" />}
        {preview && <>
          <p>Signed in as <strong className="break-all">{preview.accountEmail}</strong></p>
          <p>ChatGPT will be able to read projects, clients and tasks in your Ashbi workspace. It cannot create, change, send or delete records through this connection.</p>
          <p className="text-sm text-muted-foreground">Access lasts up to 30 days. Revoke “ChatGPT (read-only MCP)” at any time in Settings → API Keys. Changing your password or account access also ends this connection.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => respond(true)} loading={pending} disabled={pending}>Allow read-only access</Button>
            <Button variant="secondary" onClick={() => respond(false)} disabled={pending}>Cancel connection</Button>
          </div>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Link className="inline-block underline text-sm" to="/settings">Back to Settings</Link>
      </Card>
    </main>
  );
}
