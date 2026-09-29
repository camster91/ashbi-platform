import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MapPin, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';
import AnnotationOverlay from './AnnotationOverlay';
import ReviewTimeline from './ReviewTimeline';
import { DEFAULT_COLOR, MARKUP_COLORS, MARKUP_TOOLS, describeShape, isOnSurface, mentionedIds, shapeOf, shapePayload } from './markup';

// pdf.js is loaded only when a PDF is reviewed, and runs in a worker.
const PdfViewer = lazy(() => import('./PdfViewer'));

// Shared review surface for the staff page (/review/:id), the client
// share-link page (/portal/review/:token) and the signed-in client portal's
// Reviews tab, #417 / docs/media-review.md.
//
// Accessibility: the comment list is the equivalent of the markup on the
// media (each entry spells out its anchor and shape); every shape has a
// numbered badge that is a labelled button; a point can be chosen with the
// pointer or with the labelled position fields; status changes are announced
// in a polite live region and focus moves to the new comment or to the field
// that needs attention.

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

/** Who wrote a comment or decision: team members, or clients (portal or share link). */
export function authorRole(type) {
  if (type === 'guest') return 'Client (via share link)';
  if (type === 'client') return 'Client';
  return 'Team';
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

/** Plain-language anchor for the list view (the markup's text equivalent). */
export function describeAnchor(annotation) {
  const parts = [];
  if (annotation.timecodeMs !== null && annotation.timecodeMs !== undefined) parts.push(`at ${formatTimecode(annotation.timecodeMs)}`);
  if (annotation.pageNumber) parts.push(`page ${annotation.pageNumber}`);
  const shape = annotation.region || annotation.points ? describeShape(annotation) : null;
  if (shape) parts.push(shape);
  return parts.length ? parts.join(', ') : 'general comment';
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** Version switcher for a review's version chain; older versions are read-only. */
export function VersionSwitcher({ versions, currentId, onSelect }) {
  const id = useId();
  if (!versions || versions.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-version`} className="text-sm font-medium text-foreground">Version</label>
      <select id={`${id}-version`} value={currentId} onChange={(event) => onSelect(event.target.value)} aria-describedby={`${id}-help`} className={control}>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {`v${version.version}: ${REVIEW_STATUS_LABELS[version.status] || version.status}${version.id === currentId ? ' (shown)' : ''}`}
          </option>
        ))}
      </select>
      <span id={`${id}-help`} className="text-xs text-muted-foreground">Earlier versions and their comments are read-only.</span>
    </div>
  );
}

function MarkupToolbar({ kind, tool, setTool, color, setColor, disabledReason }) {
  const id = useId();
  const tools = [{ id: 'select', label: 'Select' }, ...MARKUP_TOOLS];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2">
      <div role="group" aria-labelledby={`${id}-tools`} className="flex flex-wrap items-center gap-1">
        <span id={`${id}-tools`} className="px-1 text-xs font-medium text-muted-foreground">Markup</span>
        {tools.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={tool === entry.id}
            onClick={() => setTool(entry.id)}
            className={cn('min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tool === entry.id ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-colors`} className="flex items-center gap-1">
        <span id={`${id}-colors`} className="px-1 text-xs font-medium text-muted-foreground">Colour</span>
        {MARKUP_COLORS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={color === entry.id}
            aria-label={entry.label}
            onClick={() => setColor(entry.id)}
            className={cn('h-8 w-8 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', color === entry.id ? 'border-foreground' : 'border-transparent')}
            style={{ backgroundColor: entry.hex }}
          />
        ))}
      </div>
      {disabledReason && <p className="w-full text-xs text-muted-foreground">{disabledReason}</p>}
    </div>
  );
}

