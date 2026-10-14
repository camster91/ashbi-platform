import { useState } from 'react';
import { api } from '../lib/api';

export default function DocumentSaveRecovery({ noteId, draft, error, onReload }) {
  const [loading, setLoading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  if (!error) return null;
  return <div role="region" aria-label="Document save recovery" className="my-3 rounded border border-destructive/30 p-3 space-y-2">
    <p role="alert">{error.message || 'Document could not be saved.'} Your draft is retained.</p>
    <p className="text-sm">Download your draft before reloading if you want to keep it for comparison.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 underline" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'document-draft.json'; link.click(); URL.revokeObjectURL(url);
      }}>Download draft</button>
      <button type="button" className="min-h-11 underline" disabled={loading} onClick={async () => {
        setLoading(true); setReloadError('');
        try { const current = await api.getNote(noteId); onReload(current); }
        catch { setReloadError('The document could not be reloaded. Your draft is still retained.'); }
        finally { setLoading(false); }
      }}>{loading ? 'Reloading…' : 'Reload document and discard draft'}</button>
    </div>
    {reloadError && <p role="alert">{reloadError}</p>}
  </div>;
}
