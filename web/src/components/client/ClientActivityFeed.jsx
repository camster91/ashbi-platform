import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatRelativeTime, cn } from '../../lib/utils';
import { formatDateTime, formatMoney } from '../../lib/format';
import { Button, Card } from '../ui';
import QueryErrorState from '../QueryErrorState';
import { emptyClass, panelHeaderClass, panelTitleClass } from './clientPageStyles';

// The client page's Activity panel (design: Client mockup, right column).
// One timeline from GET /api/clients/:id/activity: conversations, project
// work and, for admins only, invoices and payments. The server decides what
// a role may see; this panel words it (and drops money for non-admins).

export const CLIENT_ACTIVITY_PAGE_SIZE = 8;

// Invoice and payment items. The server only sends them to admins; the panel
// drops them for anyone else too, so a cached admin page can never show money.
export const MONEY_ACTIVITY_KINDS = new Set(['invoice_sent', 'invoice_paid', 'payment']);

const PAYMENT_METHODS = {
  STRIPE: 'card (Stripe)', BANK: 'bank transfer', TRANSFER: 'transfer', CHEQUE: 'cheque', CHECK: 'cheque', CASH: 'cash', OTHER: 'other',
};

const DOT_CLASS = {
  conversation: 'bg-info',
  client: 'bg-warning',
  payment: 'bg-success',
  invoice_paid: 'bg-success',
  invoice_sent: 'bg-primary',
};

function who(item) {
  return item.actor?.name || 'Someone';
}

/** One plain sentence for an activity item. Exported for tests. */
export function activityText(item) {
  const name = item.title;
  switch (item.kind) {
    case 'conversation': return name || 'Conversation';
    case 'file': return `${who(item)} uploaded ${name || 'a file'}`;
    case 'comment': return `${who(item)} commented on ${name || 'a task'}`;
    case 'milestone': {
      if (item.action === 'completed') return `Milestone ${name || ''} completed`.replace(/\s+/g, ' ');
      if (item.action === 'created') return `Milestone ${name || ''} added`.replace(/\s+/g, ' ');
      return `Milestone ${name || ''} updated`.replace(/\s+/g, ' ');
    }
    case 'time': return `${who(item)} logged ${name || 'time'}`;
    case 'client':
      if (item.type === 'CLIENT_REVISION_APPROVED') return `Client approved ${name || 'a revision'}`;
      if (item.type === 'CLIENT_REVISION_CHANGES_REQUESTED') return `Client asked for changes to ${name || 'a revision'}`;
      return `Client left feedback on ${item.project?.name || name || 'a project'}`;
    case 'chat': return `${who(item)} posted in the project chat`;
    case 'event': return `${who(item)} scheduled ${name || 'an event'}`;
    case 'invoice_sent': return `${name || 'Invoice'} sent`;
    case 'invoice_paid': return `${name || 'Invoice'} marked paid`;
    case 'payment': return `Payment received on ${name || 'an invoice'}`;
    default: return name || 'Activity';
  }
}

function activityMeta(item) {
  const parts = [formatRelativeTime(item.at)];
  if (item.kind === 'conversation') parts.push('Conversation');
  if (item.project?.name && item.kind !== 'client') parts.push(item.project.name);
  if (['payment', 'invoice_paid', 'invoice_sent'].includes(item.kind) && item.amount != null) {
    const method = item.method ? PAYMENT_METHODS[item.method] || item.method.toLowerCase() : null;
    parts.push(`${formatMoney(item.amount, item.currency || undefined)}${method && item.kind !== 'invoice_sent' ? ` by ${method}` : ''}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function ActivityRow({ item }) {
  const text = activityText(item);
  const body = (
    <>
      <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT_CLASS[item.kind] || 'bg-secondary-foreground/40')} />
      <span className="min-w-0">
        <span className="block text-foreground break-words">{text}</span>
        <span className="block text-xs text-muted-foreground">
          <time dateTime={item.at} title={formatDateTime(item.at)}>{activityMeta(item)}</time>
        </span>
      </span>
    </>
  );
  return (
    <li className="border-t border-border/40 first:border-t-0">
      {item.href ? (
        <Link
          to={item.href}
          className="flex gap-3 py-3 -mx-2 px-2 rounded-md hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      ) : (
        <div className="flex gap-3 py-3">{body}</div>
      )}
    </li>
  );
}

export default function ClientActivityFeed({ clientId, role }) {
  const query = useInfiniteQuery({
    // The role is part of the key: admins and team members get different feeds.
    queryKey: ['client-activity', clientId, role],
    queryFn: ({ pageParam }) => api.getClientActivity(clientId, { limit: CLIENT_ACTIVITY_PAGE_SIZE, before: pageParam || undefined }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.nextBefore || undefined,
    enabled: Boolean(clientId),
  });
  const items = (query.data?.pages || [])
    .flatMap((page) => page?.items || [])
    .filter((item) => role === 'ADMIN' || !MONEY_ACTIVITY_KINDS.has(item.kind));

  return (
    <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-activity-feed-heading">
      <div className={panelHeaderClass}>
        <h2 id="client-activity-feed-heading" className={panelTitleClass}>Activity</h2>
      </div>
      {query.isLoading ? (
        <p role="status" className={emptyClass}>Loading activity…</p>
      ) : query.isError && items.length === 0 ? (
        <div className="px-5 pb-4">
          <QueryErrorState error={query.error} message="Activity could not be loaded" onRetry={() => query.refetch()} isRetrying={query.isFetching} />
        </div>
      ) : items.length === 0 ? (
        <p className={emptyClass}>Nothing has happened with this client yet.</p>
      ) : (
        <>
          <ol className="px-5 pb-2" aria-label="Client activity, newest first">
            {items.map((item) => <ActivityRow key={item.id} item={item} />)}
          </ol>
          {query.isFetchNextPageError && (
            <p role="alert" className="px-5 pb-2 text-sm text-destructive">Older activity could not be loaded. Try again.</p>
          )}
          {query.hasNextPage && (
            <div className="px-5 pb-4">
              <Button variant="outline" size="sm" type="button" loading={query.isFetchingNextPage} slowKind="read" onClick={() => query.fetchNextPage()}>
                Show older activity
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
