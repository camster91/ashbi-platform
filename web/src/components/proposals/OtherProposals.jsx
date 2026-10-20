import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Card, StatusBadge } from '../ui';

const MAX_SHOWN = 5;
const linkClass = 'rounded-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

// "Other proposals" (design: Proposals mockup). Reads the same query as the
// unfiltered /proposals list, so moving between the two shares one request.
export default function OtherProposals({ currentId }) {
  const { data = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['proposals', ''],
    queryFn: () => api.getProposals({}),
  });
  const others = (Array.isArray(data) ? data : []).filter((p) => p.id !== currentId).slice(0, MAX_SHOWN);

  return (
    <Card as="section" padding="none" className="rounded-lg p-5" aria-labelledby="other-proposals-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="other-proposals-heading" className="text-lg font-semibold tracking-tight text-foreground">Other proposals</h2>
        <Link to="/proposals" className={`${linkClass} inline-flex min-h-11 items-center text-sm -my-3`}>All proposals</Link>
      </div>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">Loading proposals…</p>
      ) : isError ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Other proposals could not be loaded.{' '}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={`${linkClass} min-h-11 px-1`}>
            Retry
          </button>
        </p>
      ) : others.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No other proposals yet.</p>
      ) : (
        <ul className="mt-2">
          {others.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 border-t border-border/40 py-1.5">
              <Link
                to={`/proposal/${p.id}`}
                className="flex min-h-11 min-w-0 items-center rounded-sm text-foreground hover:text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="break-words">{p.client?.name ? `${p.client.name} · ${p.title}` : p.title}</span>
              </Link>
              <StatusBadge domain="proposal" status={p.status} className="shrink-0 font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
