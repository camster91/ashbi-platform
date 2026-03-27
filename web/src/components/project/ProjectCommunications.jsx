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

const DIRECTION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'OUTBOUND', label: 'Outbound' },
];

const sentimentColors = {
  positive: 'bg-green-100 text-green-700',
  neutral: 'bg-gray-100 text-gray-600',
  negative: 'bg-red-100 text-red-700',
  frustrated: 'bg-red-100 text-red-700',
  happy: 'bg-green-100 text-green-700',
  anxious: 'bg-amber-100 text-amber-700',
  confused: 'bg-purple-100 text-purple-700',
};

export default function ProjectCommunications({ projectId }) {
  const [direction, setDirection] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['project-communications', projectId, direction, page],
    queryFn: () =>
      api.getProjectCommunications(projectId, {
        direction: direction !== 'all' ? direction : undefined,
        limit: String(limit),
        offset: String(page * limit),
        full: expandedId ? 'true' : undefined,
      }),
  });

  const { data: fullData } = useQuery({
    queryKey: ['project-communication-full', expandedId],
    queryFn: () =>
      api.getProjectCommunications(projectId, { full: 'true', limit: '1', offset: '0' }),
    enabled: false,
  });

  const communications = data?.communications || [];
  const total = data?.total || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
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
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            className="px-3 py-1 text-sm border border-border rounded hover:bg-secondary disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={(page + 1) * limit >= total}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-secondary disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function CommunicationEntry({ comm, isExpanded, onToggle }) {
  const isInbound = comm.direction === 'INBOUND';
  let actionItems = [];
  try {
    actionItems = comm.actionItems ? JSON.parse(comm.actionItems) : [];
  } catch { /* ignore */ }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
      <div
        className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-secondary/30 transition-colors"
        onClick={onToggle}
      >
        {/* Direction icon */}
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
          isInbound ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
        )}>
          {isInbound ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{comm.subject}</span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              isInbound ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
            )}>
              {isInbound ? 'IN' : 'OUT'}
            </span>
            {comm.sentiment && (
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded capitalize',
                sentimentColors[comm.sentiment?.toLowerCase()] || 'bg-gray-100 text-gray-600'
              )}>
                {comm.sentiment}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {comm.from} &rarr; {comm.to}
          </div>
          {comm.summary && (
            <p className="text-sm text-gray-600 mt-1">{comm.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(comm.receivedAt)}
          </span>
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50">
          <div className="mt-3 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap font-mono text-gray-700">
            {comm.fullBody || comm.bodySnippet}
          </div>

          {actionItems.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Action Items</h4>
              <ul className="space-y-1">
                {actionItems.map((item, i) => (
                  <li
                    key={i}
                    className="text-sm px-2 py-1 bg-amber-50 border border-amber-200 rounded text-amber-800"
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
