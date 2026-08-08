import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../lib/api.js';

const DEBOUNCE_MS = 500;

export default function useAutosave(entity, id, formData, debounceMs = DEBOUNCE_MS, options = {}) {
  const [draft, setDraft] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('idle');
  const [lastSaved, setLastSaved] = useState(null);
  const [revision, setRevision] = useState(null);
  const [draftMeta, setDraftMeta] = useState(null);
  const timerRef = useRef(null);
  const initializedRef = useRef(false);
  const previousRef = useRef(null);
  const formDataRef = useRef(formData);
  const revisionRef = useRef(null);
  formDataRef.current = formData;

  useEffect(() => {
    initializedRef.current = false;
    previousRef.current = null;
    revisionRef.current = null;
    if (!entity || !id) return undefined;
    let cancelled = false;
    setIsLoading(true);
    setStatus('loading');
    api.getDraft(entity, id)
      .then((res) => {
        if (cancelled) return;
        setDraft(res.draft ?? null);
        const loadedRevision = res.revision ?? null;
        revisionRef.current = loadedRevision;
        setRevision(loadedRevision);
        setDraftMeta(res.draft ? {
          draftSavedAt: res.draftSavedAt,
          baseUpdatedAt: res.baseUpdatedAt,
          expiresAt: res.expiresAt,
        } : null);
        previousRef.current = JSON.stringify(formDataRef.current);
        initializedRef.current = true;
        setStatus('idle');
      })
      .catch(() => {
        if (cancelled) return;
        previousRef.current = JSON.stringify(formDataRef.current);
        initializedRef.current = true;
        setStatus('error');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [entity, id]);

  const persist = useCallback(async (data = formDataRef.current) => {
    if (!entity || !id || data == null) return false;
    const serialized = JSON.stringify(data);
    setStatus('saving');
    try {
      const result = await api.saveDraft(entity, id, data, revisionRef.current ?? undefined, options.baseUpdatedAt);
      previousRef.current = serialized;
      revisionRef.current = result.revision;
      setRevision(result.revision);
      setLastSaved(result.draftSavedAt ?? result.savedAt ?? new Date().toISOString());
      setStatus('saved');
      return true;
    } catch (error) {
      setStatus(error?.status === 409 || error?.data?.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error');
      return false;
    }
  }, [entity, id, options.baseUpdatedAt]);

  useEffect(() => {
    if (!initializedRef.current || !entity || !id || formData == null) return undefined;
    const serialized = JSON.stringify(formData);
    if (serialized === previousRef.current) return undefined;
    setStatus('unsaved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(formData), debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [entity, id, formData, debounceMs, persist]);

  useEffect(() => {
    if (!['unsaved', 'saving', 'error', 'conflict'].includes(status)) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [status]);

  const clearDraft = useCallback(async () => {
    if (!entity || !id) return false;
    setStatus('saving');
    try {
      await api.clearDraft(entity, id, revisionRef.current ?? undefined);
      setDraft(null);
      setDraftMeta(null);
      revisionRef.current = null;
      setRevision(null);
      previousRef.current = JSON.stringify(formDataRef.current);
      setStatus('idle');
      return true;
    } catch (error) {
      setStatus(error?.status === 409 || error?.data?.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error');
      return false;
    }
  }, [entity, id]);

  const discardDraft = useCallback(async () => clearDraft(), [clearDraft]);

  return {
    draft,
    setDraft,
    isSaving: status === 'saving',
    isLoading,
    status,
    lastSaved,
    revision,
    draftMeta,
    clearDraft,
    discardDraft,
    saveNow: persist,
  };
}
