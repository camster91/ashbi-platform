import { useEffect, useId, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { portalHandoffs } from '../lib/portal-handoffs';
import Button from './ui/Button';
import { inputStyles } from './ui/Input';

const LABELS = { PENDING: 'Waiting for the team', CLAIMED: 'Picked up by the team', RESOLVED: 'Marked resolved' };
const validKey = (key) => typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key);
const validDate = (value) => typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime());
const validRequest = (row, projectId) => row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 100
  && row.projectId === projectId && typeof row.question === 'string' && row.question.trim().length > 0 && row.question.length <= 2000
  && Object.hasOwn(LABELS, row.status) && validDate(row.createdAt) && validDate(row.updatedAt);

function Requests({ projectId, token, identity }) {
  const cache = useQueryClient();
  const [question, setQuestion] = useState('');
  const [intent, setIntent] = useState(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const fieldId = useId();
  const scope = ['portal-team-request', identity.organizationId, identity.userId, identity.contactId, projectId];
  const storageKey = scope.map(encodeURIComponent).join(':');
  const history = useInfiniteQuery({ queryKey: scope, initialPageParam: undefined, queryFn: ({ pageParam }) => portalHandoffs.list(projectId, token, pageParam), getNextPageParam: (page) => page.nextCursor || undefined, retry: false, refetchOnWindowFocus: false });
  const unavailable = denied || history.isError;
  const rows = unavailable ? [] : [...new Map((history.data?.pages || []).flatMap((page) => page.items || []).map((row) => [row.id, row])).values()];

  function readIntent() {
    const stored = localStorage.getItem(storageKey);
    const value = stored ? JSON.parse(stored) : null;
    if (value && (!validKey(value.key) || !['PREPARED', 'UNKNOWN'].includes(value.status))) throw new Error('Invalid intent');
    return value ? { key: value.key, status: value.status } : null;
  }
  function restore() {
    try {
      setIntent(readIntent()); setStorageError(false);
    } catch { setStorageError(true); }
    setReady(true);
  }
  useEffect(() => {
    active.current = true; restore();
    const onStorage = (event) => { if (event.key === storageKey || event.key === null) restore(); };
    window.addEventListener('storage', onStorage);
    return () => { active.current = false; window.removeEventListener('storage', onStorage); };
    // The keyed wrapper remounts for every principal, project and token change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retain(value) {
    const serialized = JSON.stringify({ key: value.key, status: value.status });
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized) throw new Error('Intent not retained');
    setIntent(value);
  }
  function markUnknown(key) {
    if (!active.current) return;
    try {
      if (readIntent()?.key !== key) { restore(); return; }
      retain({ key, status: 'UNKNOWN' });
    } catch { setIntent((current) => !current || current.key === key ? { key, status: 'UNKNOWN' } : current); setStorageError(true); }
  }
  async function confirm(data, key) {
    if (!active.current) return false;
    if (!validRequest(data?.request, projectId)) throw new Error('Unconfirmed request');
    if (readIntent()?.key !== key) { restore(); setNotice('A different submission is being tracked. Check its status before continuing.'); return false; }
    localStorage.removeItem(storageKey);
    if (localStorage.getItem(storageKey) !== null) throw new Error('Intent not cleared');
    setIntent((current) => current?.key === key ? null : current); setQuestion(''); setStorageError(false); setDenied(false);
    setNotice('Your request is saved for the team. You can follow its status below.');
    await cache.invalidateQueries({ queryKey: scope });
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || intent || !ready || storageError || unavailable || !question.trim() || question.trim().length > 2000) return;
    busy.current = true; setPending(true); setNotice('');
    let key;
    try {
      // A remount or another tab may already have retained an intent.
      if (localStorage.getItem(storageKey)) { restore(); busy.current = false; setPending(false); return; }
      key = crypto.randomUUID(); retain({ key, status: 'PREPARED' });
    } catch { setStorageError(true); busy.current = false; setPending(false); return; }
    try {
      const data = await portalHandoffs.create(projectId, token, { question: question.trim(), idempotencyKey: key });
      if (active.current) await confirm(data, key);
    } catch (error) {
      if (active.current) {
        markUnknown(key);
        if ([401, 403, 404].includes(error.status)) setDenied(true);
        setNotice('Submission could not be confirmed. Your request may already be saved. Check its status before submitting anything else.');
      }
    } finally { if (active.current) { busy.current = false; setPending(false); } }
  }
  async function recover() {
    if (!intent || busy.current) return;
    busy.current = true; setPending(true); setNotice('');
    const key = intent.key;
    try { const data = await portalHandoffs.recover(projectId, token, key); if (active.current) await confirm(data, key); }
    catch (error) { if (active.current) { markUnknown(key); if ([401, 403].includes(error.status)) setDenied(true); setNotice('The saved request could not be confirmed. Keep this attempt and check again, or contact the team through your usual channel.'); } }
    finally { if (active.current) { busy.current = false; setPending(false); } }
  }
  async function reload() { const result = await history.refetch(); if (!result.isError) setDenied(false); }

  return <section aria-labelledby={`${fieldId}-heading`} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <h3 id={`${fieldId}-heading`} className="text-lg font-semibold">Ask the team</h3>
    <p className="text-sm text-muted-foreground">Send a question about this project to the human team. This creates a request for review; it does not generate an AI answer or promise a response time.</p>
    {storageError && <div role="alert"><p>Browser storage could not retain your submission safely. New requests are blocked.</p><Button type="button" variant="outline" disabled={pending} onClick={restore}>Retry browser storage</Button></div>}
    {intent && <div className="space-y-2 rounded-lg border border-border p-3"><p role="status">A submission needs confirmation. It may already be saved. New questions are paused to avoid duplicates.</p><Button type="button" variant="outline" loading={pending} onClick={recover}>Check submission status</Button></div>}
    {notice && <p role="status">{notice}</p>}
    {unavailable ? <div role="alert"><p>Team requests are unavailable for this session. Reload to verify your access.</p><Button type="button" variant="outline" disabled={history.isFetching} onClick={reload}>Reload team requests</Button></div> : <>
      <form className="space-y-2" onSubmit={submit}>
        <label htmlFor={fieldId} className="block font-medium">Your question</label>
        <textarea id={fieldId} className={inputStyles('min-h-28')} maxLength={2000} value={question} disabled={!ready || pending || Boolean(intent) || storageError} onChange={(event) => setQuestion(event.target.value)} />
        <Button type="submit" loading={pending && !intent} disabled={!ready || Boolean(intent) || storageError || pending || !question.trim()}>Send question to the team</Button>
      </form>
      <h4 className="font-medium">Your requests for this project</h4>
      {history.isPending && <p role="status">Loading your requests…</p>}
      {!history.isPending && rows.length === 0 && <p className="text-sm text-muted-foreground">You have not submitted any requests for this project.</p>}
      <ul className="space-y-3">{rows.map((row) => <li key={row.id} className="space-y-1 rounded-lg border border-border p-3"><p className="whitespace-pre-wrap break-words text-sm">{row.question}</p><p className="text-sm font-medium">{LABELS[row.status] || 'Status unavailable'}</p><time className="text-xs text-muted-foreground" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time></li>)}</ul>
      {history.hasNextPage && <Button type="button" variant="outline" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load more requests</Button>}
    </>}
  </section>;
}

function PortalRequestScope(props) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><Requests {...props} /></QueryClientProvider>;
}

export default function PortalTeamRequests({ projectId, token, identity }) {
  if (!projectId || ![identity?.organizationId, identity?.userId, identity?.contactId].every((value) => typeof value === 'string' && value)) return <p role="status">Sign in again to ask the team securely.</p>;
  return <PortalRequestScope key={JSON.stringify([identity.organizationId, identity.userId, identity.contactId, projectId, token])} projectId={projectId} token={token} identity={identity} />;
}
