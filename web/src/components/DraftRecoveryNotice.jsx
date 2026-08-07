function savedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function DraftRecoveryNotice({
  draft,
  draftSavedAt,
  status = 'idle',
  lastSaved,
  onRecover,
  onDiscard,
  onRetry,
}) {
  if (draft) {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">Unsaved draft found</p>
        <p className="mt-0.5 text-xs">{savedTime(draftSavedAt) ? `Saved ${savedTime(draftSavedAt)}` : 'Review it before replacing the current form.'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => onRecover?.(draft)} className="rounded-full bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white">
            Recover draft
          </button>
          <button type="button" onClick={onDiscard} className="rounded-full border border-amber-500 px-3 py-1.5 text-xs font-semibold">
            Discard draft
          </button>
        </div>
      </div>
    );
  }

  if (status === 'conflict') {
    return <p role="alert" className="text-sm font-medium text-red-700">A newer draft exists in another tab. Reload and choose which version to keep.</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm font-medium text-red-700">
        <span>Your draft could not be saved. Keep this page open and try again.</span>
        {onRetry && <button type="button" onClick={onRetry} className="underline">Try saving again</button>}
      </div>
    );
  }
  if (status === 'saving') {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Saving draft…</p>;
  }
  if (status === 'unsaved') {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Unsaved changes</p>;
  }
  if (status === 'saved') {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Draft saved{savedTime(lastSaved) ? ` ${savedTime(lastSaved)}` : ''}</p>;
  }
  return null;
}
