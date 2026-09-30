import { useId, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatDate } from '../lib/format';
import { cn } from '../lib/utils';
import QueryErrorState from '../components/QueryErrorState';
import PartialSectionNotice from '../components/PartialSectionNotice';
import { Badge, Card, EmptyState, LoadingState } from '../components/ui';

// Daily operator queue (#461): one list over tasks, approvals, reviews and
// client-facing documents. Each row opens its source record; nothing is
// changed from here. See docs/operator-queue.md for the view mapping.

export const QUEUE_VIEWS = [
  { key: 'needs_action', label: 'Needs action', empty: 'Nothing needs action right now.' },
  { key: 'awaiting_approval', label: 'Awaiting approval', empty: 'No approvals or internal reviews are waiting on a decision.' },
  { key: 'waiting_on_client', label: 'Waiting on client', empty: 'Nothing is waiting on a client.' },
  { key: 'at_risk', label: 'At risk', empty: 'Nothing is blocked or overdue.' },
];

// Matches WORK_QUEUE_SOURCE_LIMIT in src/services/work-queue.service.js.
const QUEUE_SOURCE_LIMIT = 100;

const TYPE_LABELS = {
  task: 'Task',
  approval: 'Approval',
  review: 'Review',
  proposal: 'Proposal',
  contract: 'Contract',
  invoice: 'Invoice',
};

const SOURCE_LABELS = {
  tasks: 'Tasks',
  approvals: 'Approvals',
  reviews: 'Reviews',
  proposals: 'Proposals',
  contracts: 'Contracts',
  invoices: 'Invoices',
};

const VIEW_BADGE = {
  needs_action: 'primary',
  awaiting_approval: 'info',
  waiting_on_client: 'default',
  at_risk: 'danger',
};

function listSources(keys = []) {
  return keys.map((key) => SOURCE_LABELS[key] || key).join(', ');
}

function describeAge(days) {
  if (days === null || days === undefined) return null;
  if (days === 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

function QueueRow({ row }) {
  const context = [row.client?.name, row.project?.name].filter(Boolean).join(' · ');
  const age = describeAge(row.ageDays);
  return (
    <li>
      <Link
        to={row.sourceUrl}
        className="group flex min-h-11 items-start gap-3 rounded-xl px-4 py-3 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${TYPE_LABELS[row.type] || row.type}: ${row.title}. ${row.nextAction}`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={VIEW_BADGE[row.view] || 'default'} variant="subtle">{TYPE_LABELS[row.type] || row.type}</Badge>
            <span className="font-medium text-foreground break-words">{row.title}</span>
          </div>
          <p className="text-sm text-foreground/80">{row.nextAction}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {context && <span>{context}</span>}
            <span>Owner: {row.owner?.name || 'Unassigned'}</span>
            <span>State: {row.state}</span>
            {row.dueAt && <span>Due {formatDate(row.dueAt, { dateOnly: true })}</span>}
            {age && <span>Age {age}</span>}
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function WorkQueue() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const baseId = useId();
  const tabRefs = useRef([]);

  const requestedView = searchParams.get('view');
  const activeView = QUEUE_VIEWS.some((view) => view.key === requestedView) ? requestedView : QUEUE_VIEWS[0].key;
  const defaultOwner = user?.role === 'ADMIN' ? 'everyone' : 'me';
  const owner = searchParams.get('owner') === 'me' || searchParams.get('owner') === 'everyone'
    ? searchParams.get('owner')
    : defaultOwner;
  const clientId = searchParams.get('clientId') || '';

  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['work-queue', owner, clientId],
    queryFn: () => api.getWorkQueue({ owner, clientId: clientId || undefined }),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients().then((r) => r?.clients ?? []),
  });
  const clientOptions = Array.isArray(clients) ? clients : [];

  const counts = data?.counts || {};
  const rows = (data?.rows || []).filter((row) => row.view === activeView);
  const activeMeta = QUEUE_VIEWS.find((view) => view.key === activeView);

  const selectTab = (index) => {
    const view = QUEUE_VIEWS[(index + QUEUE_VIEWS.length) % QUEUE_VIEWS.length];
    updateParams({ view: view.key });
    tabRefs.current[QUEUE_VIEWS.indexOf(view)]?.focus();
  };

  const onTabKeyDown = (event, index) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); selectTab(index + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); selectTab(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); selectTab(0); }
    else if (event.key === 'End') { event.preventDefault(); selectTab(QUEUE_VIEWS.length - 1); }
  };

  const ownerId = `${baseId}-owner`;
  const clientSelectId = `${baseId}-client`;
  const panelId = `${baseId}-panel`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Daily queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What needs attention across client delivery. Open a row to act on it in its own record.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={ownerId} className="text-xs font-medium text-muted-foreground">Owner</label>
            <select
              id={ownerId}
              value={owner}
              onChange={(event) => updateParams({ owner: event.target.value })}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="me">Me</option>
              <option value="everyone">Everyone</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={clientSelectId} className="text-xs font-medium text-muted-foreground">Client</label>
            <select
              id={clientSelectId}
              value={clientId}
              onChange={(event) => updateParams({ clientId: event.target.value })}
              className="min-h-11 max-w-[16rem] rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All clients</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Queue views">
        {QUEUE_VIEWS.map((view, index) => {
          const selected = view.key === activeView;
          const count = data ? (counts[view.key] ?? 0) : null;
          return (
            <button
              key={view.key}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${view.key}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => updateParams({ view: view.key })}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {view.label}
              {count !== null && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" aria-label={`${count} items`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`${baseId}-tab-${activeView}`} tabIndex={0} className="space-y-4 focus-visible:outline-none">
        {isLoading ? (
          <LoadingState label="Loading queue…" />
        ) : isError ? (
          <QueryErrorState error={error} onRetry={() => refetch()} isRetrying={isFetching} />
        ) : (
          <>
            {data?.partial && (
              <PartialSectionNotice
                section={listSources(data.failedSources)}
                title={`Some queue sources did not load: ${listSources(data.failedSources)}`}
                detail="Rows and counts from the other sources are shown, so this queue may be incomplete."
                error={{ status: 503 }}
                onRetry={() => refetch()}
                isRetrying={isFetching}
              />
            )}
            {data?.truncatedSources?.length > 0 && (
              <p className="text-xs text-muted-foreground" role="note">
                Showing the first {QUEUE_SOURCE_LIMIT} items from {listSources(data.truncatedSources)}. Filter by client to see the rest.
              </p>
            )}
            {rows.length === 0 ? (
              <EmptyState
                icon="success"
                title={`${activeMeta.label}: all clear`}
                description={owner === 'me'
                  ? `${activeMeta.empty} Switch Owner to Everyone to see the whole team's queue.`
                  : activeMeta.empty}
              />
            ) : (
              <Card padding="none">
                <ul className="divide-y divide-border/60" aria-label={`${activeMeta.label} items`}>
                  {rows.map((row) => <QueueRow key={`${row.type}:${row.id}`} row={row} />)}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
