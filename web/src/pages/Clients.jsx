import { Fragment, useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building,
  FolderOpen,
  MessageSquare,
  ChevronRight,
  Plus,
  Heart,
  AlertTriangle,
  Loader2,
  Sparkles,
  X,
  UserPlus,
  Search,
  Mail,
  Phone,
  Clock,
  StickyNote,
  Send,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { formatDate } from '../lib/format';
import { useToast } from '../hooks/useToast';
import { normalizeClients } from '../hooks/useClients';
import { Button, Card, EmptyState, SlowNotice, TablePageSkeleton } from '../components/ui';
import CreateClientModal from '../components/CreateClientModal';
import QueryErrorState from '../components/QueryErrorState';

// One page of the client list. The server clamps `limit` (max 200) and
// returns `total`, so the page can say how many clients exist and load more.
export const CLIENTS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const TIER_HOURS = { '999': 20, '1999': 40, '3999': 80 };
const TIER_LABEL = { '999': '$999/mo · 20 hrs', '1999': '$1,999/mo · 40 hrs', '3999': '$3,999/mo · 80 hrs' };

function formatLastContact(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return formatDate(d);
}

function QuickNoteInput({ clientId, onSaved }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const saveNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.addClientNote(clientId, note);
      setNote('');
      toast.success('Note saved');
      onSaved?.();
    } catch (err) {
      toast.error('Failed to save note: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={saveNote} className="flex gap-1.5">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Quick note..."
        className="flex-1 px-2 py-1 text-xs bg-muted rounded border-0 focus:outline-none focus:ring-1 focus:ring-primary/30"
      />
      <button
        type="submit"
        disabled={saving || !note.trim()}
        aria-label="Save quick client note"
        className="min-h-11 min-w-11 inline-flex items-center justify-center px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      </button>
    </form>
  );
}

export default function Clients() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('create') === 'true');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedClient, setExpandedClient] = useState(null);
  const [onboardForm, setOnboardForm] = useState({
    name: '', email: '', contactName: '', retainerTier: '1999', notes: ''
  });
  const [onboardResult, setOnboardResult] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // The list page keeps its own key (under the shared ['clients'] root, so
  // client mutations still refresh it): it needs `total` and the server-side
  // search, which the picker hook (useClients) does not.
  const {
    data: clientPages,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['clients', 'list', { search: debouncedSearch }],
    queryFn: ({ pageParam }) => api.getClients({
      limit: String(CLIENTS_PAGE_SIZE),
      offset: String(pageParam),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + normalizeClients(page).length, 0);
      const total = typeof lastPage?.total === 'number' ? lastPage.total : loaded;
      return normalizeClients(lastPage).length > 0 && loaded < total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });
  const clients = clientPages?.pages?.flatMap((page) => normalizeClients(page)) ?? [];
  const lastPage = clientPages?.pages?.[clientPages.pages.length - 1];
  const totalClients = typeof lastPage?.total === 'number' ? lastPage.total : clients.length;

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['client-health'],
    queryFn: () => api.getClientHealth(),
    enabled: showHealth,
  });

  const onboardMutation = useMutation({
    mutationFn: (data) => api.onboardClient(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setOnboardResult(result);
      toast.success('Client onboarded', 'Portal and retainer set up successfully');
    },
    onError: () => toast.error('Onboarding failed'),
  });

  // Show real API data only. (Previously fell back to hardcoded demo clients
  // when the response looked empty, which — combined with the wrapper-unwrap
  // bug — meant real clients were never shown.)
  // Search runs on the server (name/domain, case-insensitive) across every
  // client, not only the loaded page.
  const displayClients = clients;

  // Sort the loaded rows: AT_RISK first, then by last contact date (oldest first)
  const sorted = [...displayClients].sort((a, b) => {
    const aRisk = a.health === 'AT_RISK' ? -1 : 0;
    const bRisk = b.health === 'AT_RISK' ? -1 : 0;
    if (aRisk !== bRisk) return aRisk - bRisk;
    const aDate = a.lastContactDate || a.updatedAt || '';
    const bDate = b.lastContactDate || b.updatedAt || '';
    return aDate.localeCompare(bDate);
  });

  if (isError) {
    return <QueryErrorState onRetry={refetch} error={error} isRetrying={isFetching} message="Failed to load clients" />;
  }

  if (isLoading) {
    return <TablePageSkeleton rows={8} showStats label="Loading clients" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {debouncedSearch ? `${totalClients} matching` : `${totalClients} total`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Toggle client health"
            onClick={() => { setShowHealth(!showHealth); if (!showHealth) refetchHealth(); }}
            className={cn(
              'min-h-11 inline-flex items-center px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showHealth
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <Heart className="w-4 h-4" />
            <span className="hidden sm:inline">Health</span>
          </button>
          <Button variant="outline" leftIcon={<Sparkles className="w-4 h-4" />} onClick={() => setShowOnboarding(true)}>
            <span className="hidden sm:inline">Onboard Client</span>
            <span className="sm:hidden">Onboard</span>
          </Button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreateModal(true)}>
            <span className="hidden sm:inline">Add Client</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </div>

      {/* Onboarding Wizard */}
      {showOnboarding && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Quick Client Onboarding</h2>
            </div>
            <button type="button" aria-label="Close client onboarding" onClick={() => { setShowOnboarding(false); setOnboardResult(null); }} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="w-5 h-5 text-muted-foreground hover:text-foreground" aria-hidden="true" />
            </button>
          </div>

          {onboardResult ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-success/5 border border-success/30 p-4">
                <h3 className="font-semibold text-success mb-2">Client onboarded!</h3>
                <ul className="text-sm text-success space-y-1">
                  <li>✓ Client created: {onboardResult.client?.name}</li>
                  <li>✓ Contact added: {onboardResult.contact?.name}</li>
                  <li>✓ Retainer plan set ({onboardResult.retainerPlan?.tier})</li>
                  <li>✓ Onboarding project created</li>
                  <li>✓ Welcome thread opened</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => navigate(`/client/${onboardResult.client.id}`)}>
                  View Client
                </Button>
                <Button variant="outline" onClick={() => { setOnboardResult(null); setOnboardForm({ name: '', email: '', contactName: '', retainerTier: '1999', notes: '' }); }}>
                  Onboard Another
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); onboardMutation.mutate(onboardForm); }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Company Name</label>
                  <input
                    type="text"
                    value={onboardForm.name}
                    onChange={(e) => setOnboardForm({ ...onboardForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    placeholder="Acme Foods Inc."
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={onboardForm.contactName}
                    onChange={(e) => setOnboardForm({ ...onboardForm, contactName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    placeholder="Jane Smith"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Email</label>
                  <input
                    type="email"
                    value={onboardForm.email}
                    onChange={(e) => setOnboardForm({ ...onboardForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    placeholder="jane@acmefoods.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Retainer Tier</label>
                  <select
                    value={onboardForm.retainerTier}
                    onChange={(e) => setOnboardForm({ ...onboardForm, retainerTier: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    required
                  >
                    {Object.entries(TIER_LABEL).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <textarea
                  value={onboardForm.notes}
                  onChange={(e) => setOnboardForm({ ...onboardForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  rows={2}
                  placeholder="Project context, goals, special requirements..."
                />
              </div>
              {onboardMutation.isError && (
                <p className="text-sm text-destructive">{onboardMutation.error?.message || 'Onboarding failed'}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={onboardMutation.isPending} slowAfterMs={false} leftIcon={<UserPlus className="w-4 h-4" />}>
                  Onboard Client
                </Button>
                <Button variant="ghost" type="button" onClick={() => setShowOnboarding(false)}>Cancel</Button>
              </div>
              <SlowNotice active={onboardMutation.isPending} kind="write" />
            </form>
          )}
        </Card>
      )}

      {/* Client Health Dashboard */}
      {showHealth && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-primary" />
              <h2 className="font-heading font-semibold text-foreground">Client Health</h2>
            </div>
            {healthLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {healthData?.clients?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {healthData.clients.map((client) => {
                const color = client.score >= 80 ? 'green' : client.score >= 50 ? 'yellow' : 'red';
                const classes = {
                  green: { border: 'border-success/30 bg-success/5', score: 'text-success' },
                  yellow: { border: 'border-warning/30 bg-warning/5', score: 'text-warning' },
                  red: { border: 'border-destructive/30 bg-destructive/5', score: 'text-destructive' },
                }[color];
                return (
                  <button
                    key={client.id}
                    type="button"
                    aria-label={`Open client health for ${client.name}`}
                    onClick={() => navigate(`/client/${client.id}`)}
                    className={cn('w-full min-h-11 p-3 rounded-lg border text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', classes.border)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-foreground truncate">{client.name}</span>
                      <span className={cn('text-lg font-bold', classes.score)}>{client.score}</span>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {client.daysSinceContact !== null && (
                        <div>Last contact: {client.daysSinceContact}d ago</div>
                      )}
                      <div>Open tasks: {client.openTasks}</div>
                      {client.overdueTasks > 0 && (
                        <div className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="w-3 h-3" />
                          {client.overdueTasks} overdue
                        </div>
                      )}
                      {client.retainerPct !== null && (
                        <div>Retainer: {client.retainerPct}% used</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !healthLoading ? (
            <p className="text-sm text-muted-foreground">No active clients found.</p>
          ) : null}
        </Card>
      )}

      <CreateClientModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        }}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients by name or domain..."
          aria-label="Search clients by name or domain"
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm"
        />
      </div>

      {/* Client List */}
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={search ? 'search' : 'team'}
            title={search ? 'No clients match your search' : 'No clients yet'}
            description={search
              ? `We couldn't find a client matching "${search}".`
              : 'Onboard a complete client with a retainer, or add one for a quick start.'}
            actionLabel={search ? 'Clear Search' : 'Add Client'}
            onAction={search ? () => setSearch('') : () => setShowCreateModal(true)}
          />
        </Card>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Contact</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Domain</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Projects</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Last Contact</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((client) => {
                const isExpanded = expandedClient === client.id;
                const primaryContact = client.contacts?.[0] || null;
                const primaryEmail = primaryContact?.email || null;
                const isAtRisk = client.health === 'AT_RISK';

                return (
                  <Fragment key={client.id}>
                    <tr className={cn(
                      'hover:bg-muted/30 transition-colors',
                      isAtRisk && 'bg-destructive/[0.02]'
                    )}>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} client ${client.name}`}
                          onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                          className="min-h-11 flex items-center gap-3 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                            isAtRisk
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-primary/10 text-primary'
                          )}>
                            {client.name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{client.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {primaryEmail ? (
                                <span className="flex items-center gap-0.5">
                                  <Mail className="w-3 h-3" />
                                  <span className="truncate max-w-[140px]">{primaryEmail}</span>
                                </span>
                              ) : client._count?.contacts > 0 ? (
                                <span>{client._count.contacts} contact{client._count.contacts !== 1 ? 's' : ''}</span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
                        {primaryContact ? (
                          <div className="min-w-0">
                            <p className="text-foreground truncate">{primaryContact.name}</p>
                            {primaryContact.phone ? (
                              <span className="flex items-center gap-0.5 text-xs">
                                <Phone className="w-3 h-3" aria-hidden="true" />{primaryContact.phone}
                              </span>
                            ) : primaryEmail ? (
                              <a href={`mailto:${primaryEmail}`} className="flex items-center gap-0.5 text-xs hover:text-foreground">
                                <Mail className="w-3 h-3" aria-hidden="true" />
                                <span className="truncate max-w-[180px]">{primaryEmail}</span>
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                        {client.domain || '—'}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <FolderOpen className="w-3 h-3" />
                          {client._count?.projects || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatLastContact(client.lastContactDate || client.updatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                          isAtRisk
                            ? 'bg-destructive/10 text-destructive'
                            : client.status === 'ACTIVE'
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {isAtRisk ? 'AT RISK' : client.status === 'ACTIVE' ? 'Active' : client.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/client/${client.id}`}
                          aria-label={`Open ${client.name}`}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className="w-5 h-5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>

                    {/* Expanded notes + quick-add row */}
                    {isExpanded && (
                      <tr key={`${client.id}-notes`} className="bg-muted/20">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-2">
                            {/* Existing notes */}
                            {client.notes && (
                              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                <StickyNote className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <p className="italic">{client.notes}</p>
                              </div>
                            )}

                            {/* Project list */}
                            {client.projects && client.projects.length > 0 && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <FolderOpen className="w-4 h-4 flex-shrink-0" />
                                <div className="flex flex-wrap gap-1.5">
                                  {client.projects.map((p) => (
                                    <Link
                                      key={p.id}
                                      to={`/project/${p.id}`}
                                      className="px-2 py-0.5 bg-muted rounded text-xs hover:bg-primary/10 hover:text-primary transition-colors"
                                    >
                                      {p.name} ({p.status})
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Quick note input */}
                            <QuickNoteInput
                              clientId={client.id}
                              onSaved={() => queryClient.invalidateQueries({ queryKey: ['clients'] })}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            Showing {displayClients.length} of {totalClients}
          </p>
          {hasNextPage && (
            <Button variant="outline" onClick={() => fetchNextPage()} loading={isFetchingNextPage} slowAfterMs={false}>
              Load more clients
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
