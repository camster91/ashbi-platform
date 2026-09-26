import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileText, MapPin, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';

// Shared review surface for the staff page (/review/:id) and the client
// share-link page (/portal/review/:token), #417 / docs/media-review.md.
//
// Accessibility: the comment list is the equivalent of the pins on the image
// (each entry spells out its anchor); pins are labelled buttons; a point can
// be chosen with the pointer or with the labelled position fields; status
// changes are announced in a polite live region and focus moves to the new
// comment or to the field that needs attention.

export const BODY_LIMIT = 5000;
const NOTE_LIMIT = 2000;

export const REVIEW_STATUS_LABELS = {
  open: 'Open',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  closed: 'Closed',
};

const STATUS_STYLES = {
  open: 'bg-muted text-foreground',
  approved: 'bg-success text-success-foreground',
  changes_requested: 'bg-warning text-warning-foreground',
  closed: 'bg-muted text-muted-foreground',
};

/** Who wrote a comment or decision: team members, or clients via a share link. */
export function authorRole(type) {
  return type === 'guest' ? 'Client (via share link)' : 'Team';
}

const control = 'min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonBase = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const buttonOutline = cn(buttonBase, 'border border-border text-foreground hover:bg-muted');
const buttonPrimary = cn(buttonBase, 'bg-primary text-primary-foreground hover:bg-primary/90');

export function StatusBadge({ status }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[status] || STATUS_STYLES.open)}>
      {REVIEW_STATUS_LABELS[status] || status}
    </span>
  );
}

