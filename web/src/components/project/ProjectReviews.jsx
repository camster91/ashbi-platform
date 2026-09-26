import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { cn, formatDate } from '../../lib/utils';
import { StatusBadge } from '../review/MediaReview';

// Project media review panel (#417, docs/media-review.md): the project's
// review sessions and a form to put an image, PDF, video or audio attachment
// up for review (optionally as a new version of an earlier review).

const REVIEWABLE = /^(image\/(jpeg|png|gif|webp)|application\/pdf|video\/(mp4|webm)|audio\/(webm|mpeg|wav|x-wav|wave))(;|$)/i;
const control = 'min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function ProjectReviews({ projectId }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [attachmentId, setAttachmentId] = useState('');
  const [title, setTitle] = useState('');
  const [previousSessionId, setPreviousSessionId] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const fileRef = useRef(null);
  const titleRef = useRef(null);

  const sessionsQuery = useQuery({ queryKey: ['review-sessions', projectId], queryFn: () => api.getReviewSessions(projectId) });
  const filesQuery = useQuery({ queryKey: ['review-files', projectId], queryFn: () => api.getAttachments('PROJECT', projectId) });
  const sessions = sessionsQuery.data?.sessions || [];
  const files = useMemo(() => (Array.isArray(filesQuery.data) ? filesQuery.data : []).filter((file) => REVIEWABLE.test(file.mimeType || '')), [filesQuery.data]);
  const versionable = sessions.filter((session) => !session.nextSessionId);

  const start = async (event) => {
    event.preventDefault();
    if (!attachmentId) {
      setError('Choose a file to review.');
      fileRef.current?.focus();
      return;
    }
    if (!title.trim()) {
      setError('Give the review a title.');
      titleRef.current?.focus();
      return;
    }
    setError('');
    setPending(true);
    try {
      const { session } = await api.createReviewSession({ projectId, attachmentId, title: title.trim(), ...(previousSessionId ? { previousSessionId } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['review-sessions', projectId] });
      navigate(`/review/${session.id}`);
    } catch (err) {
      setError(err?.message || 'The review could not be started.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby={`${id}-heading`}>
      <div className="border-b border-border px-5 py-4">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold text-foreground"><ClipboardCheck className="h-5 w-5 text-primary" aria-hidden="true" />Media review</h2>
        <p className="mt-1 text-sm text-muted-foreground">Collect pinned and timestamped feedback and approvals on images, PDFs, video and recordings, from the team and the client.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Reviews</h3>
          {sessionsQuery.isLoading ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">Loading reviews…</p>
          ) : sessionsQuery.error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">Reviews could not be loaded.</p>
          ) : sessions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <div className="min-w-0">
                    <Link to={`/review/${session.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {session.title}<span className="text-muted-foreground"> (v{session.version})</span>
                    </Link>
                    <p className="text-xs text-muted-foreground">{session.media?.fileName} · {session.openAnnotationCount} open comment{session.openAnnotationCount === 1 ? '' : 's'} · {formatDate(session.createdAt)}</p>
                  </div>
                  <StatusBadge status={session.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={start} className="space-y-3" aria-labelledby={`${id}-start`} noValidate>
          <h3 id={`${id}-start`} className="text-sm font-semibold text-foreground">Start a review</h3>
          {files.length === 0 && !filesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Upload an image, PDF, video or audio file to this project, or record the screen above, to start a review.</p>
          ) : (
            <>
              <div className="space-y-1">
                <label htmlFor={`${id}-file`} className="block text-sm font-medium text-foreground">File</label>
                <select id={`${id}-file`} ref={fileRef} value={attachmentId} onChange={(event) => setAttachmentId(event.target.value)} className={control}>
                  <option value="">Choose a file…</option>
                  {files.map((file) => <option key={file.id} value={file.id}>{file.originalName}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-title`} className="block text-sm font-medium text-foreground">Title</label>
                <input id={`${id}-title`} ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className={control} />
              </div>
              {versionable.length > 0 && (
                <div className="space-y-1">
                  <label htmlFor={`${id}-previous`} className="block text-sm font-medium text-foreground">New version of (optional)</label>
                  <select id={`${id}-previous`} value={previousSessionId} onChange={(event) => setPreviousSessionId(event.target.value)} aria-describedby={`${id}-previous-help`} className={control}>
                    <option value="">None: a new review</option>
                    {versionable.map((session) => <option key={session.id} value={session.id}>{session.title} (v{session.version})</option>)}
                  </select>
                  <p id={`${id}-previous-help`} className="text-xs text-muted-foreground">The earlier review is closed and linked to this one.</p>
                </div>
              )}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={pending} className={cn('min-h-11 inline-flex items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50')}>
                {pending ? 'Starting…' : 'Start review'}
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
