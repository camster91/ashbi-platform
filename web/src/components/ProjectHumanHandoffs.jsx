import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import Button from './ui/Button';
import { inputStyles } from './ui/Input';

const LABELS = { PENDING: 'Needs an owner', CLAIMED: 'Claimed', RESOLVED: 'Resolved' };
function Handoffs({ projectId, user }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('everyone');
  const [reason, setReason] = useState('RECOVERY');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const queryKey = ['project-human-handoffs', user.organizationId, user.id, user.role, projectId, owner];
  const history = useInfiniteQuery({ queryKey, initialPageParam: undefined, queryFn: ({ pageParam }) => api.listPortalHandoffs({ projectId, owner, limit: 20, ...(pageParam ? { after: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor || undefined, enabled: open, retry: false, refetchOnWindowFocus: false });
  const unavailable = history.isError || denied;
  const rows = unavailable ? [] : [...new Map((history.data?.pages || []).flatMap((page) => page.items || []).map((row) => [row.id, row])).values()];

  async function action(row, operation) {
    if (busy.current || blocked || unavailable || !Number.isInteger(row.revision)) return;
    busy.current = true; setPending(true); setNotice('');
    try {
      await api.transitionPortalHandoff(row.id, operation, { revision: row.revision, ...(operation === 'requeue' ? { reason } : {}) });
      setBlocked(true);
      await cache.invalidateQueries({ queryKey: ['project-human-handoffs', user.organizationId, user.id] });
      setBlocked(false); setNotice('Request updated.');
    } catch (error) {
      setBlocked(true);
      if ([401, 403, 404].includes(error.status)) { setDenied(true); setNotice('Your access to this request could not be verified. Reload before continuing.'); }
      else setNotice(error.status === 409 ? 'This request changed or the action is no longer allowed. Reload the latest requests before taking another action.' : 'The update could not be confirmed. Reload the latest requests before taking another action.');
    } finally { busy.current = false; setPending(false); }
  }
  async function reload() { const result = await history.refetch(); if (!result.isError) { setDenied(false); setBlocked(false); setNotice('Latest requests loaded.'); } }

  return <details className="rounded-xl border border-border bg-card p-4" onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-semibold">Client questions for the team</summary>
    {open && <div className="space-y-4 pt-2">
      <p className="text-sm text-muted-foreground">Human requests submitted from this project’s client portal. Claim ownership, follow up through your normal communication channel, then mark the request resolved.</p>
      <label className="block text-sm">Request owner<select className={inputStyles('mt-1 max-w-xs')} value={owner} disabled={pending} onChange={(event) => { setOwner(event.target.value); setNotice(''); }}><option value="everyone">Everyone</option><option value="me">Assigned to me</option></select></label>
      {notice && <p role="status">{notice}</p>}
      {history.isPending && <p role="status">Loading client questions…</p>}
      {unavailable ? <div role="alert"><p>Client questions are unavailable. Reload to verify your current access.</p><Button type="button" variant="outline" disabled={history.isFetching} onClick={reload}>Reload client questions</Button></div> : <>
        {blocked && <Button type="button" variant="outline" disabled={history.isFetching || pending} onClick={reload}>Reload client questions</Button>}
        {!history.isPending && !rows.length && <p className="text-sm text-muted-foreground">No client questions match this view.</p>}
        <ul className="space-y-3">{rows.map((row) => <li key={row.id} className="space-y-2 rounded-lg border border-border p-3">
          <p className="whitespace-pre-wrap break-words text-sm">{row.question}</p>
          <p className="text-sm font-medium">{LABELS[row.status] || 'Status unavailable'}{row.status === 'CLAIMED' ? ` · ${row.ownerId === user.id ? 'Assigned to you' : 'Assigned to another teammate'}` : ''}</p>
          <time className="text-xs text-muted-foreground" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
          <div className="flex flex-wrap gap-2">
            {row.status === 'PENDING' && <Button type="button" size="sm" disabled={pending || blocked} onClick={() => action(row, 'claim')}>Claim request</Button>}
            {row.status === 'CLAIMED' && (row.ownerId === user.id || user.role === 'ADMIN') && <Button type="button" size="sm" disabled={pending || blocked} onClick={() => action(row, 'resolve')}>Mark resolved</Button>}
            {row.status === 'CLAIMED' && user.role === 'ADMIN' && <><label className="text-sm">Requeue reason<select aria-label={`Requeue reason for request ${row.id}`} className={inputStyles()} disabled={pending || blocked} value={reason} onChange={(event) => setReason(event.target.value)}><option value="RECOVERY">Recovery</option><option value="OWNER_UNAVAILABLE">Owner unavailable</option></select></label><Button type="button" size="sm" variant="outline" disabled={pending || blocked} onClick={() => action(row, 'requeue')}>Return to unassigned</Button></>}
          </div>
        </li>)}</ul>
        {history.hasNextPage && <Button type="button" variant="outline" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load more client questions</Button>}
      </>}
    </div>}
  </details>;
}

export default function ProjectHumanHandoffs({ projectId }) {
  const { user } = useAuth();
  if (!projectId || !['ADMIN', 'TEAM'].includes(user?.role) || !user.id || !user.organizationId) return null;
  return <Handoffs key={JSON.stringify([projectId, user.organizationId, user.id, user.role])} projectId={projectId} user={user} />;
}
