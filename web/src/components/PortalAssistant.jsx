import { useEffect, useId, useRef, useState } from 'react';
import { portalAssistant } from '../lib/portal-assistant';
import Button from './ui/Button';
import { inputStyles } from './ui/Input';

const LABELS = { QUEUED: 'Ready to start', RUNNING: 'Preparing a reply', SUCCEEDED: 'Assistant reply', FAILED: 'Reply failed', UNKNOWN: 'Outcome unknown', CANCELLED: 'Cancelled', EXPIRED: 'Expired before starting', DISCARDED: 'Reply discarded' };
const pending = (run) => ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(run.status);
const activeRun = (run) => ['QUEUED', 'RUNNING'].includes(run.status);
const idValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 100;
const dateValid = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const validPortalRun = (run) => run && idValid(run.id) && typeof run.message === 'string' && run.message.trim().length > 0 && run.message.length <= 2000
  && Object.hasOwn(LABELS, run.status) && dateValid(run.createdAt) && dateValid(run.deadlineAt)
  && [run.startedAt, run.finishedAt].every(value => value === null || dateValid(value))
  && (run.errorCode === null || (typeof run.errorCode === 'string' && run.errorCode.length <= 100))
  && (run.status === 'SUCCEEDED' ? typeof run.response === 'string' && run.response.trim().length > 0 && run.response.length <= 16000 : run.response === null);
