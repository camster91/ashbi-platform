import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { Camera, FileText, Paperclip, PenLine, RotateCcw, Video, X } from 'lucide-react';
import { UPLOAD_ACCEPT, formatBytes } from '../../lib/upload';
import { captureSupport } from '../../lib/media-recorder';
import { cn } from '../../lib/utils';

// The capture and markup dialog (getDisplayMedia, MediaRecorder, canvas
// compositing and the markup editor) is its own chunk, loaded on first use,
// so it never weighs on the chat or client-portal route chunks.
const loadCaptureDialog = () => import('./CaptureDialog');
const CaptureDialog = lazy(loadCaptureDialog);
const prefetchCaptureDialog = () => { loadCaptureDialog().catch(() => {}); };

const toolButtonClass = 'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Paste (clipboard screenshots and files) and drag-and-drop for a composer.
 * Spread `handlers` on the composer element.
 * @param {ReturnType<typeof import('./useAttachmentDraft').useAttachmentDraft>} draft
 * @param {{ disabled?: boolean }} [options]
 */
export function useDropAndPaste(draft, { disabled = false } = {}) {
  const [dragging, setDragging] = useState(false);
  const onPaste = useCallback((event) => {
    if (disabled) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    draft.addFiles(files, { fallbackBase: `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}` });
  }, [draft, disabled]);
  const onDragOver = useCallback((event) => {
    if (disabled || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  }, [disabled]);
  const onDragLeave = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragging(false);
  }, []);
  const onDrop = useCallback((event) => {
    if (disabled || !event.dataTransfer?.files?.length) return;
    event.preventDefault();
    setDragging(false);
    draft.addFiles(event.dataTransfer.files);
  }, [draft, disabled]);
  return { dragging, handlers: { onPaste, onDragOver, onDragLeave, onDrop } };
}

/**
 * The lazily loaded capture/markup dialog for a composer. Render `element`
 * once; pass the controller to the toolbar and the tray.
 * @param {ReturnType<typeof import('./useAttachmentDraft').useAttachmentDraft>} draft
 */
export function useCaptureDialog(draft) {
  const [capture, setCapture] = useState(null);
  const support = useMemo(() => captureSupport(), []);
  const open = useCallback((mode, extra = {}) => { prefetchCaptureDialog(); setCapture({ mode, ...extra }); }, []);
  const element = capture ? (
    <Suspense fallback={<span role="status" className="sr-only">Opening capture tools…</span>}>
      <CaptureDialog
        mode={capture.mode}
        file={capture.file}
        support={support}
        onClose={() => setCapture(null)}
        onAttach={(file) => {
          if (capture.replaceLocalId) draft.replace(capture.replaceLocalId, file);
          else draft.addFiles([file]);
          setCapture(null);
        }}
      />
    </Suspense>
  ) : null;
  return { support, open, element, active: Boolean(capture) };
}

/**
 * Attach / Screenshot / Record buttons for a chat composer. Screen options are
 * hidden where the browser cannot capture the screen (iOS, most mobile);
 * camera recording and files remain.
 */
export function AttachmentToolbar({ draft, capture, disabled = false, showLabels = true }) {
  const fileInputRef = useRef(null);
  const { support } = capture;
  const full = !draft.canAddMore;

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || full}
        aria-label="Attach a file to this message"
        className={toolButtonClass}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {showLabels && <span className="hidden sm:inline" aria-hidden="true">Attach</span>}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        onChange={(event) => { draft.addFiles(event.target.files); event.target.value = ''; }}
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
      />
      {support.screenshot && (
        <button
          type="button"
          onClick={() => capture.open('screenshot')}
          onPointerEnter={prefetchCaptureDialog}
          onFocus={prefetchCaptureDialog}
          disabled={disabled || full}
          aria-label="Take a screenshot to attach"
          className={toolButtonClass}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          {showLabels && <span className="hidden md:inline" aria-hidden="true">Screenshot</span>}
        </button>
      )}
      {support.record && (
        <button
          type="button"
          onClick={() => capture.open('record')}
          onPointerEnter={prefetchCaptureDialog}
          onFocus={prefetchCaptureDialog}
          disabled={disabled || full}
          aria-label={support.screen ? 'Record your screen or camera to attach' : 'Record a camera video to attach'}
          className={toolButtonClass}
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          {showLabels && <span className="hidden md:inline" aria-hidden="true">Record</span>}
        </button>
      )}
    </>
  );
}

/** The files of the message being written, with progress, retry and remove. */
export function AttachmentTray({ draft, capture, className }) {
  if (!draft.items.length && !draft.notice) return null;
  return (
    <div className={cn('space-y-1', className)}>
      {draft.items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Files to send with this message">
          {draft.items.map((item) => {
            const percent = Math.round((item.progress || 0) * 100);
            return (
              <li key={item.localId} className="relative flex w-56 items-center gap-2 rounded-lg border border-border bg-background p-2 text-xs text-foreground">
                {item.kind === 'image' && item.previewUrl
                  ? <img src={item.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                  : item.kind === 'video'
                    ? <Video className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
                    : <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={item.name}>{item.name}</p>
                  {item.status === 'uploading' && (
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${item.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
                    >
                      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  {item.status === 'ready' && <p className="text-muted-foreground">{formatBytes(item.size)}</p>}
                  {item.status === 'error' && <p role="alert" className="text-destructive">{item.error}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {item.status === 'error' && (
                    <button type="button" onClick={() => draft.retry(item.localId)} aria-label={`Retry uploading ${item.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  {item.kind === 'image' && item.mimeType !== 'image/gif' && capture && (
                    <button type="button" onClick={() => capture.open('markup', { file: item.file, replaceLocalId: item.localId })} aria-label={`Mark up ${item.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" onClick={() => draft.remove(item.localId)} aria-label={`Remove ${item.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {draft.notice && <p role="alert" className="text-xs text-destructive">{draft.notice}</p>}
      {draft.uploading && <p role="status" className="text-xs text-muted-foreground">Uploading… you can send once uploads finish.</p>}
    </div>
  );
}
