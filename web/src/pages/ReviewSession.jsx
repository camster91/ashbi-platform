import { useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Link2, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate, formatDateTime } from '../lib/utils';
import MediaReview, { StatusBadge } from '../components/review/MediaReview';
import ConfirmDialog from '../components/ConfirmDialog';
import QueryErrorState from '../components/QueryErrorState';
import { LoadingState } from '../components/ui';

// Staff review page (#417, docs/media-review.md): the media with its
// annotations and decisions, and the client share links for this session.

const control = 'min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonBase = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const LINK_STATE_LABELS = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };

function ShareLinks({ sessionId, shareLinks, canCreate, onChanged }) {
  const id = useId();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('14');
  const [allowDecision, setAllowDecision] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [revokeError, setRevokeError] = useState('');
  const [revokePending, setRevokePending] = useState(false);
  const createdRef = useRef(null);
  const daysRef = useRef(null);

  const create = async (event) => {
    event.preventDefault();
    const expiresInDays = Number.parseInt(days, 10);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
      setError('Choose an expiry from 1 to 90 days.');
      daysRef.current?.focus();
      return;
    }
    setError('');
    setPending(true);
    try {
      const result = await api.createReviewShareLink(sessionId, { ...(label.trim() ? { label: label.trim() } : {}), expiresInDays, allowDecision });
      setCreated({ url: `${window.location.origin}${result.path}`, expiresAt: result.shareLink.expiresAt });
      setCopied('');
      setLabel('');
      onChanged();
      setTimeout(() => createdRef.current?.focus(), 0);
    } catch (err) {
      setError(err?.message || 'The share link could not be created.');
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied('Link copied.');
    } catch {
      setCopied('Copy failed. Select the link and copy it manually.');
      createdRef.current?.select();
    }
  };

  const revoke = async () => {
    setRevokePending(true);
    setRevokeError('');
    try {
      await api.revokeReviewShareLink(sessionId, revoking.id);
      setRevoking(null);
      onChanged();
    } catch (err) {
      setRevokeError(err?.message || 'The link could not be revoked.');
    } finally {
      setRevokePending(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-labelledby={`${id}-heading`}>
      <div>
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold text-foreground"><Link2 className="h-4 w-4" aria-hidden="true" />Client share links</h2>
        <p className="mt-1 text-sm text-muted-foreground">Anyone with a link can see this file, its comments and decisions, and comment under a name they choose, until the link expires or you revoke it.</p>
      </div>

      {canCreate && (
        <form onSubmit={create} className="space-y-3" aria-labelledby={`${id}-create`} noValidate>
          <h3 id={`${id}-create`} className="text-sm font-semibold text-foreground">Create a share link</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-label`} className="block text-sm font-medium text-foreground">Label (optional)</label>
              <input id={`${id}-label`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} className={cn(control, 'w-full')} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-days`} className="block text-sm font-medium text-foreground">Expires after (days)</label>
              <input id={`${id}-days`} ref={daysRef} type="number" min={1} max={90} value={days} onChange={(event) => setDays(event.target.value)} aria-describedby={`${id}-days-help`} className={cn(control, 'w-full')} />
              <p id={`${id}-days-help`} className="text-xs text-muted-foreground">1 to 90 days.</p>
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={allowDecision} onChange={(event) => setAllowDecision(event.target.checked)} className="h-4 w-4" />
            Allow the client to approve or request changes
          </label>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Creating a link shares project data outside your workspace, so you may be asked to confirm your identity.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={pending} className={cn(buttonBase, 'bg-primary text-primary-foreground hover:bg-primary/90')}>{pending ? 'Creating…' : 'Create share link'}</button>
        </form>
      )}

      {created && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <label htmlFor={`${id}-created`} className="block text-sm font-medium text-foreground">New share link (shown only once)</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id={`${id}-created`} ref={createdRef} readOnly value={created.url} onFocus={(event) => event.target.select()} className={cn(control, 'w-full min-w-0 font-mono text-xs')} />
            <button type="button" onClick={copy} className={cn(buttonBase, 'border border-border text-foreground hover:bg-muted')}><Copy className="h-4 w-4" aria-hidden="true" />Copy link</button>
          </div>
          <p className="text-xs text-muted-foreground">Expires {formatDateTime(created.expiresAt)}. Copy it now: it cannot be shown again.</p>
          <p role="status" aria-live="polite" className="text-xs text-foreground">{copied}</p>
        </div>
      )}

      {shareLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No share links yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Share links">
          {shareLinks.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{link.label || 'Share link'} <span className="text-xs font-normal text-muted-foreground">· {LINK_STATE_LABELS[link.state] || link.state}{link.allowDecision ? ' · can decide' : ''}</span></p>
                <p className="text-xs text-muted-foreground">
                  {link.state === 'revoked' ? `Revoked ${formatDate(link.revokedAt)}` : `${link.state === 'expired' ? 'Expired' : 'Expires'} ${formatDate(link.expiresAt)}`}
                  {' · '}{link.lastUsedAt ? `Last used ${formatDateTime(link.lastUsedAt)}` : 'Not used yet'}
                </p>
              </div>
              {link.state !== 'revoked' && (
                <button type="button" onClick={() => { setRevokeError(''); setRevoking(link); }} aria-label={`Revoke ${link.label || 'share link'}`} className={cn(buttonBase, 'border border-border text-destructive hover:bg-destructive/10')}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={Boolean(revoking)}
        title="Revoke share link?"
        description="Anyone using this link loses access immediately. Comments and decisions made through it are kept."
        confirmLabel="Revoke link"
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
        pending={revokePending}
        error={revokeError}
      />
    </section>
  );
}

export default function ReviewSession() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const queryKey = ['review-session', id];
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey, queryFn: () => api.getReviewSession(id) });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  if (isLoading) return <LoadingState label="Loading review…" />;
  if (error || !data) return <QueryErrorState error={error} onRetry={refetch} isRetrying={isFetching} message="Review could not be loaded" />;

  const { session, annotations, decisions, shareLinks } = data;
  const canWrite = session.status !== 'closed';
  const media = { ...session.media, url: api.attachmentFileUrl(session.media.filename) };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to={`/project/${session.projectId}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to project
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{session.title}</h1>
          <StatusBadge status={session.status} />
          <span className="text-sm text-muted-foreground">Version {session.version}</span>
        </div>
        <nav aria-label="Versions" className="flex flex-wrap gap-3 text-sm">
          {session.previousSessionId && <Link to={`/review/${session.previousSessionId}`} className="min-h-11 inline-flex items-center text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Previous version</Link>}
          {session.nextSessionId && <Link to={`/review/${session.nextSessionId}`} className="min-h-11 inline-flex items-center text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Newer version</Link>}
        </nav>
      </div>

      <MediaReview
        media={media}
        status={session.status}
        annotations={annotations}
        decisions={decisions}
        canComment={canWrite}
        canResolve
        canDecide={canWrite}
        onAddAnnotation={async (body) => { const result = await api.addReviewAnnotation(id, body); await refresh(); return result.annotation; }}
        onResolve={async (annotationId, resolved) => { await api.resolveReviewAnnotation(id, annotationId, resolved); await refresh(); }}
        onDecide={async (body) => { await api.recordReviewDecision(id, body); await refresh(); }}
      />

      <ShareLinks sessionId={id} shareLinks={shareLinks} canCreate={canWrite} onChanged={refresh} />
    </div>
  );
}