function CommentForm({ kind, onSubmit, draft, setDraft, mediaRef, pdfPage, guest, parent, onCancel, labelledBy, mentionables }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [anchor, setAnchor] = useState(parent ? 'none' : (kind === 'video' || kind === 'audio') ? 'time' : 'none');
  const [page, setPage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const bodyRef = useRef(null);
  const nameRef = guest?.nameRef;
  const pinDraft = draft?.shape === 'pin' ? draft : null;
  const drawnDraft = draft && draft.shape !== 'pin' ? draft : null;

  useEffect(() => { if (parent) bodyRef.current?.focus(); }, [parent]);
  useEffect(() => {
    if (!parent && kind === 'image' && pinDraft) setAnchor('point');
  }, [pinDraft, kind, parent]);

  const setPoint = (x, y) => setDraft({ ...(draft?.shape === 'pin' ? draft : {}), shape: 'pin', region: { x: x / 100, y: y / 100, w: 0, h: 0 } });

  const mention = (userId) => {
    const user = mentionables?.find((entry) => entry.id === userId);
    if (!user) return;
    setBody((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}@${user.name} `);
    bodyRef.current?.focus();
  };

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
    if (parent) {
      data.parentId = parent.id;
    } else if (draft && (kind === 'image' || kind === 'pdf' || kind === 'video')) {
      // A drawn or pinned shape: on a PDF it belongs to its page, on a
      // video to the frame it was drawn on.
      if (kind === 'image' && draft.shape === 'pin' && anchor !== 'point') {
        // The pin was cleared from the form: a general comment.
      } else {
        Object.assign(data, shapePayload(draft));
        if (kind === 'pdf') data.pageNumber = draft.pageNumber ?? pdfPage ?? 1;
        if (kind === 'video') data.timecodeMs = draft.timecodeMs ?? Math.round((mediaRef.current?.currentTime || 0) * 1000);
      }
    } else if (anchor === 'time' && mediaRef.current) {
      data.timecodeMs = Math.round((mediaRef.current.currentTime || 0) * 1000);
    } else if (anchor === 'page') {
      const number = Number.parseInt(page || String(pdfPage || ''), 10);
      if (!Number.isInteger(number) || number < 1) {
        setError('Enter a page number of 1 or more.');
        document.getElementById(`${id}-page`)?.focus();
        return;
      }
      data.pageNumber = number;
    }
    const mentions = !guest && mentionables?.length ? mentionedIds(text, mentionables) : [];
    if (mentions.length) data.mentionUserIds = mentions;
    setError('');
    setPending(true);
    try {
      await onSubmit(data);
      setBody('');
      setPage('');
      if (!parent && draft) {
        setDraft(null);
        if (anchor === 'point') setAnchor('none');
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

      {!guest && mentionables?.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={`${id}-mention`} className="block text-xs font-medium text-foreground">Mention a teammate</label>
          <select id={`${id}-mention`} value="" onChange={(event) => mention(event.target.value)} aria-describedby={`${id}-mention-help`} className={cn(control, 'w-full')}>
            <option value="">Choose someone to notify…</option>
            {mentionables.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <p id={`${id}-mention-help`} className="text-xs text-muted-foreground">Adds @name to the comment; they are notified when it is posted.</p>
        </div>
      )}

      {!parent && drawnDraft && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2 text-sm text-foreground">
          <span>Attached: {describeShape(drawnDraft)}{kind === 'pdf' ? ` on page ${drawnDraft.pageNumber ?? pdfPage ?? 1}` : ''}{kind === 'video' && drawnDraft.timecodeMs !== undefined ? ` at ${formatTimecode(drawnDraft.timecodeMs)}` : ''}</span>
          <button type="button" onClick={() => setDraft(null)} className={buttonOutline}>Remove drawing</button>
        </div>
      )}

      {!parent && (kind === 'video' || kind === 'audio') && !drawnDraft && (
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

      {!parent && kind === 'image' && !drawnDraft && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Pin to a point</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={anchor === 'point'}
              onChange={(event) => {
                setAnchor(event.target.checked ? 'point' : 'none');
                if (event.target.checked && !pinDraft) setPoint(50, 50);
                if (!event.target.checked) setDraft(null);
              }}
              className="h-4 w-4"
            />
            Pin this comment to a point on the image
          </label>
          {anchor === 'point' && pinDraft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={`${id}-x`} className="block text-xs font-medium text-foreground">Across (% from left)</label>
                <input id={`${id}-x`} type="number" min={0} max={100} step={1} value={Math.round(pinDraft.region.x * 100)} onChange={(event) => setPoint(clampPercent(event.target.value), Math.round(pinDraft.region.y * 100))} className={cn(control, 'w-full')} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-y`} className="block text-xs font-medium text-foreground">Down (% from top)</label>
                <input id={`${id}-y`} type="number" min={0} max={100} step={1} value={Math.round(pinDraft.region.y * 100)} onChange={(event) => setPoint(Math.round(pinDraft.region.x * 100), clampPercent(event.target.value))} className={cn(control, 'w-full')} />
              </div>
            </div>
          )}
        </fieldset>
      )}

      {!parent && kind === 'pdf' && !draft && (
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={anchor === 'page'} onChange={(event) => { setAnchor(event.target.checked ? 'page' : 'none'); if (event.target.checked && pdfPage) setPage(String(pdfPage)); }} className="h-4 w-4" />
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

function AnnotationItem({ annotation, number, replies, selected, onSelect, canComment, canResolve, onResolve, onReply, onSeek, onShow, itemRefs, formProps }) {
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
  const showable = shapeOf(annotation) || annotation.pageNumber;
  return (
    <li
      ref={(node) => { itemRefs.current[annotation.id] = node; }}
      tabIndex={-1}
      aria-labelledby={`annotation-${annotation.id}-heading`}
      data-selected={selected || undefined}
      className={cn('rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border', annotation.resolved && 'opacity-80')}
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
        ) : showable && onShow ? (
          <button type="button" onClick={() => onShow(annotation)} aria-pressed={selected} className="min-h-11 rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show {shapeOf(annotation) ? `markup ${number}` : `page ${annotation.pageNumber}`}: {describeAnchor(annotation)}
          </button>
        ) : (
          <span>{describeAnchor(annotation)}</span>
        )}
        {hasTime && onSeek && shapeOf(annotation) && <span>{describeShape(annotation)}</span>}
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

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
];

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
 *   mentionables?: Array<{ id: string, name: string }>,
 *   onAddAnnotation: (data: object) => Promise<any>,
 *   onResolve?: (id: string, resolved: boolean) => Promise<any>,
 *   onDecide?: (data: object) => Promise<any>,
 * }} props
 */
