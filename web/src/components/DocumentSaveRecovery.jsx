import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export default function DocumentSaveRecovery({ noteId, draft, error, onReload, loadCurrent, onReconcile, busy = false }) {
  const [loading, setLoading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [comparison, setComparison] = useState(null);
  const [merged, setMerged] = useState({ title: '', content: '' });
  const generation = useRef({});
  const identity = useRef({ noteId, error, busy });
  identity.current = { noteId, error, busy };
  useEffect(() => {
    generation.current = {};
    setComparison(null); setLoading(false); setReloadError('');
    return () => { generation.current = {}; };
  }, [noteId, error, busy]);
  const draftSignature = JSON.stringify(draft);
  const visibleComparison = !busy && comparison?.noteId === noteId && comparison?.error === error ? comparison : null;
  const unchangedDraft = visibleComparison?.draftSignature === draftSignature;
  async function load(compare) {
    const attempt = {}; generation.current = attempt;
    const captured = { noteId, error, draftSignature };
    setLoading(true); setReloadError(''); setComparison(null);
    try {
      const current = await (loadCurrent ? loadCurrent() : api.getNote(noteId));
      if (generation.current !== attempt || identity.current.noteId !== noteId || identity.current.error !== error || identity.current.busy) return;
      if (!current || current.id !== noteId || !Number.isSafeInteger(current.revision) || current.revision < 0 || typeof current.title !== 'string' || typeof current.content !== 'string' || current.permissions?.canEdit !== true) throw new Error('Unavailable document');
      if (compare) {
        setMerged({ title: draft.title || '', content: draft.content || '' });
        setComparison({ ...captured, current });
      } else onReload(current);
    } catch {
      if (generation.current === attempt) { setComparison(null); setReloadError('The document could not be reloaded. Your draft is still retained.'); }
    } finally {
      if (generation.current === attempt) setLoading(false);
    }
  }
  if (!error) return null;
  return <div role="region" aria-label="Document save recovery" className="my-3 rounded border border-destructive/30 p-3 space-y-2">
    <p role="alert">{error.message || 'Document could not be saved.'} Your draft is retained.</p>
    <p className="text-sm">Download your draft before reloading if you want to keep it for comparison.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 underline" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'document-draft.json'; link.click(); URL.revokeObjectURL(url);
      }}>Download draft</button>
      {onReconcile && <button type="button" className="min-h-11 underline" disabled={loading || busy} onClick={() => load(true)}>Compare latest saved document</button>}
      <button type="button" className="min-h-11 underline" disabled={loading || busy} onClick={() => load(false)}>{loading ? 'Reloading…' : 'Reload document and discard draft'}</button>
    </div>
    {visibleComparison && <section aria-label="Review document merge" className="space-y-3">
      <p>Latest saved revision: {visibleComparison.current.revision}. Compare the text, then prepare your own merged draft. Nothing is saved automatically.</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0"><h3>Latest saved text</h3><p className="whitespace-pre-wrap break-words">{visibleComparison.current.title}</p><pre className="whitespace-pre-wrap break-words font-sans">{visibleComparison.current.content}</pre></div>
        <div className="min-w-0"><h3>Your original draft</h3><p className="whitespace-pre-wrap break-words">{draft.title}</p><pre className="whitespace-pre-wrap break-words font-sans">{draft.content}</pre></div>
      </div>
      <p>Other fields will use the latest saved values. Download your original draft to retain any unsaved metadata changes.</p>
      <details><summary>Compare other fields</summary><h4>Latest saved fields</h4><pre className="whitespace-pre-wrap break-words">{JSON.stringify(Object.fromEntries(Object.entries(visibleComparison.current).filter(([key]) => ['type', 'tags', 'parentId', 'mentions', 'isTemplate'].includes(key))), null, 2)}</pre><h4>Your draft fields</h4><pre className="whitespace-pre-wrap break-words">{JSON.stringify(Object.fromEntries(Object.entries(draft).filter(([key]) => !['title', 'content', 'revision'].includes(key))), null, 2)}</pre></details>
      <label className="block">Reviewed merged title<input className="block min-h-11 w-full rounded border bg-card px-3" maxLength={200} value={merged.title} onChange={event => setMerged({ ...merged, title: event.target.value })} /></label>
      <label className="block">Reviewed merged content<textarea className="block min-h-32 w-full rounded border bg-card px-3" maxLength={50000} value={merged.content} onChange={event => setMerged({ ...merged, content: event.target.value })} /></label>
      {!unchangedDraft && <p role="alert">Your draft changed during comparison. Compare again before preparing a merged draft.</p>}
      <button type="button" className="min-h-11 underline" disabled={loading || busy || !unchangedDraft || !merged.title.trim()} onClick={() => { onReconcile({ current: visibleComparison.current, draft: { ...merged } }); setComparison(null); }}>Use reviewed merge in editor</button>
    </section>}
    {reloadError && <p role="alert">{reloadError}</p>}
  </div>;
}
