import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';
import ResponseReviewActions from '../components/ResponseReviewActions';
import { EmptyState, LoadingState } from '../components/ui';

/** Client replies the team has asked an admin to approve before sending. */
export default function ResponseApprovals() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['responses', 'pending'],
    queryFn: () => api.getPendingResponses(),
  });
  const responses = Array.isArray(data) ? data : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/approvals" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        All approvals
      </Link>
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Client replies to approve</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approving sends nothing. The approved text is sent from the conversation with Reply via Gmail.
        </p>
      </div>

      {isLoading ? (
        <LoadingState label="Loading replies…" />
      ) : isError ? (
        <QueryErrorState error={error} message="Replies waiting for approval could not be loaded" onRetry={refetch} isRetrying={isFetching} />
      ) : responses.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing to approve" description="When someone asks for approval on a client reply, it shows up here." />
      ) : (
        <ul className="space-y-3" aria-label="Replies waiting for approval">
          {responses.map((response) => {
            const subject = response.thread?.subject || response.subject;
            return (
              <li key={response.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-heading font-semibold text-foreground break-words">{subject}</h2>
                    <p className="text-sm text-muted-foreground">
                      {[response.thread?.client?.name, response.thread?.project?.name].filter(Boolean).join(' · ') || 'No client'}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground sm:text-right">
                    {response.draftedBy?.name ? `By ${response.draftedBy.name}, ` : ''}
                    {new Date(response.updatedAt || response.createdAt).toLocaleString()}
                  </p>
                </div>
                <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                  {response.body}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <ResponseReviewActions response={response} threadSubject={subject} />
                  <Link
                    to={`/thread/${response.threadId}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    Open conversation
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