export default function MediaReview({ media, status, annotations, decisions, canComment, canResolve = false, canDecide = false, guest, mentionables, onAddAnnotation, onResolve, onDecide }) {
  const headingId = useId();
  const guestId = useId();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  // The image's default gesture is a pin; drawing is opt-in on PDF and video.
  const [tool, setTool] = useState(media.kind === 'image' ? 'pin' : 'select');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [filter, setFilter] = useState('all');
  const [pdfPage, setPdfPage] = useState(1);
  const [playback, setPlayback] = useState({ currentMs: 0, durationMs: 0, paused: true });
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState(null);
  const mediaRef = useRef(null);
  const itemRefs = useRef({});
  const nameRef = useRef(null);
  const kind = media.kind;
  const drawable = canComment && (kind === 'image' || kind === 'pdf' || kind === 'video');

  const { topLevel, repliesByParent, numbers } = useMemo(() => {
    const top = annotations.filter((annotation) => !annotation.parentId);
    const replies = {};
    for (const annotation of annotations) {
      if (annotation.parentId) (replies[annotation.parentId] ||= []).push(annotation);
    }
    return { topLevel: top, repliesByParent: replies, numbers: Object.fromEntries(top.map((annotation, index) => [annotation.id, index + 1])) };
  }, [annotations]);

  const openCount = topLevel.filter((annotation) => !annotation.resolved).length;
  const resolvedCount = topLevel.length - openCount;
  const counts = { all: topLevel.length, open: openCount, resolved: resolvedCount };
  const visible = topLevel.filter((annotation) => filter === 'all' || (filter === 'open' ? !annotation.resolved : annotation.resolved));

  // The markup on the surface being shown: the image, the PDF page, or the
  // video frame near the playhead (plus the selected comment's shape).
  const onSurface = visible
    .filter((annotation) => annotation.id === selectedId || isOnSurface(annotation, { kind, page: pdfPage, timeMs: playback.currentMs }))
    .filter((annotation) => kind !== 'pdf' || annotation.pageNumber === pdfPage)
    .filter((annotation) => shapeOf(annotation))
    .map((annotation) => ({ ...annotation, number: numbers[annotation.id] }));

  const timelineMarkers = (kind === 'video' || kind === 'audio')
    ? visible.filter((annotation) => annotation.timecodeMs !== null && annotation.timecodeMs !== undefined).map((annotation) => ({ ...annotation, number: numbers[annotation.id] }))
    : [];

  useEffect(() => {
    if (focusTarget && itemRefs.current[focusTarget]) {
      itemRefs.current[focusTarget].focus();
      setFocusTarget(null);
    }
  }, [focusTarget, annotations]);

  // Drawing on a video needs a still frame.
  useEffect(() => {
    if (kind === 'video' && tool !== 'select' && mediaRef.current && !mediaRef.current.paused) mediaRef.current.pause();
  }, [tool, kind]);

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
    if (filter !== 'all') {
      const annotation = topLevel.find((entry) => entry.id === id);
      if (annotation && (filter === 'open') === Boolean(annotation.resolved)) setFilter('all');
    }
  };

  const seek = (annotation) => {
    const player = mediaRef.current;
    if (!player) return;
    player.currentTime = annotation.timecodeMs / 1000;
    if (kind === 'video' && shapeOf(annotation)) player.pause?.();
    setPlayback((current) => ({ ...current, currentMs: annotation.timecodeMs }));
    setSelectedId(annotation.id);
    setAnnouncement(`Playback moved to ${formatTimecode(annotation.timecodeMs)}.`);
  };

  const show = (annotation) => {
    if (kind === 'pdf' && annotation.pageNumber && annotation.pageNumber !== pdfPage) {
      setPdfPage(annotation.pageNumber);
      setAnnouncement(`Showing page ${annotation.pageNumber}.`);
    }
    setSelectedId(annotation.id);
  };

  const resolve = async (id, resolved) => {
    await onResolve(id, resolved);
    setAnnouncement(resolved ? `Comment ${numbers[id]} resolved.` : `Comment ${numbers[id]} reopened.`);
  };

  const decide = async (data) => {
    await onDecide(data);
    setAnnouncement(data.decision === 'approved' ? 'Approval recorded.' : 'Change request recorded.');
  };

  const onDraft = (next) => {
    if (!next) return setDraft(null);
    const anchored = { ...next };
    if (kind === 'pdf') anchored.pageNumber = pdfPage;
    if (kind === 'video') anchored.timecodeMs = Math.round((mediaRef.current?.currentTime || 0) * 1000);
    setDraft(anchored);
    setAnnouncement('Markup added to your comment. Write the comment to post it.');
    return undefined;
  };

  const activeTool = drawable && tool !== 'select' ? tool : null;
  const overlay = (
    <AnnotationOverlay
      shapes={onSurface}
      selectedId={selectedId}
      onSelect={selectPin}
      describe={describeAnchor}
      tool={activeTool}
      color={color}
      draft={drawable && draft && (kind !== 'pdf' || (draft.pageNumber ?? pdfPage) === pdfPage) ? draft : null}
      onDraft={drawable ? onDraft : undefined}
    />
  );

  const formProps = { kind, draft: drawable ? draft : null, setDraft, mediaRef, pdfPage, guest: guestWithRef, mentionables };

  const trackPlayback = {
    onTimeUpdate: (event) => setPlayback((current) => ({ ...current, currentMs: Math.round(event.currentTarget.currentTime * 1000) })),
    onLoadedMetadata: (event) => setPlayback((current) => ({ ...current, durationMs: Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : 0 })),
    onPlay: () => setPlayback((current) => ({ ...current, paused: false })),
    onPause: () => setPlayback((current) => ({ ...current, paused: true })),
  };

  let viewer;
  if (kind === 'image') {
    viewer = (
      <figure className="space-y-2">
        <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
          <img src={media.url} alt={`Reviewed image: ${media.fileName}`} className="block h-auto w-full select-none" draggable={false} />
          {overlay}
        </div>
        <figcaption className="text-xs text-muted-foreground">
          {media.fileName}. {drawable ? 'Choose a markup tool and draw on the image, or use the position fields in the comment form, to attach it to a comment.' : ''}
        </figcaption>
      </figure>
    );
  } else if (kind === 'video') {
    viewer = (
      <figure className="space-y-2">
        <div className="relative">
          {/* Review media has no captions track: the comments are its text companion. */}
          <video ref={mediaRef} src={media.url} controls preload="metadata" className="block w-full rounded-lg border border-border bg-black" aria-label={`Reviewed video: ${media.fileName}`} {...trackPlayback} />
          {/* Covers the whole frame (shapes are normalized to it); it only takes pointer input while drawing. */}
          {overlay}
        </div>
        <ReviewTimeline markers={timelineMarkers} durationMs={playback.durationMs} currentMs={playback.currentMs} selectedId={selectedId} onSeek={seek} />
        <figcaption className="text-xs text-muted-foreground">{media.fileName}. Comments can be pinned to the current playback time{drawable ? '; pause and choose a markup tool to draw on the frame' : ''}.</figcaption>
      </figure>
    );
  } else if (kind === 'audio') {
    viewer = (
      <figure className="space-y-2">
        <audio ref={mediaRef} src={media.url} controls preload="metadata" className="w-full" aria-label={`Reviewed audio: ${media.fileName}`} {...trackPlayback} />
        <ReviewTimeline markers={timelineMarkers} durationMs={playback.durationMs} currentMs={playback.currentMs} selectedId={selectedId} onSeek={seek} />
        <figcaption className="text-xs text-muted-foreground">{media.fileName}. Comments can be pinned to the current playback time.</figcaption>
      </figure>
    );
  } else {
    viewer = (
      <figure className="space-y-2">
        <Suspense fallback={<p role="status" className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Loading the PDF viewer…</p>}>
          <PdfViewer url={media.url} fileName={media.fileName} page={pdfPage} onPageChange={setPdfPage}>
            {() => overlay}
          </PdfViewer>
        </Suspense>
        <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {/* The file route sends the PDF as a download (Content-Disposition: attachment). */}
          <a href={media.url} download={media.fileName} rel="noreferrer" className={buttonOutline}>
            <span aria-hidden="true">Download PDF</span><span className="sr-only">Download PDF ({media.fileName})</span>
          </a>
          <span>Comments can name the page they refer to{drawable ? ', or carry markup drawn on the page shown' : ''}.</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <section className="space-y-4 lg:col-span-3" aria-label="Media">
        {drawable && (
          <MarkupToolbar
            kind={kind}
            tool={tool}
            setTool={setTool}
            color={color}
            setColor={setColor}
            disabledReason={kind === 'video' ? 'Drawing pauses the video; the markup is attached to that frame.' : null}
          />
        )}
        {viewer}

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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${headingId}-comments`} className="font-semibold text-foreground">Comments</h2>
          <p className="text-xs text-muted-foreground">{openCount} open, {resolvedCount} resolved</p>
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

        <div role="group" aria-label="Show comments" className="flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              // "Show resolved (2)": a filter, named apart from the Resolve/Reopen actions.
              aria-label={`Show ${entry.label.toLowerCase()} (${counts[entry.id]})`}
              onClick={() => setFilter(entry.id)}
              className={cn('min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', filter === entry.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted')}
            >
              {`${entry.label} (${counts[entry.id]})`}
            </button>
          ))}
        </div>

        {topLevel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{filter === 'open' ? 'No open comments.' : 'No resolved comments.'}</p>
        ) : (
          <ol className="space-y-3" aria-label="Comment list">
            {visible.map((annotation) => (
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
                onSeek={kind === 'video' || kind === 'audio' ? seek : null}
                onShow={show}
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
