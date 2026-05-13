// React hook for debounced autosave to the Draft API
// Usage in any form component:
//   const { draft, saveDraft, clearDraft, draftMeta, isSaving } = useAutosave('proposal', proposalId, formData, 500);

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api.js';

const DEBOUNCE_MS = 500;

export default function useAutosave(entity, id, formData, debounceMs = DEBOUNCE_MS) {
  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMeta, setDraftMeta] = useState(null); // { draftSavedAt }
  const [lastSaved, setLastSaved] = useState(null);
  const timerRef = useRef(null);
  const prevRef = useRef(null);

  // Load existing draft on mount
  useEffect(() => {
    if (!entity || !id) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await api.getDraft(entity, id);
        if (!cancelled && res.draft) {
          setDraft(res.draft);
          setDraftMeta({ draftSavedAt: res.draftSavedAt });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entity, id]);

  // Debounced save on formData change
  useEffect(() => {
    if (!entity || !id || !formData) return;

    // Only save if data actually changed (deep comparison simplified)
    const prev = JSON.stringify(prevRef.current);
    const next = JSON.stringify(formData);
    if (prev === next) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await api.saveDraft(entity, id, formData);
        prevRef.current = formData;
        setLastSaved(new Date().toISOString());
      } catch (err) {
        console.error('[autosave] failed', err);
      } finally {
        setIsSaving(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [entity, id, formData, debounceMs]);

  // Clear draft (call on successful explicit save)
  const clearDraft = useCallback(async () => {
    if (!entity || !id) return;
    setIsSaving(true);
    try {
      await api.clearDraft(entity, id);
      setDraft(null);
      setDraftMeta(null);
      prevRef.current = null;
    } catch (err) {
      console.error('[autosave] clear failed', err);
    } finally {
      setIsSaving(false);
    }
  }, [entity, id]);

  // Manual save (for "Save Now" button)
  const saveNow = useCallback(async (data) => {
    if (!entity || !id) return;
    setIsSaving(true);
    try {
      await api.saveDraft(entity, id, data || formData);
      prevRef.current = data || formData;
      setLastSaved(new Date().toISOString());
    } catch (err) {
      console.error('[autosave] manual save failed', err);
    } finally {
      setIsSaving(false);
    }
  }, [entity, id, formData]);

  return { draft, setDraft, isSaving, isLoading, draftMeta, lastSaved, clearDraft, saveNow };
}
