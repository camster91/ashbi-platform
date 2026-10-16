import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import Button from './ui/Button';
import { inputStyles } from './ui/Input';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
const nullableCode = value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 100);
const date = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const nullableDate = value => value === null || date(value);
function validInvocation(value) {
  if (!value || value.kind !== 'ACCOUNT_MANAGER_DRAFT' || value.scope !== 'WORKSPACE_CHANNEL'
    || !['id', 'bindingId', 'sourceMessageId', 'requestedById', 'conversationId', 'runId'].every(key => boundedId(value[key]))
    || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(value.status)
    || !['PENDING', 'DELIVERED', 'SUPPRESSED'].includes(value.deliveryState)
    || !['profileRevision', 'bindingRevision'].every(key => Number.isInteger(value[key]) && value[key] > 0 && value[key] <= 2147483647)
    || !date(value.createdAt) || !['startedAt', 'finishedAt', 'deliveredAt', 'suppressedAt'].every(key => nullableDate(value[key]))
    || !nullableCode(value.deliveryCode) || !nullableCode(value.errorCode)) return false;
  if (value.deliveryState === 'DELIVERED') return value.status === 'SUCCEEDED' && typeof value.response === 'string'
    && date(value.finishedAt) && date(value.deliveredAt) && value.suppressedAt === null && value.deliveryCode === null;
  if (value.response !== null || value.deliveredAt !== null) return false;
  if (value.deliveryState === 'PENDING') return ['QUEUED', 'RUNNING'].includes(value.status)
    && value.finishedAt === null && value.suppressedAt === null && value.deliveryCode === null;
  return ['FAILED', 'CANCELLED', 'UNKNOWN'].includes(value.status) && date(value.finishedAt) && date(value.suppressedAt);
}
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN']);

export default function WorkspaceAccountManager({ channel, user, messages }) {
  const member = channel?.members?.some(m => m.userId === user.id && m.leftAt == null);
  if (!member || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role) || !['CLIENT', 'PROJECT'].includes(channel.kind) || !channel.clientId || channel.archivedAt || channel.readOnly) return null;
  return <Panel key={`${user.organizationId}:${user.id}:${user.role}:${channel.id}`} channel={channel} user={user} messages={messages} />;
}

