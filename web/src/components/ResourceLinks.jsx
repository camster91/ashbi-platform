import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';

const control = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const blank = () => ({ title: '', url: '', clientVisible: false });
export function safeResourceUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
}

// Each parent keys by canonical entity ID. Drafts belong to this mounted target,
// never to a changing query result; mutation revisions come from displayed rows.
export default function ResourceLinks({ entityType, entityId, readOnly = false, portalToken }) {
  const labelId = useId();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [pendingCreate, setPendingCreate] = useState(null);
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  const historyGeneration = useRef(0);
  const creationDraft = useRef(null);
  const writing = useRef(false);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true); setComplete(false); setError('');
    try {
      let after; let all = []; const cursors = new Set();
      do {
        const data = readOnly
          ? await api.portalProjectResourceLinks(entityId, portalToken, { limit: 100, ...(after ? { after } : {}) })
          : await api.listResourceLinks({ entityType, entityId, includeArchived: false, limit: 100, ...(after ? { after } : {}) });
        if (version !== generation.current) return false;
        if (!Array.isArray(data?.items)) throw new Error('Invalid resource list response.');
        all = [...all, ...data.items];
        if (new Set(all.map(row => row.id)).size !== all.length) throw new Error('The resource list changed while loading. Reload it before ordering.');
        setItems(all);
        after = data.nextCursor;
        if ((!readOnly && all.length > 500) || (after && (cursors.has(after) || (!readOnly && all.length >= 500)))) throw new Error('The complete active resource list could not be loaded. Ordering is unavailable.');
        cursors.add(after);
      } while (after);
      setComplete(true); return all;
    } catch (failure) {
      if (version === generation.current) setError(failure.message || 'Resources could not be loaded.');
      return false;
    } finally { if (version === generation.current) setLoading(false); }
  }, [entityType, entityId, portalToken, readOnly]);
  useEffect(() => { load(); return () => { generation.current += 1; historyGeneration.current += 1; }; }, [load]);
  async function loadHistory(after) {
    const version = ++historyGeneration.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      // The server returns active and archived records in this view. Browse a
      // single bounded page on demand; history never gates active operations.
      const data = await api.listResourceLinks({entityType, entityId, includeArchived:true, limit:100, ...(after ? {after} : {})});
      if (version !== historyGeneration.current) return;
      if (!Array.isArray(data?.items) || (after && data.nextCursor === after)) throw new Error('History could not be loaded.');
      setHistory(data.items.filter(row=>row.archivedAt)); setHistoryCursor(data.nextCursor || null);
    } catch (failure) { if (version === historyGeneration.current) setHistoryError(failure.message || 'History could not be loaded.'); }
    finally { if (version === historyGeneration.current) setHistoryLoading(false); }
  }
  function toggleHistory(checked) { setShowArchived(checked); if (checked) loadHistory(); else { historyGeneration.current += 1; setHistoryLoading(false); } }
  const active = items.filter(row => !row.archivedAt);
  const disabled = busy || loading || !complete || conflict;
  const unresolvedEditor = !!pendingCreate && !!editor && !editor.id;
  const open = row => { setEditor(row || {}); setDraft(row ? {title:row.title,url:row.url,clientVisible:row.clientVisible} : creationDraft.current || blank()); setFormError(''); };
  const close = () => { if (!busy && !unresolvedEditor) { if (!editor?.id) creationDraft.current = {...draft}; setEditor(null); setFormError(''); } };
  function deferCreation() { if (!busy) { setEditor(null); setFormError(''); } }
  function resumeCreation() {
    if (busy || editor || !pendingCreate) return;
    setDraft({title:pendingCreate.title, url:pendingCreate.url, clientVisible:pendingCreate.clientVisible});
    setEditor({}); setFormError('Creation outcome is unknown. Retry safely with the same creation ID.');
  }
  async function save(event, retryPayload) {
    event?.preventDefault();
    if (writing.current) return;
    writing.current = true;
    const creating = !editor.id;
    const payload = retryPayload || (creating && pendingCreate) || (creating
      ? { entityType, entityId, ...draft, createIntentId: crypto.randomUUID() }
      : { ...draft, expectedRevision: editor.revision });
    setBusy(true); setFormError('');
    try {
      if (creating) await api.createResourceLink(payload);
      else await api.updateResourceLink(editor.id, payload);
      if (creating) { setPendingCreate(null); creationDraft.current = null; }
      setEditor(null); setDraft(blank()); setNotice('Resource saved.');
      await load();
    } catch (failure) {
      if (creating) {
        if (!pendingCreate && !retryPayload && failure.status >= 400 && failure.status < 500 && ![408, 499].includes(failure.status)) { setPendingCreate(null); creationDraft.current = {...draft}; setFormError(failure.message || 'Creation was rejected. Your draft is retained.'); }
        else { setPendingCreate(payload); setFormError('Creation outcome is unknown. Keep this exact draft and retry safely with the same creation ID.'); }
      } else if (failure.status === 409) {
        setConflict(true); setFormError('This resource changed elsewhere. Your draft is retained. Review the latest saved version before trying again.');
        await load();
      } else setFormError(failure.message || 'The resource was not saved. Your draft is retained.');
    } finally { writing.current = false; setBusy(false); }
  }
  async function mutate(action) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice('Resources updated.'); await load(); if (showArchived) await loadHistory(); }
    catch (failure) { if (failure.status === 409) { setConflict(true); setError('Resources changed elsewhere. Reload and review the current order before trying again.'); } else setError(failure.message || 'Resources could not be updated. Reload before trying again.'); setComplete(false); }
    finally { writing.current = false; setBusy(false); }
  }
  function move(index, offset) {
    const ordered = [...active]; [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]];
    mutate(() => api.reorderResourceLinks({entityType, entityId, ordered:ordered.map(row => ({id:row.id, expectedRevision:row.revision}))}));
  }
  async function reviewLatest() {
    if (editor?.id) {
      // Acknowledge exactly the saved snapshot visible beside the draft. A new
      // network read here could accept a revision the user has never reviewed.
      if (!complete || loading) return;
      const saved = items.find(row => row.id === editor.id);
      if (!saved || !saved.canEdit || saved.archivedAt) { setFormError('This resource is unavailable for editing. Your draft is retained for copying.'); return; }
      setEditor(saved);
    } else if (!await load()) return;
    setConflict(false); setFormError(''); setNotice('Latest saved resources loaded. Review before saving your retained draft.');
  }
  return <section className="my-6 min-w-0 rounded-xl border border-border bg-card p-4" aria-labelledby={labelId}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id={labelId} className="font-semibold">Resources</h2><div className="flex flex-wrap gap-2"><button type="button" className={control} onClick={load} disabled={busy || loading}>Reload resources</button>{!readOnly && <button type="button" className={control} disabled={disabled || !!editor || !!pendingCreate} onClick={()=>open()}>Add resource</button>}</div></div>
    <p className="my-2 text-sm text-muted-foreground">Named links to briefs, folders and other resources. Sharing a link does not grant access to its external service.</p>
    {loading && <p role="status">Loading resources…</p>}
    {error && <p role="alert" className="my-2 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="my-2 text-sm">{notice}</p>}
    {pendingCreate && !unresolvedEditor && <div className="my-3 space-y-2 rounded-lg border border-border p-3"><p role="status" className="text-sm">One resource creation remains unresolved. Its exact draft and creation ID are retained. Resolve it before adding another resource; other resource work can continue.</p><button type="button" className={control} disabled={busy || !!editor} onClick={resumeCreation}>Resume exact creation</button></div>}
    {conflict && !editor && <button type="button" className={control} disabled={busy || loading} onClick={reviewLatest}>Load latest resources for review</button>}
    {!loading && !error && !items.length && <p className="py-3 text-sm text-muted-foreground">{readOnly ? 'No resources yet.' : 'No active resources yet.'}</p>}
    {!readOnly && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} disabled={busy} onChange={event=>toggleHistory(event.target.checked)}/>Show archived resources</label>}
    {showArchived && !readOnly && <div className="my-3 space-y-2"><h3 className="text-sm font-medium">Archived history</h3><p className="text-sm text-muted-foreground">History is browsed one page at a time; a page may contain active resources only.</p>{historyLoading && <p role="status">Loading history…</p>}{historyError && <p role="alert">{historyError}</p>}{!historyLoading && !historyError && !history.length && <p className="text-sm">No archived resources on this page.</p>}<div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={historyLoading || busy} onClick={()=>loadHistory()}>First history page</button>{historyCursor && <button type="button" className={control} disabled={historyLoading || busy} onClick={()=>loadHistory(historyCursor)}>Next history page</button>}</div></div>}
    <ul className="space-y-3">{[...active, ...(!readOnly && showArchived ? history.filter(row=>!active.some(saved=>saved.id===row.id)) : [])].map(row => <li key={row.id} className="min-w-0 rounded-lg border border-border p-3">
      {safeResourceUrl(row.url) ? <a href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`${row.title} (opens in new tab)`} className="inline-flex min-h-11 max-w-full items-center break-all rounded text-sm font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{row.title}</a> : <p className="break-all text-sm">{row.title}<span className="block text-destructive">This resource URL is unavailable.</span></p>}
      {!readOnly && <><p className="text-xs text-muted-foreground">{row.archivedAt ? 'Archived · ' : ''}{row.clientVisible ? 'Shared with client portal' : 'Internal only'}</p><div className="mt-2 flex flex-wrap gap-2">{row.canEdit && <>{!row.archivedAt && <button type="button" className={control} disabled={disabled || !!editor} aria-label={`Edit ${row.title}`} onClick={()=>open(row)}>Edit</button>}<button type="button" className={control} disabled={disabled || !!editor} aria-label={`${row.archivedAt ? 'Restore' : 'Archive'} ${row.title}`} onClick={()=>mutate(()=>api.archiveResourceLink(row.id,{expectedRevision:row.revision,archived:!row.archivedAt}))}>{row.archivedAt ? 'Restore' : 'Archive'}</button></>}{!row.archivedAt && <><button type="button" className={control} disabled={disabled || !!editor || active.length > 500 || active.indexOf(row) === 0} aria-label={`Move ${row.title} up`} onClick={()=>move(active.indexOf(row),-1)}>Move up</button><button type="button" className={control} disabled={disabled || !!editor || active.length > 500 || active.indexOf(row) === active.length-1} aria-label={`Move ${row.title} down`} onClick={()=>move(active.indexOf(row),1)}>Move down</button></>}</div></>}
    </li>)}</ul>
    <Modal isOpen={!!editor} onClose={close} title={editor?.id ? 'Edit resource' : 'Add resource'} showCloseButton={!busy && !unresolvedEditor}>
      <form onSubmit={save} className="space-y-4">
        <label className="block text-sm">Resource title<input className={`${control} mt-1 w-full`} required maxLength={500} value={draft.title} disabled={busy || unresolvedEditor} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
        <label className="block text-sm">Resource URL<input className={`${control} mt-1 w-full`} type="url" required maxLength={8192} value={draft.url} disabled={busy || unresolvedEditor} onChange={event=>setDraft({...draft,url:event.target.value})}/></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.clientVisible} disabled={busy || unresolvedEditor} onChange={event=>setDraft({...draft,clientVisible:event.target.checked})}/>Share with client portal</label>
        <p className="text-sm text-muted-foreground">Internal by default. Portal sharing still requires permission in the external service.</p>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        {conflict && <><p className="break-all text-sm">Latest saved title: {items.find(row=>row.id===editor?.id)?.title || 'Unavailable'}. Latest saved URL: {items.find(row=>row.id===editor?.id)?.url || 'Unavailable'}. Latest saved visibility: {items.find(row=>row.id===editor?.id)?.clientVisible ? 'Shared with client portal' : 'Internal only'}</p><button type="button" className={control} disabled={busy || loading || !complete} onClick={reviewLatest}>Use latest revision, keep my draft</button></>}
        <div className="flex flex-wrap gap-2">{unresolvedEditor ? <><button type="button" className={control} disabled={busy} onClick={()=>save(null,pendingCreate)}>Retry exact creation</button><button type="button" className={control} disabled={busy} onClick={deferCreation}>Defer unresolved creation</button></> : <button type="submit" className={control} disabled={busy || conflict}>Save resource</button>}<button type="button" className={control} disabled={busy || unresolvedEditor} onClick={close}>Cancel</button></div>
      </form>
    </Modal>
  </section>;
}
