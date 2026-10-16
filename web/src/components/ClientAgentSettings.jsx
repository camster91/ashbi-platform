import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Button from './ui/Button';
import Input, { inputStyles } from './ui/Input';

function ProfileSettings({ clientId }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const id = useId();
  const cache = useQueryClient();
  const queryKey = ['client-agent-profile', clientId];
  const query = useQuery({ queryKey, queryFn: () => api.getClientAgentProfile(clientId), enabled: open && Boolean(clientId), retry: false, refetchOnWindowFocus: false });
  const profile = draft || query.data;
  const edit = (field, value) => { setDraft({ ...profile, [field]: value }); setNotice(''); };

  async function save(event) {
    event.preventDefault();
    if (busy.current || !profile?.name?.trim() || profile.name.length > 100 || profile.instructions.length > 2000 || conflict) return;
    busy.current = true; setPending(true); setNotice('');
    try {
      const saved = await api.updateClientAgentProfile(clientId, { revision: profile.revision, name: profile.name.trim(), instructions: profile.instructions, enabled: profile.enabled, pluginIds: profile.pluginIds || [] });
      cache.setQueryData(queryKey, saved); setDraft(null); setNotice('Profile saved.');
    } catch (error) {
      if (error.status === 409 || error.statusCode === 409) { setConflict(true); setNotice('Someone changed this profile. Your draft is preserved. Reload the saved profile before editing again.'); }
      else setNotice('The profile could not be saved. Your draft is preserved; try again.');
    } finally { busy.current = false; setPending(false); }
  }

  async function reload() {
    const result = await query.refetch();
    if (!result.isError) { setDraft(null); setConflict(false); setNotice('Saved profile reloaded.'); }
  }

  return <details className="rounded-lg border border-border p-3" onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-medium">Account manager settings</summary>
    {open && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Configure the staff account manager for this client. These settings apply to staff. Client portal AI has separate settings. Saving settings does not run the agent.</p>
      {query.isPending && <p role="status">Loading profile…</p>}
      {query.isError && <div role="alert"><p>The profile could not be loaded.</p><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Retry profile</Button></div>}
      {!query.isError && profile && <form className="space-y-3" onSubmit={save}>
        <div><label htmlFor={`${id}-name`}>Agent name</label><Input id={`${id}-name`} value={profile.name} maxLength={100} required disabled={pending} onChange={(event) => edit('name', event.target.value)} /></div>
        <div><label htmlFor={`${id}-instructions`}>Client instructions</label><textarea id={`${id}-instructions`} className={inputStyles('min-h-28')} value={profile.instructions} maxLength={2000} disabled={pending} onChange={(event) => edit('instructions', event.target.value)} /><p className="text-xs text-muted-foreground">Include working preferences, not passwords or access tokens. Instructions cannot grant additional permissions.</p></div>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={profile.enabled} disabled={pending} onChange={(event) => edit('enabled', event.target.checked)} />Enable account manager</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={profile.pluginIds?.includes('client-work') || false} disabled={pending} onChange={(event) => edit('pluginIds', event.target.checked ? [...new Set([...(profile.pluginIds || []), 'client-work'])] : (profile.pluginIds || []).filter((plugin) => plugin !== 'client-work'))} />Enable client work plugin</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={profile.pluginIds?.includes('client-task-actions') || false} disabled={pending} onChange={(event) => edit('pluginIds', event.target.checked ? [...new Set([...(profile.pluginIds || []), 'client-task-actions'])] : (profile.pluginIds || []).filter((plugin) => plugin !== 'client-task-actions'))} />Task proposals (requires confirmation)</label>
        <p className="text-sm text-muted-foreground">Client work plugin: {profile.pluginIds?.includes('client-work') ? 'enabled' : 'disabled'}. Tools remain limited to the signed-in staff member’s access.</p>
        <Button type="submit" loading={pending} disabled={conflict || !profile.name.trim()}>Save profile</Button>
      </form>}
      {notice && <p role={notice.startsWith('Profile saved') || notice.startsWith('Saved profile') ? 'status' : 'alert'}>{notice}</p>}
      {conflict && <Button type="button" variant="outline" disabled={query.isFetching} onClick={reload}>Discard draft and reload saved profile</Button>}
    </div>}
  </details>;
}

export default function ClientAgentSettings({ clientId }) {
  return clientId ? <ProfileSettings key={clientId} clientId={clientId} /> : null;
}
