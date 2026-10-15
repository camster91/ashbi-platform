import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import Button from './ui/Button';
import ClientAssistantPreview from './ClientAssistantPreview';

const VIEWS = [
  ['needs_action', 'Needs action'],
  ['awaiting_approval', 'Awaiting approval'],
  ['waiting_on_client', 'Waiting on client'],
  ['at_risk', 'At risk'],
];
const SOURCES = { tasks: 'tasks', approvals: 'approvals', reviews: 'reviews', proposals: 'proposals', contracts: 'contracts', invoices: 'invoices' };

function sourceNames(values) {
  return values.map((source) => SOURCES[source] || 'another source').join(', ');
}

function isLocalPath(value) {
  return typeof value === 'string' && /^\/(?![\\/])/.test(value) && !/[\\\s\u0000-\u001f\u007f]/.test(value);
}

export default function ClientAccountManager({ clientId, clientName, role }) {
  const [open, setOpen] = useState(false);
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['client-account-manager', clientId, role],
    queryFn: () => api.getClientAccountManagerBrief(clientId),
    enabled: open && Boolean(clientId),
    retry: false,
    placeholderData: null,
  });
  const failedSources = data?.failedSources || [];
  const truncatedSources = data?.truncatedSources || [];
  const incomplete = Boolean(data?.partial || failedSources.length || truncatedSources.length);
  const rows = data?.rows || [];
  const observed = data?.generatedAt && new Date(data.generatedAt);
  const validObserved = observed && !Number.isNaN(observed.getTime());

  return (
    <details
      className="rounded-lg border border-border bg-card p-4"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="min-h-11 cursor-pointer font-medium">Account manager</summary>
      <div className="mt-2 space-y-4">
        <p className="text-sm text-muted-foreground">
          Review {clientName || 'this client'}’s work and open the source record to take the next step.
          {' '}{(data ? data.owner === 'everyone' : role === 'ADMIN') ? 'Includes the team’s work.' : 'Includes your assigned tasks and the reviews you can open.'}
        </p>
        {open && !clientId && <p role="status">Choose a client to see their work.</p>}
        {open && clientId && isPending && !isError && <p role="status">Loading client work…</p>}
        {open && isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p>Client work could not be loaded. Retry to check the latest information.</p>
            <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              Retry client work
            </Button>
          </div>
        )}
        {open && data && (
          <>
            {validObserved && (
              <p className="text-xs text-muted-foreground">Observed <time dateTime={data.generatedAt}>{observed.toLocaleString()}</time></p>
            )}
            {isFetching && <p role="status" className="text-sm">Refreshing client work…</p>}
            {(data.partial || failedSources.length > 0) && (
              <p role="status" className="text-sm text-warning">
                This view is incomplete. {failedSources.length > 0 ? `Could not load: ${sourceNames(failedSources)}.` : 'Some sources did not load.'}
                {' '}Counts reflect only the records loaded.
              </p>
            )}
            {data.scopeMismatch && <p role="status" className="text-sm text-warning">Some source records could not be matched to this client. This view is incomplete.</p>}
            {truncatedSources.length > 0 && (
              <p role="status" className="text-sm text-warning">
                Source limits were reached for {sourceNames(truncatedSources)}. Counts and records may exclude additional work.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VIEWS.map(([key, label]) => (
                <div key={key} className="rounded-lg bg-muted p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-medium">{data.counts?.[key] ?? 'Unavailable'}</dd>
                </div>
              ))}
            </dl>
            {rows.length > 0 ? (
              <ul className="space-y-3" aria-label="Client work records">
                {rows.slice(0, 8).map((row, index) => (
                  <li key={`${row.type}-${row.id}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                    {isLocalPath(row.sourceUrl)
                      ? <Link to={row.sourceUrl} className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">{row.title}</Link>
                      : <p className="font-medium">{row.title}</p>}
                    <p>{row.nextAction}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Owner: {row.owner?.name || 'Unassigned'} · State: {row.state || row.status || 'Unknown'}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{incomplete ? 'No records were returned from the sources that loaded. Additional work may be missing.' : 'No work records were returned for this client and your access.'}</p>}
            {(data.hasMore || rows.length > 8) && <p className="text-xs text-muted-foreground">Showing {Math.min(rows.length, 8)} of {data.total ?? rows.length} loaded records. Open the client work queue to review more.</p>}
          </>
        )}
        <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" to={`/queue?clientId=${encodeURIComponent(clientId || '')}`}>Open client work queue</Link>
        {open && clientId && <ClientAssistantPreview key={clientId} clientId={clientId} clientName={clientName} />}
      </div>
    </details>
  );
}
