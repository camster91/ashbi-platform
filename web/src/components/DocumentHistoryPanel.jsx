import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import Button from './ui/Button';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

function History({ kind, documentId, currentRevision, onRestored, user, open: controlledOpen, onOpenChange, hideTrigger = false }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (nextOpen) => {
    if (controlledOpen === undefined) setLocalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [selected, setSelected] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const active = useRef(true);
  const busy = useRef(false);
  const cache = useQueryClient();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const queryKey = ['document-history', user.id, kind, documentId];
  const history = useQuery({ queryKey, queryFn: () => api.listDocumentHistory(kind, documentId), enabled: open, retry: false, staleTime: 0 });
  const detail = useQuery({ queryKey: [...queryKey, 'revision', selected], queryFn: () => api.getDocumentRevision(kind, documentId, selected), enabled: open && selected !== null && !accessDenied && !history.isError && !history.isFetching, retry: false, staleTime: 0 });
  const canRestore = user.role === 'ADMIN' && Number.isInteger(currentRevision) && currentRevision >= 1;
  const readable = !accessDenied && !history.isError && !history.isFetching && history.data;
  const preview = readable && !detail.isError && !detail.isFetching && selected !== null && detail.data;
  const close = () => { if (!busy.current) { setOpen(false); setConfirmation(null); setSelected(null); setError(''); setConflict(false); } };

  async function restore() {
    if (busy.current || !canRestore || !confirmation || conflict || confirmation.currentRevision !== currentRevision) return;
    busy.current = true; setPending(true); setError('');
    try {
      const saved = await api.restoreDocumentRevision(kind, documentId, confirmation.version, { revision: confirmation.currentRevision });
      await cache.invalidateQueries({ queryKey });
      if (!active.current) return;
      setConfirmation(null); setSelected(null); setOpen(false);
      onRestored?.(saved);
    } catch (failure) {
      if (!active.current) return;
      if ([401, 403, 404].includes(failure.status ?? failure.statusCode)) {
        setAccessDenied(true); setConfirmation(null); setSelected(null);
      } else if (failure.status === 409 || failure.statusCode === 409) {
        setConflict(true);
        setError('This document changed. Your editor draft is preserved. Close history and reload the saved document before restoring.');
      } else setError('The revision could not be restored. Your editor draft is preserved. Try again.');
    } finally { busy.current = false; if (active.current) setPending(false); }
  }

  return <>
    {!hideTrigger && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Version history</Button>}
    <Modal isOpen={open && !confirmation} onClose={close} title="Version history" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Keeps the last 100 recorded revisions, including the current version. No automatic time-based purge.</p>
        {history.isFetching && <p role="status">Loading version history…</p>}
        {(history.isError || accessDenied) && <div role="alert"><p>Version history is unavailable or you no longer have access.</p><Button type="button" variant="outline" onClick={async () => { const result = await history.refetch(); if (!result.isError) setAccessDenied(false); }}>Retry history</Button></div>}
        {readable && <>
          {!history.data.items?.length && <p>No recorded revisions yet.</p>}
          <ol className="max-h-64 space-y-2 overflow-auto" aria-label="Recorded revisions">
            {(history.data.items || []).slice(0, 100).map((item) => <li key={item.revision}>
              <Button type="button" variant="outline" aria-pressed={selected === item.revision} onClick={() => setSelected(item.revision)}>
                Version {item.revision}{item.isCurrent ? ' (current)' : ''}: {item.title || 'Untitled'}
              </Button>
              <p className="text-xs text-muted-foreground">{item.recordedAt ? new Date(item.recordedAt).toLocaleString() : 'Recording date unavailable'} · {item.editedById ? 'Staff editor' : 'Editor unavailable'}</p>
            </li>)}
          </ol>
          {selected !== null && detail.isFetching && <p role="status">Loading revision…</p>}
          {selected !== null && detail.isError && <div role="alert"><p>This revision is unavailable or you no longer have access.</p><Button type="button" variant="outline" onClick={() => detail.refetch()}>Retry revision</Button></div>}
          {preview && <section aria-label={`Preview of version ${selected}`} className="space-y-3">
            <h3 className="font-medium">{detail.data.title || 'Untitled'}</h3>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-sm">{typeof detail.data.content === 'string' ? detail.data.content : JSON.stringify(detail.data.content ?? '', null, 2)}</pre>
            {canRestore && selected !== currentRevision && <Button type="button" onClick={() => { setError(''); setConflict(false); setConfirmation({ version: selected, currentRevision }); }}>Restore this version</Button>}
            {!canRestore && <p className="text-sm text-muted-foreground">Only admins can restore a revision after the current document is loaded.</p>}
          </section>}
        </>}
      </div>
    </Modal>
    <ConfirmDialog isOpen={open && Boolean(confirmation)} title={`Restore version ${confirmation?.version}?`} confirmLabel="Confirm restore" pending={pending} error={error || (confirmation && confirmation.currentRevision !== currentRevision ? 'This document changed. Cancel and review its current version before restoring.' : '')} onCancel={() => { setConfirmation(null); setError(''); }} onConfirm={restore}
      description="This replaces the current title and content and creates a new revision. Unsaved editor changes may be replaced. Sharing, parent placement and mentions stay unchanged. History cannot recover deleted files."
    />
  </>;
}

export default function DocumentHistoryPanel(props) {
  const { user } = useAuth();
  if (!user?.id || !['ADMIN', 'TEAM'].includes(user.role) || !props.documentId || !['note', 'page'].includes(props.kind)) return null;
  // Remount local selection and confirmation state whenever identity or document changes.
  return <History key={`${user.id}:${user.role}:${props.kind}:${props.documentId}`} {...props} user={user} />;
}
