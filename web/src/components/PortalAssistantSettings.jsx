import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import Button from './ui/Button';
import { inputStyles } from './ui/Input';

const valid = value => value && typeof value.enabled === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0
  && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 80 && typeof value.instructions === 'string' && value.instructions.length <= 2000;
function Settings({ clientId }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(false), [conflict, setConflict] = useState(false), [notice, setNotice] = useState('');
  const active = useRef(true), busy = useRef(false), field = useId();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function load() {
    if (busy.current) return; busy.current = true; setLoading(true);
    try { const result = await api.getPortalAssistantConfig(clientId); if (active.current) { if (!valid(result)) throw Error('Invalid config'); setDraft(result); setError(false); setConflict(false); setNotice(''); } }
    catch { if (active.current) { setDraft(null); setError(true); } }
    finally { if (active.current) { busy.current = false; setLoading(false); } }
  }
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(event) {
    event.preventDefault(); if (busy.current || conflict || error || !valid(draft)) return;
    busy.current = true; setLoading(true); setNotice('');
    try {
      const result = await api.updatePortalAssistantConfig(clientId, { revision: draft.revision, enabled: draft.enabled, name: draft.name.trim(), instructions: draft.instructions });
      if (active.current) { if (!valid(result)) throw Error('Invalid config'); setDraft(result); setNotice('Portal assistant settings saved. No reply was generated.'); }
    } catch (failure) { if (active.current) { setConflict(true); setNotice(failure.status === 409 ? 'Settings changed. Your draft is retained. Reload before saving again.' : 'The save could not be confirmed. Your draft is retained. Reload the saved settings before continuing.'); } }
    finally { if (active.current) { busy.current = false; setLoading(false); } }
  }
  const edit = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  return <details className="rounded-lg border border-border p-3" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-medium">Client portal AI settings</summary>
    {open && <div className="space-y-3 pt-3"><p className="text-sm text-muted-foreground">Separate from the staff account manager. Disabled by default. Clients receive project answers only after they send a message; no tools or automatic human requests.</p>
      {loading && <p role="status">Checking portal settings…</p>}{error && <p role="alert">Portal settings could not be read. Cached instructions are hidden.</p>}
      {draft && !error && <form onSubmit={save} className="space-y-3"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.enabled} disabled={loading || conflict} onChange={event => edit('enabled', event.target.checked)} />Enable client portal AI assistant</label>
        <div><label htmlFor={`${field}-name`}>Portal assistant name</label><input id={`${field}-name`} className={inputStyles()} maxLength={80} value={draft.name} required disabled={loading || conflict} onChange={event => edit('name', event.target.value)} /></div>
        <div><label htmlFor={`${field}-instructions`}>Portal assistant instructions</label><textarea id={`${field}-instructions`} className={inputStyles('min-h-24')} maxLength={2000} value={draft.instructions} disabled={loading || conflict} onChange={event => edit('instructions', event.target.value)} /><p className="text-xs text-muted-foreground">Write instructions specifically for client replies. Do not include private staff instructions, credentials or billing details.</p></div>
        <Button type="submit" disabled={loading || conflict || !valid(draft)}>Save portal AI settings</Button>
      </form>}
      {notice && <p role={conflict ? 'alert' : 'status'}>{notice}</p>}
      <Button type="button" variant="outline" disabled={loading} onClick={load}>{conflict ? 'Discard draft and reload portal settings' : 'Reload portal settings'}</Button>
    </div>}
  </details>;
}
export default function PortalAssistantSettings({ clientId }) {
  const { user } = useAuth();
  if (!clientId || user?.role !== 'ADMIN' || !user.id || !user.organizationId) return null;
  return <Settings key={JSON.stringify([clientId, user.id, user.organizationId, user.role])} clientId={clientId} />;
}
