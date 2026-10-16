import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import Button from './ui/Button';
import Modal from './Modal';

const activeStatus = (status) => status === 'QUEUED' || status === 'RUNNING';
const terminalStatus = (status) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(status);
const denied = (error) => [401, 403, 404].includes(error?.status ?? error?.statusCode);
const itemsFrom = (pages, field) => [...new Map((pages || []).flatMap((page) => page[field] || []).map((item) => [item.id, item])).values()];
const inputClass = 'w-full rounded-lg border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const sourceId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const storedText = (value) => typeof value === 'string' && value.length <= 2000;
const storedDomain = (value) => value === null || (typeof value === 'string' && value.length <= 2048);
const storedDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));

function RetainedContext({ run }) {
  const evidence = run.contextSnapshot;
  const snapshot = evidence?.snapshot;
  const client = snapshot?.client;
  const projects = snapshot?.projects;
  const valid = evidence?.version === 1 && storedDate(run.contextObservedAt) &&
    sourceId(client?.id) && storedText(client?.name) && storedDomain(client.domain) &&
    typeof snapshot?.truncated === 'boolean' && Array.isArray(projects) && projects.length <= 25 &&
    projects.every((project) => sourceId(project?.id) && storedText(project?.name) && storedText(project?.status) &&
      (project.startDate === null || storedDate(project.startDate)) && (project.endDate === null || storedDate(project.endDate)));

  if (!valid) return <p className="text-sm text-muted-foreground">Retained context evidence is unavailable for this run. Current records are not substituted for its historical context.</p>;

  return <details className="rounded-lg border border-border p-3 text-sm">
    <summary tabIndex={0} className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retained context for this run</summary>
    <div className="mt-3 space-y-3">
      <p>Context observed at <time dateTime={run.contextObservedAt}>{run.contextObservedAt}</time> (UTC).</p>
      <p>{run.status === 'SUCCEEDED' ? 'Stored client and project context used to prepare this answer.' : 'Stored context prepared for this request. This does not confirm that a provider received it or completed an answer.'}</p>
      <p>These are historical values. Source links open current records, which may have changed or become unavailable.</p>
      <p className="break-words">Client: <a className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/client/${encodeURIComponent(client.id)}`}>{client.name}</a>{client.domain ? ` — ${client.domain}` : ' — No domain recorded'}</p>
      {projects.length ? <ul aria-label="Retained project context" className="space-y-2">
        {projects.map((project, index) => <li key={`${project.id}:${index}`} className="break-words">
          <a className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/project/${encodeURIComponent(project.id)}`}>{project.name}</a>
          <p>Status: {project.status}</p>
          <p>Start: {project.startDate ? <time dateTime={project.startDate}>{project.startDate}</time> : 'Not recorded'}; end: {project.endDate ? <time dateTime={project.endDate}>{project.endDate}</time> : 'Not recorded'}</p>
        </li>)}
      </ul> : <p>No projects were included in this context.</p>}
      {snapshot.truncated && <p>Context was limited to 25 projects. Other projects were not included.</p>}
    </div>
  </details>;
}

function readIntent(storageKey) {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(value?.key || '') || !/^[a-f0-9]{64}$/.test(value?.fingerprint || '') || (value.runId !== undefined && typeof value.runId !== 'string')) throw new Error('Invalid saved intent');
  return { key: value.key, fingerprint: value.fingerprint, ...(value.runId ? { runId: value.runId } : {}) };
}