function Panel({ channel, user, messages }) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [intent, setIntent] = useState(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const id = useId();
  const storageKey = `workspace-agent-intent:${user.organizationId}:${user.id}:${channel.id}`;
  useEffect(() => {
    alive.current = true;
    try {
      const key = localStorage.getItem(storageKey);
      if (key && !uuid.test(key)) setStorageFailed(true);
      else setIntent(key);
    } catch { setStorageFailed(true); }
    return () => { alive.current = false; };
  }, [storageKey]);
  const scope = ['workspace-account-manager', user.organizationId, user.id, user.role, channel.id];
  const binding = useQuery({ queryKey: [...scope, 'binding'], queryFn: () => api.getWorkspaceAccountManager(channel.id), enabled: open, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const requests = useInfiniteQuery({ queryKey: [...scope, 'requests'], queryFn: ({ pageParam }) => api.listWorkspaceAccountManagerRequests(channel.id, { limit: 20, ...(pageParam ? { after: pageParam } : {}) }), initialPageParam: undefined, getNextPageParam: page => page.nextCursor || undefined, enabled: open, retry: false, refetchOnWindowFocus: false });
  const profile = useQuery({ queryKey: [...scope, 'profile', channel.clientId], queryFn: () => api.getClientAgentProfile(channel.clientId), enabled: open && user.role === 'ADMIN', retry: false, refetchOnWindowFocus: false });
  const denied = blocked || binding.isError || requests.isError;
  const current = !denied && binding.data?.binding;
  const rows = denied ? [] : [...new Map((requests.data?.pages || []).flatMap(page => page.items || []).map(row => [row.id, row])).values()];
  const sources = messages.filter(m => m.content?.trim() && m.content.trim().length <= 2000 && ['ADMIN', 'TEAM'].includes(m.author?.role || channel.members?.find(member => member.userId === m.author?.id && member.leftAt == null)?.user?.role) && m.author?.isActive !== false);
  const selected = sources.find(m => m.id === sourceId);
  const ready = !denied && !binding.isFetching && !requests.isFetching && !busy;
  async function refresh() {
    const results = await Promise.all([binding.refetch(), requests.refetch(), ...(user.role === 'ADMIN' ? [profile.refetch()] : [])]);
    if (alive.current && !results.some(result => result.isError)) { setBlocked(false); setError(''); }
  }
  async function operate(work) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); }
    catch { if (alive.current) { setBlocked(true); setError('The result could not be verified. Refresh access and status before continuing.'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function clearIntent(capturedKey) {
    // An old instance must never erase a newer instance's recovery marker.
    if (!alive.current || localStorage.getItem(storageKey) !== capturedKey) return;
    localStorage.removeItem(storageKey);
    setIntent(currentKey => currentKey === capturedKey ? null : currentKey);
  }
  async function requestDraft() {
    if (!ready || intent || storageFailed || !current?.enabled || !selected) return;
    await operate(async () => {
      const key = crypto.randomUUID();
      // Persist only the opaque recovery key before allowing a side effect.
      try { localStorage.setItem(storageKey, key); } catch { setStorageFailed(true); return; }
      setIntent(key);
      const result = await api.requestWorkspaceAccountManager(channel.id, { bindingId: current.id, sourceMessageId: selected.id, idempotencyKey: key });
      if (!validInvocation(result?.invocation) || result.invocation.bindingId !== current.id || result.invocation.sourceMessageId !== selected.id || result.invocation.requestedById !== user.id) throw new Error('Unverified receipt');
      clearIntent(key);
      if (alive.current) { setSourceId(''); await refresh(); }
    });
  }
  async function recover() {
    if (!intent) return;
    const capturedKey = intent;
    await operate(async () => {
      const result = await api.getWorkspaceAccountManagerByIntent(channel.id, capturedKey);
      if (!validInvocation(result?.invocation) || result.invocation.requestedById !== user.id) throw new Error('Unverified recovery');
      clearIntent(capturedKey);
      if (alive.current) await refresh();
    });
  }
  return <details className="rounded-lg border border-border p-3" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-medium">Channel account manager</summary>
    {open && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Request an AI draft from one existing human message. Requests can send that message and permitted client context to the configured provider and consume usage. Nothing is sent to clients.</p>
      {(binding.isPending || requests.isPending) && <p role="status">Loading account manager…</p>}
      {(denied || error) && <p role="alert">{error || 'Account manager access or status is unavailable. Private drafts are hidden.'}</p>}
      <Button variant="outline" disabled={busy || binding.isFetching || requests.isFetching} onClick={() => operate(refresh)}>Refresh account manager</Button>
      {storageFailed && <p role="alert">Recovery storage is unavailable. New requests are disabled.</p>}
      {intent && <div role="status"><p>A previous request needs reconciliation. Check its status; a missing result does not prove it was never queued. No new request will be sent.</p><Button variant="outline" disabled={busy} onClick={recover}>Recover previous request</Button></div>}
      {!denied && !binding.isPending && <>
        {!current && <><p>No account manager installed.</p>{user.role === 'ADMIN' && <>
          {profile.isPending && <p role="status">Loading client profile…</p>}
          {(profile.isError || (!profile.isPending && !profile.data?.id)) && <p>Save an account manager profile on the client page before installing it here.</p>}
          {profile.data?.id && !profile.isError && <><p>Client profile: {profile.data.name}. Installation starts disabled.</p><Button disabled={!ready || profile.isFetching} onClick={() => operate(async () => { await api.installWorkspaceAccountManager(channel.id, { profileId: profile.data.id }); if (alive.current) await refresh(); })}>Install disabled account manager</Button></>}
        </>}</>}
        {current && <>
          <p>Account manager is {current.enabled ? 'enabled' : 'disabled'}.</p>
          {user.role === 'ADMIN' && <Button variant="outline" disabled={!ready || (current.enabled === false && (profile.isFetching || profile.isError || !profile.data?.enabled || !profile.data.pluginIds?.includes('client-work')))} onClick={() => operate(async () => { await api.updateWorkspaceAccountManager(channel.id, current.id, { revision: current.revision, enabled: !current.enabled }); if (alive.current) await refresh(); })}>{current.enabled ? 'Disable account manager' : 'Enable account manager'}</Button>}
          {current.enabled && <div><label htmlFor={`${id}-source`}>Source message for AI draft</label><select id={`${id}-source`} className={inputStyles()} value={sourceId} disabled={!ready || Boolean(intent)} onChange={event => setSourceId(event.target.value)}><option value="">Choose an existing human message</option>{sources.map(message => <option key={message.id} value={message.id}>{message.author.name || 'Team member'}: {message.content.slice(0, 100)}</option>)}</select><p className="text-xs text-muted-foreground">Only loaded messages from current human members of at most 2,000 characters are available. Load earlier messages above if needed.</p><Button disabled={!ready || !selected || Boolean(intent) || storageFailed} onClick={requestDraft}>Request AI draft</Button></div>}
        </>}
        <ol aria-label="Account manager drafts" className="space-y-2">{rows.map(row => <li key={row.id} className="rounded-lg border border-border p-3">
          <h3 className="font-medium">Account manager draft</h3><p>Status: {row.status} · Delivery: {row.deliveryState}</p>
          <p className="text-xs text-muted-foreground">{messages.some(message => message.id === row.sourceMessageId) ? <a className="underline" href={`#workspace-message-${row.sourceMessageId}`}>Open source message</a> : 'Source message is outside the loaded history. Load earlier messages above.'} · Profile revision {row.profileRevision}</p>
          {row.deliveryState === 'SUPPRESSED' && <p>The answer was withheld. It is not available in this channel.</p>}
          {row.status === 'UNKNOWN' && <p>The provider outcome is unknown. This request will not be retried automatically.</p>}
          {row.deliveryState === 'DELIVERED' && row.status === 'SUCCEEDED' && typeof row.response === 'string' && <p className="whitespace-pre-wrap break-words">{row.response}</p>}
          {row.deliveryState === 'PENDING' && !terminal.has(row.status) && (row.requestedById === user.id || user.role === 'ADMIN') && <><p className="text-xs">Cancel prevents future delivery; provider processing and usage may already have occurred.</p><Button variant="outline" disabled={!ready} onClick={() => operate(async () => { await api.cancelWorkspaceAccountManagerRequest(channel.id, row.id); if (alive.current) await refresh(); })}>Cancel draft request</Button></>}
        </li>)}</ol>
        {!requests.isPending && !rows.length && <p>No draft requests yet.</p>}
        {requests.hasNextPage && <Button variant="outline" disabled={!ready} onClick={() => requests.fetchNextPage()}>Load more draft requests</Button>}
      </>}
    </div>}
  </details>;
}