/** 65432 ms -> "1:05"; 3723000 ms -> "1:02:03". */
export function formatTimecode(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const percent = (value) => Math.round(value * 100);

/** Plain-language anchor for the list view (the pins' text equivalent). */
export function describeAnchor(annotation) {
  if (annotation.timecodeMs !== null && annotation.timecodeMs !== undefined) return `at ${formatTimecode(annotation.timecodeMs)}`;
  if (annotation.pageNumber) return `page ${annotation.pageNumber}`;
  if (annotation.region) {
    const x = annotation.region.x + annotation.region.w / 2;
    const y = annotation.region.y + annotation.region.h / 2;
    return `pinned at ${percent(x)}% across, ${percent(y)}% down`;
  }
  return 'general comment';
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function MediaViewer({ media, pins, selectedId, onSelectPin, draftPoint, onPickPoint, videoRef, canPick }) {
  if (media.kind === 'image') {
    const pick = (event) => {
      if (!canPick) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      onPickPoint({
        x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
        y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
      });
    };
    return (
      <figure className="space-y-2">
        <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
          {/* Pointer shortcut only: the "Pin to a point" fields are the keyboard path. */}
          <img src={media.url} alt={`Reviewed image: ${media.fileName}`} className={cn('block h-auto w-full', canPick && 'cursor-crosshair')} onClick={pick} />
          {pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              onClick={() => onSelectPin(pin.id)}
              aria-label={`Comment ${pin.number} by ${pin.authorName}, ${describeAnchor(pin)}`}
              aria-pressed={selectedId === pin.id}
              className={cn(
                'absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background text-xs font-bold shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selectedId === pin.id ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground',
              )}
              style={{ left: `${(pin.region.x + pin.region.w / 2) * 100}%`, top: `${(pin.region.y + pin.region.h / 2) * 100}%` }}
            >
              {pin.number}
            </button>
          ))}
          {draftPoint && (
            <span aria-hidden="true" className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-foreground bg-background/60" style={{ left: `${draftPoint.x}%`, top: `${draftPoint.y}%` }} />
          )}
        </div>
        <figcaption className="text-xs text-muted-foreground">
          {media.fileName}. {canPick ? 'Select a point on the image, or use the position fields in the comment form, to pin a comment.' : ''}
        </figcaption>
      </figure>
    );
  }
  if (media.kind === 'video') {
    return (
      <figure className="space-y-2">
        {/* Review media has no captions track: the comments are its text companion. */}
        <video ref={videoRef} src={media.url} controls preload="metadata" className="block w-full rounded-lg border border-border bg-black" aria-label={`Reviewed video: ${media.fileName}`} />
        <figcaption className="text-xs text-muted-foreground">{media.fileName}. Comments can be pinned to the current playback time.</figcaption>
      </figure>
    );
  }
  if (media.kind === 'audio') {
    return (
      <figure className="space-y-2">
        <audio ref={videoRef} src={media.url} controls preload="metadata" className="w-full" aria-label={`Reviewed audio: ${media.fileName}`} />
        <figcaption className="text-xs text-muted-foreground">{media.fileName}. Comments can be pinned to the current playback time.</figcaption>
      </figure>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-foreground">{media.fileName}</p>
      {/* The file route sends the PDF as a download (Content-Disposition: attachment). */}
      <a href={media.url} download={media.fileName} rel="noreferrer" className={buttonOutline}>
        <span aria-hidden="true">Download PDF</span><span className="sr-only">Download PDF ({media.fileName})</span>
      </a>
      <p className="text-xs text-muted-foreground">Comments can name the page they refer to.</p>
    </div>
  );
}

function CommentForm({ kind, onSubmit, draftPoint, setDraftPoint, videoRef, guest, parent, onCancel, labelledBy }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [anchor, setAnchor] = useState(parent ? 'none' : (kind === 'video' || kind === 'audio') ? 'time' : 'none');
  const [page, setPage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const bodyRef = useRef(null);
  const nameRef = guest?.nameRef;

  useEffect(() => { if (parent) bodyRef.current?.focus(); }, [parent]);
  useEffect(() => {
    if (!parent && kind === 'image' && draftPoint) setAnchor('point');
  }, [draftPoint, kind, parent]);

  const submit = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (guest && !guest.name.trim()) {
      setError('Enter your name before commenting.');
      nameRef?.current?.focus();
      return;
    }
    if (!text) {
      setError('Write a comment first.');
      bodyRef.current?.focus();
      return;
    }
    const data = { body: text };
    if (parent) data.parentId = parent.id;
    else if (anchor === 'time' && videoRef.current) data.timecodeMs = Math.round((videoRef.current.currentTime || 0) * 1000);
    else if (anchor === 'point' && draftPoint) data.region = { x: draftPoint.x / 100, y: draftPoint.y / 100, w: 0, h: 0 };
    else if (anchor === 'page') {
      const number = Number.parseInt(page, 10);
      if (!Number.isInteger(number) || number < 1) {
        setError('Enter a page number of 1 or more.');
        document.getElementById(`${id}-page`)?.focus();
        return;
      }
      data.pageNumber = number;
    }
    setError('');
    setPending(true);
    try {
      await onSubmit(data);
      setBody('');
      setPage('');
      if (anchor === 'point') {
        setDraftPoint(null);
        setAnchor('none');
      }
    } catch (err) {
      setError(err?.message || 'The comment could not be saved. Try again.');
      bodyRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const label = parent ? `Reply to ${parent.authorName}` : 'Comment';
  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby={labelledBy} noValidate>
      <div className="space-y-1">
        <label htmlFor={`${id}-body`} className="block text-sm font-medium text-foreground">{label}</label>
        <textarea
          id={`${id}-body`}
          ref={bodyRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={BODY_LIMIT}
          rows={parent ? 2 : 3}
          aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
          aria-invalid={Boolean(error) || undefined}
          className={cn(control, 'w-full py-2')}
        />
        <p id={`${id}-count`} className="text-xs text-muted-foreground">{body.length} of {BODY_LIMIT} characters. Plain text only.</p>
      </div>

      {!parent && kind !== 'pdf' && (kind === 'video' || kind === 'audio') && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-foreground">Pin to the playback time</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="radio" name={`${id}-anchor`} checked={anchor === 'time'} onChange={() => setAnchor('time')} className="h-4 w-4" />
            Pin to the current playback time
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="radio" name={`${id}-anchor`} checked={anchor === 'none'} onChange={() => setAnchor('none')} className="h-4 w-4" />
            General comment
          </label>
        </fieldset>
      )}

      {!parent && kind === 'image' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Pin to a point</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={anchor === 'point'}
              onChange={(event) => {
                setAnchor(event.target.checked ? 'point' : 'none');
                if (event.target.checked && !draftPoint) setDraftPoint({ x: 50, y: 50 });
                if (!event.target.checked) setDraftPoint(null);
              }}
              className="h-4 w-4"
            />
            Pin this comment to a point on the image
          </label>
          {anchor === 'point' && draftPoint && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={`${id}-x`} className="block text-xs font-medium text-foreground">Across (% from left)</label>
                <input id={`${id}-x`} type="number" min={0} max={100} step={1} value={draftPoint.x} onChange={(event) => setDraftPoint({ ...draftPoint, x: clampPercent(event.target.value) })} className={cn(control, 'w-full')} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-y`} className="block text-xs font-medium text-foreground">Down (% from top)</label>
                <input id={`${id}-y`} type="number" min={0} max={100} step={1} value={draftPoint.y} onChange={(event) => setDraftPoint({ ...draftPoint, y: clampPercent(event.target.value) })} className={cn(control, 'w-full')} />
              </div>
            </div>
          )}
        </fieldset>
      )}

      {!parent && kind === 'pdf' && (
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={anchor === 'page'} onChange={(event) => setAnchor(event.target.checked ? 'page' : 'none')} className="h-4 w-4" />
            This comment is about a specific page
          </label>
          {anchor === 'page' && (
            <>
              <label htmlFor={`${id}-page`} className="block text-xs font-medium text-foreground">Page number</label>
              <input id={`${id}-page`} type="number" min={1} max={10000} value={page} onChange={(event) => setPage(event.target.value)} className={cn(control, 'w-32')} />
            </>
          )}
        </div>
      )}

      {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={pending}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {pending ? 'Saving…' : parent ? 'Post reply' : 'Add comment'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className={buttonOutline}>Cancel</button>}
      </div>
    </form>
  );
}

function AnnotationItem({ annotation, number, replies, selected, onSelect, canComment, canResolve, onResolve, onReply, onSeek, itemRefs, formProps }) {
  const [replying, setReplying] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const hasTime = annotation.timecodeMs !== null && annotation.timecodeMs !== undefined;
  const resolve = async () => {
    setPending(true);
    setError('');
    try {
      await onResolve(annotation.id, !annotation.resolved);
    } catch (err) {
      setError(err?.message || 'Could not update the comment.');
    } finally {
      setPending(false);
    }
  };
  return (
    <li
      ref={(node) => { itemRefs.current[annotation.id] = node; }}
      tabIndex={-1}
      aria-labelledby={`annotation-${annotation.id}-heading`}
      className={cn('rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'border-primary bg-primary/5' : 'border-border', annotation.resolved && 'opacity-80')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={`annotation-${annotation.id}-heading`} className="text-sm font-semibold text-foreground">{`Comment ${number} by ${annotation.authorName}`}</h3>
          <p className="text-xs text-muted-foreground">{authorRole(annotation.authorType)} · {formatDateTime(annotation.createdAt)}</p>
        </div>
        {annotation.resolved && <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />Resolved</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
        {hasTime && onSeek ? (
          <button type="button" onClick={() => onSeek(annotation)} aria-label={`Play from ${formatTimecode(annotation.timecodeMs)} for comment ${number}`} className="min-h-11 rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Play from {formatTimecode(annotation.timecodeMs)}
          </button>
        ) : annotation.region ? (
          <button type="button" onClick={() => onSelect(annotation.id)} aria-pressed={selected} className="min-h-11 rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show pin {number}: {describeAnchor(annotation)}
          </button>
        ) : (
          <span>{describeAnchor(annotation)}</span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{annotation.body}</p>
      {replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-border pl-3" aria-label={`Replies to comment ${number}`}>
          {replies.map((reply) => (
            <li key={reply.id} ref={(node) => { itemRefs.current[reply.id] = node; }} tabIndex={-1} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{reply.authorName}</span> · {authorRole(reply.authorType)} · {formatDateTime(reply.createdAt)}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{reply.body}</p>
            </li>
          ))}
        </ul>
      )}
      {(canComment || canResolve) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canComment && !replying && (
            <button type="button" onClick={() => setReplying(true)} aria-label={`Reply to comment ${number}`} className={buttonOutline}>
              Reply
            </button>
          )}
          {canResolve && (
            <button type="button" onClick={resolve} disabled={pending} aria-label={`${annotation.resolved ? 'Reopen' : 'Resolve'} comment ${number}`} className={buttonOutline}>
              {annotation.resolved ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {annotation.resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {replying && (
        <div className="mt-3">
          <CommentForm {...formProps} parent={annotation} onSubmit={async (data) => { await onReply(data); setReplying(false); }} onCancel={() => setReplying(false)} />
        </div>
      )}
    </li>
  );
}

function DecisionPanel({ onDecide, guest, status }) {
  const id = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const decide = async (decision) => {
    if (guest && !guest.name.trim()) {
      setError('Enter your name before recording a decision.');
      guest.nameRef?.current?.focus();
      return;
    }
    setError('');
    setPending(decision);
    try {
      await onDecide({ decision, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote('');
    } catch (err) {
      setError(err?.message || 'The decision could not be saved. Try again.');
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Current status: <StatusBadge status={status} /></p>
      <div className="space-y-1">
        <label htmlFor={`${id}-note`} className="block text-sm font-medium text-foreground">Note with your decision (optional)</label>
        <textarea id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_LIMIT} rows={2} className={cn(control, 'w-full py-2')} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => decide('approved')} disabled={Boolean(pending)} className={buttonPrimary}>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{pending === 'approved' ? 'Saving…' : 'Approve'}
        </button>
        <button type="button" onClick={() => decide('changes_requested')} disabled={Boolean(pending)} className={buttonOutline}>
          <XCircle className="h-4 w-4" aria-hidden="true" />{pending === 'changes_requested' ? 'Saving…' : 'Request changes'}
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   media: { kind: 'image' | 'pdf' | 'video' | 'audio', fileName: string, url: string },
 *   status: string,
 *   annotations: any[],
 *   decisions: any[],
 *   canComment: boolean,
 *   canResolve?: boolean,
 *   canDecide?: boolean,
 *   guest?: { name: string, email: string, setName: Function, setEmail: Function },
 *   onAddAnnotation: (data: object) => Promise<any>,
 *   onResolve?: (id: string, resolved: boolean) => Promise<any>,
 *   onDecide?: (data: object) => Promise<any>,
 * }} props
 */
export default function MediaReview({ media, status, annotations, decisions, canComment, canResolve = false, canDecide = false, guest, onAddAnnotation, onResolve, onDecide }) {
  const headingId = useId();
  const guestId = useId();
  const [selectedId, setSelectedId] = useState(null);
  const [draftPoint, setDraftPoint] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState(null);
  const videoRef = useRef(null);
  const itemRefs = useRef({});
  const nameRef = useRef(null);

  const { topLevel, repliesByParent, numbers } = useMemo(() => {
    const top = annotations.filter((annotation) => !annotation.parentId);
    const replies = {};
    for (const annotation of annotations) {
      if (annotation.parentId) (replies[annotation.parentId] ||= []).push(annotation);
    }
    return { topLevel: top, repliesByParent: replies, numbers: Object.fromEntries(top.map((annotation, index) => [annotation.id, index + 1])) };
  }, [annotations]);

  const pins = topLevel.filter((annotation) => annotation.region).map((annotation) => ({ ...annotation, number: numbers[annotation.id] }));

  useEffect(() => {
    if (focusTarget && itemRefs.current[focusTarget]) {
      itemRefs.current[focusTarget].focus();
      setFocusTarget(null);
    }
  }, [focusTarget, annotations]);

  const guestWithRef = guest ? { ...guest, nameRef } : undefined;

  const add = async (data) => {
    const created = await onAddAnnotation(data);
    const id = created?.id;
    setAnnouncement(data.parentId ? 'Reply posted.' : 'Comment added.');
    if (id) setFocusTarget(id);
    return created;
  };

  const selectPin = (id) => {
    setSelectedId(id);
    setFocusTarget(id);
  };

  const seek = (annotation) => {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = annotation.timecodeMs / 1000;
    setSelectedId(annotation.id);
    setAnnouncement(`Playback moved to ${formatTimecode(annotation.timecodeMs)}.`);
  };

  const resolve = async (id, resolved) => {
    await onResolve(id, resolved);
    setAnnouncement(resolved ? `Comment ${numbers[id]} resolved.` : `Comment ${numbers[id]} reopened.`);
  };

  const decide = async (data) => {
    await onDecide(data);
    setAnnouncement(data.decision === 'approved' ? 'Approval recorded.' : 'Change request recorded.');
  };

  const formProps = { kind: media.kind, draftPoint, setDraftPoint, videoRef, guest: guestWithRef };
  const openCount = topLevel.filter((annotation) => !annotation.resolved).length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <section className="space-y-4 lg:col-span-3" aria-label="Media">
        <MediaViewer
          media={media}
          pins={pins}
          selectedId={selectedId}
          onSelectPin={selectPin}
          draftPoint={canComment ? draftPoint : null}
          onPickPoint={setDraftPoint}
          videoRef={videoRef}
          canPick={canComment}
        />

        {(canDecide || decisions.length > 0) && (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby={`${headingId}-decision`}>
            <h2 id={`${headingId}-decision`} className="font-semibold text-foreground">Decision</h2>
            {canDecide && <DecisionPanel onDecide={decide} guest={guestWithRef} status={status} />}
            {decisions.length > 0 ? (
              <div>
                <h3 className="text-sm font-medium text-foreground">Decision history</h3>
                <ol className="mt-2 space-y-2">
                  {decisions.map((decision) => (
                    <li key={decision.id} className="rounded-lg border border-border p-3 text-sm">
                      <p className="text-foreground">
                        <span className="font-semibold">{decision.decision === 'approved' ? 'Approved' : 'Changes requested'}</span> by {decision.actorName}
                        <span className="text-muted-foreground"> ({authorRole(decision.actorType)}) · {formatDateTime(decision.createdAt)}</span>
                      </p>
                      {decision.note && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{decision.note}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        )}
      </section>

      <section className="space-y-4 lg:col-span-2" aria-labelledby={`${headingId}-comments`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={`${headingId}-comments`} className="font-semibold text-foreground">Comments</h2>
          <p className="text-xs text-muted-foreground">{topLevel.length} total, {openCount} open</p>
        </div>

        {guest && canComment && (
          <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">Your details</legend>
            <div className="space-y-1">
              <label htmlFor={`${guestId}-name`} className="block text-sm font-medium text-foreground">Your name</label>
              <input id={`${guestId}-name`} ref={nameRef} value={guest.name} onChange={(event) => guest.setName(event.target.value)} maxLength={120} autoComplete="name" required aria-required="true" className={cn(control, 'w-full')} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${guestId}-email`} className="block text-sm font-medium text-foreground">Email (optional)</label>
              <input id={`${guestId}-email`} type="email" value={guest.email} onChange={(event) => guest.setEmail(event.target.value)} maxLength={254} autoComplete="email" className={cn(control, 'w-full')} />
            </div>
            <p className="text-xs text-muted-foreground">Your name is shown with your comments and decisions to the team and anyone with this link. Your email is only shown to the team.</p>
          </fieldset>
        )}

        {canComment ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 id={`${headingId}-new`} className="sr-only">New comment</h3>
            <CommentForm {...formProps} labelledBy={`${headingId}-new`} onSubmit={add} />
          </div>
        ) : (
          <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">This review is closed. Comments are read-only.</p>
        )}

        {topLevel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ol className="space-y-3" aria-label="Comment list">
            {topLevel.map((annotation) => (
              <AnnotationItem
                key={annotation.id}
                annotation={annotation}
                number={numbers[annotation.id]}
                replies={repliesByParent[annotation.id] || []}
                selected={selectedId === annotation.id}
                onSelect={selectPin}
                canComment={canComment}
                canResolve={canResolve && canComment}
                onResolve={resolve}
                onReply={add}
                onSeek={media.kind === 'video' || media.kind === 'audio' ? seek : null}
                itemRefs={itemRefs}
                formProps={formProps}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
