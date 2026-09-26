import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import MediaReview, { StatusBadge } from '../components/review/MediaReview';
import LoadingState from '../components/ui/LoadingState';

// Client review page reached through a share link (#417,
// docs/media-review.md). No sign-in: the token in the URL is the capability.

function Unavailable() {
  // The API answers the same 404 for unknown, expired and revoked links, so
  // the page explains all three without claiming which one applies.
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">This review link is not available</h1>
        <p className="text-muted-foreground">
          It may have expired or been revoked, or the address may be incomplete. Ask the team that sent it for a new link.
        </p>
      </div>
    </main>
  );
}

export default function PortalReview() {
  const { token } = useParams();
  const queryClient = useQueryClient();
  const queryKey = ['portal-review', token];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => api.getPortalReview(token), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  if (isLoading) return <LoadingState label="Loading review…" className="min-h-screen bg-background text-foreground" />;
  if (error || !data) return <Unavailable />;

  const { session, link, annotations, decisions } = data;
  const identity = () => ({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-5 sm:px-6">
          <h1 className="text-2xl font-bold text-foreground">{session.title}</h1>
          <StatusBadge status={session.status} />
          <span className="text-sm text-muted-foreground">Version {session.version}</span>
          <p className="w-full text-sm text-muted-foreground">Review link valid until {formatDateTime(link.expiresAt)}.</p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        {data.annotationsTruncated && (
          <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">Showing the newest comment threads of {data.annotationTotal} comments. Older comments are kept but not listed here.</p>
        )}
        {link.decisionRecorded && (
          <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">A decision has already been recorded through this link. Contact the team if it needs to change.</p>
        )}
        <MediaReview
          media={{ ...session.media, url: api.portalReviewFileUrl(token) }}
          status={session.status}
          annotations={annotations}
          decisions={decisions}
          canComment={link.canComment}
          canDecide={Boolean(link.canDecide)}
          guest={{ name, email, setName, setEmail }}
          onAddAnnotation={async (body) => {
            const result = await api.addPortalReviewAnnotation(token, { ...identity(), ...body });
            await refresh();
            return result.annotation;
          }}
          onDecide={async (body) => {
            await api.recordPortalReviewDecision(token, { ...identity(), ...body });
            await refresh();
          }}
        />
      </main>
    </div>
  );
}
