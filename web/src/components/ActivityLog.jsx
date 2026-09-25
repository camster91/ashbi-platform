import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import QueryErrorState from './QueryErrorState';
import { Button, EmptyState, Input, LoadingState } from './ui';

const EMPTY_FILTERS = { action: '', entityType: '', actorType: '', entityId: '', from: '', to: '' };
const selectClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background';

// Date inputs are local calendar days; the API takes inclusive ISO instants.
export function toAuditQuery(filters) {
  const query = {};
  for (const field of ['action', 'entityType', 'actorType']) {
    if (filters[field]) query[field] = filters[field];
  }
  if (filters.entityId?.trim()) query.entityId = filters.entityId.trim();
  if (filters.from) query.from = new Date(`${filters.from}T00:00:00`).toISOString();
  if (filters.to) query.to = new Date(`${filters.to}T23:59:59.999`).toISOString();
  return query;
}

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function describeActor(event) {
  if (event.actorName) return event.actorName;
  if (event.actorType === 'WEBHOOK') return 'Payment provider';
  if (event.actorType === 'CLIENT') return 'Client';
  if (event.actorType === 'SYSTEM') return 'System';
  return event.actorUserId ? 'Unknown user' : 'Unauthenticated';
}

function MetadataList({ metadata }) {
  const entries = Object.entries(metadata || {});
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-all text-foreground">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Admin-only, read-only view of the append-only audit log. The server enforces
 * access; this section is only rendered for admins to avoid a pointless 403.
 */
export default function ActivityLog() {
  const formId = useId();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const query = toAuditQuery(applied);

  const catalog = useQuery({
    queryKey: ['audit-event-catalog'],
    queryFn: api.getAuditEventCatalog,
    staleTime: Infinity,
    retry: false,
  });

  const events = useInfiniteQuery({
    queryKey: ['audit-events', query],
    queryFn: ({ pageParam }) => api.getAuditEvents({ ...query, limit: 50, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    retry: false,
  });

  const rows = events.data?.pages.flatMap((page) => page.events || []) ?? [];
  const filtered = Object.values(applied).some(Boolean);
  const update = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    setApplied(draft);
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const options = (list = []) => list.map((value) => <option key={value} value={value}>{value}</option>);

  return (
    <div className="space-y-4">
      <form onSubmit={submit} aria-label="Filter activity log" className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-action`}>
          Action
          <select id={`${formId}-action`} className={`${selectClass} mt-1`} value={draft.action} onChange={update('action')}>
            <option value="">All actions</option>
            {options(catalog.data?.actions)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-entity-type`}>
          Entity type
          <select id={`${formId}-entity-type`} className={`${selectClass} mt-1`} value={draft.entityType} onChange={update('entityType')}>
            <option value="">All entity types</option>
            {options(catalog.data?.entityTypes)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-actor-type`}>
          Actor type
          <select id={`${formId}-actor-type`} className={`${selectClass} mt-1`} value={draft.actorType} onChange={update('actorType')}>
            <option value="">All actors</option>
            {options(catalog.data?.actorTypes)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-entity-id`}>
          Entity ID
          <Input id={`${formId}-entity-id`} className="mt-1" value={draft.entityId} onChange={update('entityId')} placeholder="e.g. an invoice ID" />
        </label>
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-from`}>
          From
          <Input id={`${formId}-from`} type="date" className="mt-1" value={draft.from} onChange={update('from')} />
        </label>
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`${formId}-to`}>
          To
          <Input id={`${formId}-to`} type="date" className="mt-1" value={draft.to} onChange={update('to')} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <Button type="submit" size="sm">Apply filters</Button>
          <Button type="button" size="sm" variant="outline" onClick={reset} disabled={!filtered && !Object.values(draft).some(Boolean)}>
            Clear filters
          </Button>
        </div>
      </form>

      {events.isLoading ? (
        <LoadingState label="Loading activity log…" compact size="sm" />
      ) : events.error && rows.length === 0 ? (
        <QueryErrorState
          error={events.error}
          message="The activity log could not be loaded"
          onRetry={() => events.refetch()}
          isRetrying={events.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="document"
          title={filtered ? 'No events match these filters' : 'No activity recorded yet'}
          description={filtered
            ? 'Widen the date range or clear a filter to see more of the log.'
            : 'Invoices sent or paid, signed contracts, role changes and other sensitive actions will appear here.'}
          className="py-8"
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Activity log, newest first. {rows.length} event{rows.length === 1 ? '' : 's'} shown.
              </caption>
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Entity</th>
                  <th scope="col" className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      <time dateTime={event.createdAt}>{formatWhen(event.createdAt)}</time>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{event.action}</td>
                    <td className="px-3 py-2">
                      <span className="block">{describeActor(event)}</span>
                      <span className="block text-xs text-muted-foreground">{event.actorType}{event.ip ? ` · ${event.ip}` : ''}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block">{event.entityType}</span>
                      {event.entityId && <span className="block break-all font-mono text-xs text-muted-foreground">{event.entityId}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <MetadataList metadata={event.metadata} />
                      {event.requestId && <span className="mt-1 block text-xs text-muted-foreground">Request {event.requestId}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.error && (
            <p role="alert" className="text-sm text-destructive">More events could not be loaded. Try again.</p>
          )}
          {events.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => events.fetchNextPage()}
              isLoading={events.isFetchingNextPage}
              disabled={events.isFetchingNextPage}
            >
              {events.isFetchingNextPage ? 'Loading more…' : 'Load older events'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