function Conversation({ clientId, conversationId, profileEnabled, user }) {
  const questionId = useId();
  const cache = useQueryClient();
  const key = ['client-agent-conversation', user.organizationId, user.id, clientId, conversationId];
  const storageKey = `ashbi:client-agent-intent:${[user.organizationId, user.id, clientId, conversationId].map(encodeURIComponent).join(':')}`;
  const [recovery, setRecovery] = useState(() => { try { return { intent: readIntent(storageKey), blocked: false }; } catch { return { intent: null, blocked: true }; } });
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const detail = useInfiniteQuery({ queryKey: key, queryFn: ({ pageParam }) => api.getClientAgentConversation(clientId, conversationId, { limit: 50, ...(pageParam ? { after: pageParam } : {}) }), initialPageParam: undefined, getNextPageParam: (page) => page.nextCursor || undefined, retry: false });
  const runs = itemsFrom(detail.data?.pages, 'runs');
  const activeRun = detail.data?.pages?.[0]?.activeRun;
  const selectedRunId = recovery.intent?.runId || (activeStatus(activeRun?.status) ? activeRun.id : null) || runs.find((run) => activeStatus(run.status))?.id;
  const receipt = useQuery({ queryKey: [...key, 'intent', recovery.intent?.key], queryFn: () => api.getClientAgentRunByIntent(clientId, conversationId, recovery.intent.key), enabled: Boolean(recovery.intent && !recovery.intent.runId && !detail.isError && !accessDenied), retry: false });
  const runKey = [...key, 'run', selectedRunId];
  const latest = useQuery({ queryKey: runKey, queryFn: () => api.getClientAgentRun(clientId, conversationId, selectedRunId), enabled: Boolean(selectedRunId && !detail.isError && !accessDenied), retry: false, refetchOnWindowFocus: false, refetchInterval: (query) => query.state.status !== 'error' && activeStatus(query.state.data?.status) ? 3000 : false });
  const visible = !accessDenied && !detail.isError && !latest.isError && ![401, 403].includes(receipt.error?.status ?? receipt.error?.statusCode) && detail.data?.pages?.[0]?.scope === 'SHARED_STAFF';
  const displayedRuns = [...new Map([...runs, ...(activeRun ? [activeRun] : []), ...(latest.data ? [latest.data] : [])].map((run) => [run.id, run])).values()];
  const currentActive = displayedRuns.find((run) => activeStatus(run.status));
  const canCancel = Boolean(currentActive && (user.role === 'ADMIN' || currentActive.requestedById === user.id));
  const archived = Boolean(detail.data?.pages?.[0]?.conversation.archivedAt);

  function retain(intent) {
    const serialized = JSON.stringify(intent);
    sessionStorage.setItem(storageKey, serialized);
    if (sessionStorage.getItem(storageKey) !== serialized) throw new Error('Storage unavailable');
    if (alive.current) setRecovery({ intent, blocked: false });
  }

  useEffect(() => {
    if (!receipt.data?.id || !recovery.intent || recovery.intent.runId) return;
    const intent = { ...recovery.intent, runId: receipt.data.id };
    try {
      const serialized = JSON.stringify(intent);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error('Storage unavailable');
      setRecovery({ intent, blocked: false });
    } catch { setRecovery((previous) => ({ ...previous, blocked: true })); }
  }, [receipt.data, recovery.intent, storageKey]);

  // A receipt with a terminal state is the only automatic release of a saved key.
  useEffect(() => {
    if (!recovery.intent?.runId || latest.data?.id !== recovery.intent.runId || !terminalStatus(latest.data?.status)) return;
    try {
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error('Storage unavailable');
      setRecovery({ intent: null, blocked: false });
    } catch { setRecovery((previous) => ({ ...previous, blocked: true })); }
  }, [latest.data, recovery.intent, storageKey]);

  async function send(event) {
    event.preventDefault();
    const prompt = question.trim();
    if (!profileEnabled || !visible || archived || currentActive || busy.current || recovery.blocked || !prompt || prompt.length > 2000) return;
    busy.current = true; setPending(true); setError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
      if (!alive.current) return;
      const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const saved = readIntent(storageKey);
      if (saved && saved.fingerprint !== fingerprint) { setError('An earlier attempt is unresolved. Re-enter that same question to check its saved attempt.'); return; }
      const intent = saved || { key: crypto.randomUUID(), fingerprint };
      try { retain(intent); } catch { setRecovery((previous) => ({ ...previous, blocked: true })); throw new Error('Storage unavailable'); }
      const run = await api.startClientAgentRun(clientId, conversationId, { question: prompt, idempotencyKey: intent.key });
      if (!alive.current) return;
      if (!run?.id) throw new Error('Missing receipt');
      try { retain({ ...intent, runId: run.id }); } catch { setRecovery((previous) => ({ ...previous, blocked: true })); }
      cache.setQueryData([...key, 'run', run.id], run);
      setQuestion('');
      await cache.invalidateQueries({ queryKey: key });
    } catch (failure) {
      if (!alive.current) return;
      if (denied(failure)) setAccessDenied(true);
      setError('The attempt could not be confirmed. Its saved key is retained. Retry the same question to check this attempt; no new attempt is created.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }

  async function cancel() {
    if (!canCancel || busy.current || !visible) return;
    busy.current = true; setPending(true); setError('');
    try {
      const run = await api.cancelClientAgentRun(clientId, conversationId, currentActive.id);
      if (!alive.current) return;
      cache.setQueryData([...key, 'run', currentActive.id], run);
      await cache.invalidateQueries({ queryKey: key });
    } catch (failure) {
      if (!alive.current) return;
      if (denied(failure)) setAccessDenied(true);
      setError('Cancellation could not be confirmed. Refresh the saved status before trying again.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }

  return <section className="space-y-4" aria-label="Saved conversation">
    {detail.isPending && <p role="status">Loading saved conversation…</p>}
    {(!visible && !detail.isPending) && <div role="alert"><p>This conversation is unavailable or you no longer have access.</p><Button type="button" variant="outline" onClick={async () => { const result = await detail.refetch(); if (!result.isError) { setAccessDenied(false); if (selectedRunId) latest.refetch(); else if (recovery.intent) receipt.refetch(); } }}>Refresh conversation</Button></div>}
    {visible && <>
      <h3 className="font-medium">{detail.data.pages[0].conversation.title || 'Untitled conversation'}</h3>
      {!displayedRuns.length && <p>No saved questions yet. Sending a question starts an AI request.</p>}
      <ol aria-label="Saved questions and responses" className="space-y-4">
        {displayedRuns.map((run) => <li key={run.id} className="space-y-2 rounded-lg border border-border p-3">
          <p className="whitespace-pre-wrap break-words">{run.prompt}</p>
          <p className="text-sm text-muted-foreground">Status: {run.status}</p>
          {run.response && <p className="whitespace-pre-wrap break-words">{run.response}</p>}
          {run.status === 'FAILED' && <p>The request failed. Review the workspace AI settings before explicitly sending another question.</p>}
          {run.status === 'UNKNOWN' && <p>The provider outcome is unknown and may have incurred a cost. This request will not be retried automatically.</p>}
          {run.status === 'CANCELLED' && <p>This run was cancelled. An in-flight provider request may still complete and incur a cost.</p>}
          <RetainedContext run={run} />
        </li>)}
      </ol>
      {detail.hasNextPage && <Button type="button" variant="outline" disabled={detail.isFetchingNextPage} onClick={() => detail.fetchNextPage()}>Load more saved questions</Button>}
      {currentActive && <div className="space-y-2"><p role="status">The saved request is {currentActive.status.toLowerCase()}. Checking its status automatically.</p>{canCancel && <Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel run</Button>}<p className="text-sm text-muted-foreground">Stopping a run may not stop an in-flight provider request or its cost.</p></div>}
      {recovery.intent && !currentActive && <div><p role="status">A saved attempt is being checked. If its status is unavailable, re-enter the same question and retry its saved attempt.</p>{!recovery.intent.runId && <Button type="button" variant="outline" disabled={receipt.isFetching || pending} onClick={() => receipt.refetch()}>Check saved attempt</Button>}</div>}
      {recovery.blocked && <p role="alert">Browser storage could not retain the attempt safely. Sending is blocked until storage is available. Do not clear a pending attempt.</p>}
      {!profileEnabled && <p>The account manager is paused. Saved conversations remain available.</p>}
      {archived && <p>This conversation is archived. Its saved questions remain available.</p>}
      <form className="space-y-3" onSubmit={send}>
        <label htmlFor={questionId} className="block text-sm font-medium">Question for the account manager</label>
        <textarea id={questionId} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} rows={3} className={inputClass} disabled={pending || Boolean(currentActive) || recovery.blocked} />
        <Button type="submit" disabled={!profileEnabled || archived || !question.trim() || pending || Boolean(currentActive) || recovery.blocked}>{pending ? 'Checking attempt…' : recovery.intent ? 'Retry saved attempt' : 'Send question'}</Button>
      </form>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function Conversations({ clientId, profileEnabled, user }) {
  const cache = useQueryClient();
  const queryKey = ['client-agent-conversations', user.organizationId, user.id, clientId];
  const list = useInfiniteQuery({ queryKey, queryFn: ({ pageParam }) => api.listClientAgentConversations(clientId, { limit: 50, ...(pageParam ? { after: pageParam } : {}) }), initialPageParam: undefined, getNextPageParam: (page) => page.nextCursor || undefined, retry: false });
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const readable = !list.isError && list.data?.pages?.[0]?.scope === 'SHARED_STAFF';
  const conversations = itemsFrom(list.data?.pages, 'items');

  async function create(event) {
    event.preventDefault();
    if (busy.current || !title.trim() || !readable) return;
    busy.current = true; setPending(true); setError('');
    try {
      const conversation = await api.createClientAgentConversation(clientId, { title: title.trim() });
      if (!alive.current) return;
      setCreating(false); setTitle(''); setSelected(conversation.id);
      await cache.invalidateQueries({ queryKey });
    } catch { if (alive.current) setError('The conversation could not be created. Refresh the list before trying again.'); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-label="Account manager conversations">
    <h2 className="font-medium">Account manager conversations</h2>
    <p className="text-sm text-muted-foreground">Shared with the Ashbi team. These conversations are not private. Each question is answered on its own using current client data. The account manager answers questions; it does not send messages or make changes to client work.</p>
    {list.isPending && <p role="status">Loading conversations…</p>}
    {list.isError && <div role="alert"><p>Conversations are unavailable or you no longer have access.</p><Button type="button" variant="outline" onClick={() => list.refetch()}>Refresh conversations</Button></div>}
    {readable && <>
      {!conversations.length && <p>No saved conversations yet.</p>}
      <ul aria-label="Conversations" className="flex flex-wrap gap-2">{conversations.map((conversation) => <li key={conversation.id}><Button type="button" variant="outline" aria-pressed={selected === conversation.id} onClick={() => setSelected(conversation.id)}>{conversation.title || 'Untitled conversation'}</Button></li>)}</ul>
      {list.hasNextPage && <Button type="button" variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more conversations</Button>}
      <Button type="button" variant="outline" onClick={() => setCreating(true)}>New conversation</Button>
      {selected && <Conversation key={`${user.id}:${clientId}:${selected}`} clientId={clientId} conversationId={selected} profileEnabled={profileEnabled} user={user} />}
    </>}
    <Modal isOpen={creating && readable} onClose={() => { if (!pending) setCreating(false); }} title="New shared conversation">
      <form onSubmit={create} className="space-y-3"><label htmlFor={titleId} className="block text-sm font-medium">Conversation title</label><input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required className={inputClass} disabled={pending} /><p className="text-sm text-muted-foreground">Creating a conversation does not start an AI request.</p>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending || !title.trim()}>Create conversation</Button></form>
    </Modal>
  </section>;
}

export default function ClientAgentConversations(props) {
  const { user } = useAuth();
  if (!user?.id || !user.organizationId || !['ADMIN', 'TEAM'].includes(user.role) || !props.clientId) return null;
  return <Conversations key={`${user.organizationId}:${user.id}:${user.role}:${props.clientId}`} {...props} profileEnabled={props.profileEnabled ?? false} user={user} />;
}