const validKey = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function Assistant({ projectId, token, identity }) {
  const field = useId();
  const storageKey = ['portal-assistant', identity.organizationId, identity.userId, identity.contactId, projectId].map(encodeURIComponent).join(':');
  const [open, setOpen] = useState(false), [data, setData] = useState(null), [question, setQuestion] = useState('');
  const [intent, setIntent] = useState(null), [storageError, setStorageError] = useState(false), [error, setError] = useState(false);
  const [loading, setLoading] = useState(false), [notice, setNotice] = useState('');
  const [confirmedUnknown, setConfirmedUnknown] = useState(null);
  const active = useRef(true), busy = useRef(false), readGeneration = useRef(0);
  function stored() {
    const raw = localStorage.getItem(storageKey), value = raw ? JSON.parse(raw) : null;
    if (value && (!validKey(value.key) || typeof value.dispatched !== 'boolean' || (value.runId !== undefined && !idValid(value.runId)))) throw Error('Invalid intent');
    return value;
  }
  function restore() { setConfirmedUnknown(null); try { const value = stored(); setIntent(value); setStorageError(false); if (value) setOpen(true); } catch { setStorageError(true); setOpen(true); } }
  useEffect(() => {
    active.current = true; restore();
    const listener = event => { if (event.key === storageKey || event.key === null) restore(); };
    window.addEventListener('storage', listener);
    return () => { active.current = false; window.removeEventListener('storage', listener); };
    // Identity/project/token changes remount this entire private state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function retain(value) {
    if (!active.current) return false;
    const previous = stored(); if (previous && previous.key !== value.key) { restore(); return false; }
    const text = JSON.stringify(value); localStorage.setItem(storageKey, text);
    if (localStorage.getItem(storageKey) !== text) throw Error('Intent not retained');
    setIntent(value); return true;
  }
  async function load(after) {
    if (busy.current) return; busy.current = true; setLoading(true); setConfirmedUnknown(null); const generation = ++readGeneration.current;
    try {
      const result = await portalAssistant.list(projectId, token, after);
      if (!active.current || generation !== readGeneration.current) return;
      if (typeof result.enabled !== 'boolean' || typeof result.name !== 'string' || result.mode !== 'PORTAL_ASSISTANT' || !Number.isSafeInteger(result.revision)
        || !Array.isArray(result.items) || !result.items.every(validPortalRun) || !(result.nextCursor === null || idValid(result.nextCursor))) throw Error('Invalid history');
      setData(previous => ({ ...result, items: result.enabled ? [...new Map([...(after ? previous?.items || [] : []), ...result.items].map(run => [run.id, run])).values()] : [] })); setError(false);
    } catch { if (active.current && generation === readGeneration.current) { setData(null); setError(true); } }
    finally { if (active.current) { busy.current = false; setLoading(false); } }
  }
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  function accept(receipt, captured, expectedId = captured?.runId) {
    if (!active.current) return null;
    if (!validPortalRun(receipt?.run)) throw Error('Unconfirmed receipt');
    const run = receipt.run;
    if (expectedId && run.id !== expectedId) throw Error('Wrong request receipt');
    if (captured) {
      if (stored()?.key !== captured.key) { restore(); return null; }
      if (pending(run)) { if (!retain({ ...captured, runId: run.id })) return null; }
      else { localStorage.removeItem(storageKey); if (localStorage.getItem(storageKey) !== null) throw Error('Intent not cleared'); setIntent(current => current?.key === captured.key ? null : current); }
    }
    setData(previous => previous ? { ...previous, items: [...new Map([...previous.items, run].map(row => [row.id, row])).values()] } : previous);
    return run;
  }
  async function act(operation) {
    if (busy.current) return; busy.current = true; setLoading(true); setNotice(''); setConfirmedUnknown(null);
    try { await operation(); }
    catch { if (active.current) { setData(null); setError(true); setNotice('The outcome could not be confirmed. Keep this attempt and check its status. It will not be resent automatically.'); } }
    finally { if (active.current) { busy.current = false; setLoading(false); } }
  }
  async function dispatch(run, captured) {
    if (!captured || captured.dispatched || run.status !== 'QUEUED') return;
    const next = { ...captured, runId: run.id, dispatched: true };
    if (!retain(next)) return;
    const result = accept(await portalAssistant.dispatch(projectId, token, run.id), next);
    if (active.current && result && result.status !== 'UNKNOWN') setQuestion('');
  }
  function send(event) {
    event.preventDefault();
    if (!data?.enabled || error || intent || storageError || !question.trim() || question.trim().length > 2000 || data.items.some(activeRun)) return;
    act(async () => {
      if (stored()) { restore(); return; }
      const captured = { key: crypto.randomUUID(), dispatched: false };
      try { if (!retain(captured)) return; } catch { setStorageError(true); throw Error('Storage unavailable'); }
      const message = question.trim();
      const receipt = await portalAssistant.create(projectId, token, { message, idempotencyKey: captured.key });
      if (receipt?.run?.message !== message) throw Error('Wrong request receipt');
      const run = accept(receipt, captured);
      if (run && active.current) await dispatch(run, { ...captured, runId: run.id });
    });
  }
  function checkIntent() {
    const captured = intent; if (!captured) return;
    act(async () => { const run = accept(await portalAssistant.byIntent(projectId, token, captured.key), captured); if (run && active.current) setNotice('Saved request status checked. Reload assistant history to verify current access.'); });
  }
  function checkReply(row) {
    const captured = intent?.runId === row.id ? intent : null;
    act(async () => {
      const run = accept(await portalAssistant.get(projectId, token, row.id), captured, row.id);
      if (run?.status === 'UNKNOWN' && captured && active.current && stored()?.key === captured.key) setConfirmedUnknown({ key: captured.key, runId: row.id });
    });
  }
  function continueWithNewQuestion() {
    if (!active.current || busy.current || !confirmedUnknown || error || !data?.enabled) return;
    try {
      const current = stored();
      if (current?.key !== confirmedUnknown.key || current.runId !== confirmedUnknown.runId || intent?.key !== confirmedUnknown.key) { restore(); return; }
      localStorage.removeItem(storageKey);
      if (localStorage.getItem(storageKey) !== null) throw Error('Intent not cleared');
      setIntent(null); setQuestion(''); setConfirmedUnknown(null);
      setNotice('The previous result remains unknown in your history and will not be retried. You can write a new question.');
    } catch { setStorageError(true); setConfirmedUnknown(null); }
  }
  const rows = error ? [] : data?.items || [];
  return <details className="rounded-xl border border-border bg-card p-4 sm:p-5" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary className="min-h-11 cursor-pointer font-semibold">Project AI assistant</summary>
    {open && <section aria-labelledby={`${field}-heading`} className="space-y-3 pt-3">
      <h3 id={`${field}-heading`} className="text-lg font-semibold">{data?.name || 'Project assistant'}</h3>
      <p className="text-sm text-muted-foreground">AI replies use limited information about this project. Check important details with your team. Sending a message does not create a task or request human follow-up.</p>
      <p className="text-sm">For a person, use Request human follow-up below.</p>
      {loading && <p role="status">Checking assistant…</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && <div role="alert">Browser storage could not safely track this attempt. New messages are paused.<Button type="button" onClick={restore}>Check browser storage</Button></div>}
      {intent && <div className="space-y-2 rounded border p-3"><p role="status">A saved attempt needs confirmation. New messages are paused to avoid duplicates.</p><Button type="button" disabled={loading} onClick={checkIntent}>Check saved request status</Button></div>}
      {confirmedUnknown && !error && <div className="space-y-2 rounded border p-3"><p>The previous result remains unknown. Continuing preserves its history and does not retry the old question. Your old draft will be cleared.</p><Button type="button" disabled={loading} onClick={continueWithNewQuestion}>Continue with a new question</Button></div>}
      {error && <p role="alert">The assistant is unavailable for this session. Previous replies are hidden until access is checked again.</p>}
      <Button type="button" variant="outline" disabled={loading} onClick={() => load()}>Reload assistant history</Button>
      {data && !error && !data.enabled && <p role="status">The project assistant is disabled or not configured. You can still request human follow-up.</p>}
      {data?.enabled && !error && <>
        <form onSubmit={send} className="space-y-2"><label htmlFor={field}>Message to the AI assistant</label><textarea id={field} className={inputStyles('min-h-24')} maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} disabled={loading || Boolean(intent) || storageError || rows.some(activeRun)} /><Button type="submit" disabled={loading || Boolean(intent) || storageError || rows.some(activeRun) || !question.trim()}>Send to AI assistant</Button></form>
        <ul className="space-y-3">{rows.map(run => <li key={run.id} className="space-y-2 rounded border p-3"><p className="whitespace-pre-wrap break-words">{run.message}</p><p className="font-medium">{LABELS[run.status]}</p>{run.response && <p className="whitespace-pre-wrap break-words">{run.response}</p>}
          <Button type="button" disabled={loading} onClick={() => checkReply(run)}>Check reply status</Button>
          {run.status === 'QUEUED' && intent?.runId === run.id && !intent.dispatched && <Button type="button" disabled={loading} onClick={() => act(() => dispatch(run, intent))}>Start saved request</Button>}
          {['QUEUED', 'RUNNING'].includes(run.status) && <><Button type="button" disabled={loading} onClick={() => act(async () => { accept(await portalAssistant.cancel(projectId, token, run.id), intent?.runId === run.id ? intent : null, run.id); })}>Cancel reply</Button><Button type="button" disabled={loading || Date.parse(run.deadlineAt) > Date.now()} onClick={() => act(async () => { accept(await portalAssistant.recover(projectId, token, run.id), intent?.runId === run.id ? intent : null, run.id); })}>Reconcile expired request</Button></>}
        </li>)}</ul>
        {data.nextCursor && <Button type="button" disabled={loading} onClick={() => load(data.nextCursor)}>Load earlier replies</Button>}
      </>}
    </section>}
  </details>;
}

export default function PortalAssistant({ projectId, token, identity }) {
  if (!projectId || ![identity?.organizationId, identity?.userId, identity?.contactId].every(idValid)) return <p role="status">Sign in again to use the project assistant securely.</p>;
  return <Assistant key={JSON.stringify([identity.organizationId, identity.userId, identity.contactId, projectId, token])} projectId={projectId} token={token} identity={identity} />;
}
