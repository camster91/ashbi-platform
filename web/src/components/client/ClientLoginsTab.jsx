import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Card } from '../ui';
import QueryErrorState from '../QueryErrorState';
import { emptyClass, panelHeaderClass, panelLinkClass, panelTitleClass } from './clientPageStyles';

// Client page "Logins" tab (admins only; the page never renders it for
// anyone else and GET /api/credentials is admin-only). Lists the client's
// vault entries by name, type and address only: usernames, passwords and
// notes are never shown here. Revealing or copying a secret happens in the
// vault, behind its re-authentication and purpose-logged reveal.

const CATEGORY_LABELS = { WP_ADMIN: 'WP Admin', HOSTING: 'Hosting', DNS: 'DNS', FTP: 'FTP', STRIPE: 'Stripe', OTHER: 'Other' };

function safeHref(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function ClientLoginsTab({ clientId }) {
  // Same key as the vault page filtered to this client, so edits there refresh this list.
  const query = useQuery({
    queryKey: ['credentials', '', clientId],
    queryFn: async () => {
      const res = await api.getCredentials({ clientId });
      return Array.isArray(res) ? res : (res?.credentials ?? []);
    },
  });
  // Keep only what this list shows.
  const logins = (query.data || []).map(({ id, label, category, url, project, updatedAt }) => ({ id, label, category, url, project, updatedAt }));
  const vaultLink = `/credentials?clientId=${encodeURIComponent(clientId)}`;

  return (
    <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-logins-heading">
      <div className={panelHeaderClass}>
        <h2 id="client-logins-heading" className={panelTitleClass}>Logins</h2>
        <Link to={vaultLink} className={panelLinkClass}>Open in the vault <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </div>
      <p className="px-5 pb-3 text-sm text-muted-foreground">Passwords stay in the vault. Open it to view or copy one; you may be asked to confirm it&apos;s you.</p>
      {query.isLoading ? (
        <p role="status" className={emptyClass}>Loading logins…</p>
      ) : query.isError ? (
        <div className="px-5 pb-4">
          <QueryErrorState error={query.error} message="Logins could not be loaded" onRetry={() => query.refetch()} isRetrying={query.isFetching} />
        </div>
      ) : logins.length === 0 ? (
        <p className={emptyClass}>No logins saved for this client.</p>
      ) : (
        <ul className="px-5 pb-3">
          {logins.map((login) => {
            const href = safeHref(login.url);
            return (
              <li key={login.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 py-3 first:border-t-0">
                <div className="min-w-0 flex-[1_1_240px]">
                  <p className="font-medium text-foreground break-words">{login.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {[CATEGORY_LABELS[login.category] || login.category, login.project?.name, login.updatedAt ? `updated ${formatDate(login.updatedAt)}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring break-all"
                  >
                    {new URL(href).host}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
