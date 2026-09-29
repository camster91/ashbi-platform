import { useCallback, useEffect, useState } from 'react';
import MediaReview, { StatusBadge, VersionSwitcher } from '../../components/review/MediaReview';
import { Alert, Button, Card, LoadingState } from '../../components/ui';
import { API, Icons, fmtDate, pageTitleClass, portalFetch, sectionTitleClass } from './shared';

// Reviews tab of the signed-in client portal (docs/media-review.md "Client
// portal reviews"): the review sessions the team shared with the client
// (opt-in; unshared reviews never reach the portal), on the client's own
// projects, each opened on the common review surface. The client comments as
// their contact, can draw markup, and approves or requests changes when the
// team allowed it for that review. Every comment on a shared review is shown,
// including the team's: review comments have no internal-only flag.

async function portalJson(path, token, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await portalFetch(path, token, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status, code: data?.code });
  return data;
}

function ReviewDetail({ reviewId, token, onBack, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await portalJson(`/api/client-portal/reviews/${encodeURIComponent(reviewId)}`, token));
      setError('');
    } catch (err) {
      setError(err.status === 404 ? 'This review is no longer available.' : 'The review could not be loaded. Try again.');
    }
  }, [reviewId, token]);

  useEffect(() => { setData(null); load(); }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="link" onClick={onBack} leftIcon={Icons.back}>All reviews</Button>
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }
  if (!data) return <LoadingState label="Loading review..." />;

  const { session, permissions, annotations, decisions, versions } = data;
  const base = `/api/client-portal/reviews/${encodeURIComponent(session.id)}`;
  return (
    <div className="space-y-4">
      <Button type="button" variant="link" onClick={onBack} leftIcon={Icons.back}>All reviews</Button>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={pageTitleClass}>{session.title}</h2>
        <StatusBadge status={session.status} />
        <span className="text-sm text-muted-foreground">Version {session.version}{session.projectName ? ` · ${session.projectName}` : ''}</span>
      </div>
      <VersionSwitcher versions={versions} currentId={session.id} onSelect={onOpen} />
      {session.capture && <p className="text-sm text-muted-foreground">A screenshot of a web page ({session.capture.viewport === 'mobile' ? 'mobile' : 'desktop'} view).</p>}
      {data.annotationsTruncated && (
        <p className="text-sm text-muted-foreground">Showing the newest comment threads of {data.annotationTotal} comments.</p>
      )}
      <MediaReview
        key={session.id}
        media={{ ...session.media, url: `${API}${base}/file` }}
        status={session.status}
        annotations={annotations}
        decisions={decisions}
        canComment={Boolean(permissions?.canComment)}
        canDecide={Boolean(permissions?.canDecide)}
        onAddAnnotation={async (body) => {
          const result = await portalJson(`${base}/annotations`, token, { method: 'POST', body });
          await load();
          return result.annotation;
        }}
        onDecide={async (body) => {
          await portalJson(`${base}/decisions`, token, { method: 'POST', body });
          await load();
        }}
      />
    </div>
  );
}

export default function ReviewsTab({ token }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await portalJson('/api/client-portal/reviews', token);
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setError('');
    } catch {
      setError('Your reviews could not be loaded. Try again.');
      setSessions([]);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (openId) {
    return <ReviewDetail reviewId={openId} token={token} onOpen={setOpenId} onBack={() => { setOpenId(null); load(); }} />;
  }
  if (!sessions) return <LoadingState label="Loading reviews..." />;

  return (
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Reviews</h2>
      <p className="text-sm text-muted-foreground">Files and web pages the team has shared for your feedback. Open one to comment, mark it up and, where asked, approve it.</p>
      {error && <Alert variant="error">{error}</Alert>}
      {sessions.length === 0 && !error ? (
        <Card><p className="text-sm text-muted-foreground">Nothing to review right now.</p></Card>
      ) : (
        <ul className="space-y-3" aria-label="Reviews">
          {sessions.map((session) => (
            <li key={session.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className={sectionTitleClass}>{session.title} <span className="text-sm font-normal text-muted-foreground">(v{session.version})</span></h3>
                  <p className="text-sm text-muted-foreground">
                    {session.projectName ? `${session.projectName} · ` : ''}{session.openAnnotationCount} open comment{session.openAnnotationCount === 1 ? '' : 's'} · {fmtDate(session.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={session.status} />
                  <Button type="button" onClick={() => setOpenId(session.id)} aria-label={`Open review ${session.title}, version ${session.version}`}>Open</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
