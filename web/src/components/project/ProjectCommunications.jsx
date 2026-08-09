import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Mail,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelativeTime, cn } from '../../lib/utils';
import LoadingState from '../ui/LoadingState';
import QueryErrorState from '../QueryErrorState';

const DIRECTION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'OUTBOUND', label: 'Outbound' },
];

const sentimentColors = {
  positive: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
  negative: 'bg-destructive/10 text-destructive',
  frustrated: 'bg-destructive/10 text-destructive',
  happy: 'bg-primary/10 text-primary',
  anxious: 'bg-accent text-accent-foreground',
  confused: 'bg-secondary text-secondary-foreground',
};

export default function ProjectCommunications({ projectId }) {
  const [direction, setDirection] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(0);
  const limit = 20;

  const {
    data,
    isLoading,
    isError: communicationsError,
    error: communicationsRequestError,
    refetch: refetchCommunications,
    isFetching: communicationsFetching,
  } = useQuery({
    queryKey: ['project-communications', projectId, direction, page],
    queryFn: () =>
      api.getProjectCommunications(projectId, {
        direction: direction !== 'all' ? direction : undefined,
        limit: String(limit),
        offset: String(page * limit),
      }),
  });

  const {
    data: selectedCommunication,
    isLoading: detailLoading,
    isError: detailError,
    error: detailRequestError,
    refetch: refetchDetail,
    isFetching: detailFetching,
  } = useQuery({
    queryKey: ['project-communication-full', projectId, expandedId],
    queryFn: () => api.getProjectCommunication(projectId, expandedId),
    enabled: Boolean(expandedId),
  });

  const communications = data?.communications || [];
  const total = data?.total || 0;

  if (isLoading) {
    return <LoadingState label="Loading project communications…" size="sm" compact className="h-32" />;
  }

  if (communicationsError) {
    return <QueryErrorState error={communicationsRequestError} message="Project communications could not be loaded" onRetry={refetchCommunications} isRetrying={communicationsFetching} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {DIRECTION_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setDirection(f.value); setPage(0); }}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors',
              direction === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} email{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Timeline */}
      {communications.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No communications logged yet
        </div>
      ) : (
        <div className="space-y-2">
          {communications.map((comm) => (
            <CommunicationEntry
              key={comm.id}
              comm={comm}
              isExpanded={expandedId === comm.id}
              onToggle={() => setExpandedId(expandedId === comm.id ? null : comm.id)}
              detail={expandedId === comm.id ? selectedCommunication : null}
              detailLoading={expandedId === comm.id && detailLoading}
              detailError={expandedId === comm.id ? detailError : false}
              detailRequestError={detailRequestError}
              refetchDetail={refetchDetail}
              detailFetching={detailFetching}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={(page + 1) * limit >= total}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function CommunicationEntry({ comm, isExpanded, onToggle, detail, detailLoading, detailError, detailRequestError, refetchDetail, detailFetching }) {
  const isInbound = comm.direction === 'INBOUND';
  const displayCommunication = detail || comm;
  let actionItems = [];
  try {
    actionItems = displayCommunication.actionItems ? JSON.parse(displayCommunication.actionItems) : [];
  } catch { /* ignore */ }

  return (
    <div className="bg-card text-card-foreground rounded-lg shadow-sm border border-border overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-secondary/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`communication-${comm.id}-detail`}
      >
        {/* Direction icon */}
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
          isInbound ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'
        )}>
          {isInbound ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{comm.subject}</span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              isInbound ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'
            )}>
              {isInbound ? 'IN' : 'OUT'}
            </span>
            {comm.sentiment && (
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded capitalize',
                sentimentColors[comm.sentiment?.toLowerCase()] || 'bg-muted text-muted-foreground'
              )}>
                {comm.sentiment}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {comm.from} &rarr; {comm.to}
          </div>
          {comm.summary && (
            <p className="text-sm text-muted-foreground mt-1">{comm.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(comm.receivedAt)}
          </span>
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div id={`communication-${comm.id}-detail`} className="px-4 pb-4 pt-0 border-t border-border/50">
          {detailLoading ? (
            <LoadingState label={`Loading ${comm.subject || 'communication'} details…`} size="sm" compact className="mt-3" />
          ) : detailError ? (
            <div className="mt-3">
              <QueryErrorState error={detailRequestError} message="This communication could not be loaded" onRetry={refetchDetail} isRetrying={detailFetching} />
            </div>
          ) : (
            <div className="mt-3 p-3 bg-muted/50 text-foreground rounded text-sm whitespace-pre-wrap font-mono">
              {displayCommunication.fullBody || displayCommunication.bodySnippet || 'No message body is available.'}
            </div>
          )}

          {!detailLoading && !detailError && actionItems.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Action Items</h4>
              <ul className="space-y-1">
                {actionItems.map((item, i) => (
                  <li
                    key={i}
                    className="text-sm px-2 py-1 bg-accent border border-border rounded text-accent-foreground"
                  >
                    {typeof item === 'string' ? item : item.task || item.description || JSON.stringify(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
