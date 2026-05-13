import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '../hooks/useToast';
import { Button, Card, EmptyClients } from '../components/ui';
import CreateClientModal from '../components/CreateClientModal';

const TIER_HOURS = { '999': 20, '1999': 40, '3999': 80 };
const TIER_LABEL = { '999': '$999/mo · 20 hrs', '1999': '$1,999/mo · 40 hrs', '3999': '$3,999/mo · 80 hrs' };

// Hardcoded Ashbi Design clients for Phase 1 (fallback when API returns empty)
const ASHBI_DESIGN_CLIENTS = [
  {
    id: 'ashbi-client-1', name: 'Morgan Campbell',
    domain: 'motomotus.com',
    contacts: [{ name: 'Morgan Campbell', email: 'morgan@motomotus.com', phone: null }],
    status: 'ACTIVE',
    _count: { projects: 1, threads: 12, contacts: 1 },
    lastContactDate: '2026-05-06',
    notes: 'Motomotus launched. Checking in monthly for maintenance.',
    projects: [{ id: 'ashbi-1', name: 'Motomotus', status: 'LAUNCHED' }],
    health: 'ON_TRACK',
  },
  {
    id: 'ashbi-client-2', name: 'Robin Linden',
    domain: 'rsclconsulting.com',
    contacts: [{ name: 'Robin Linden', email: 'robin@rsclconsulting.com', phone: null }],
    status: 'ACTIVE',
    _count: { projects: 1, threads: 8, contacts: 1 },
    lastContactDate: '2026-05-07',
    notes: 'Active markups in progress. Robin wants mobile-first approach. Likes lots of revisions.',
    projects: [{ id: 'ashbi-3', name: 'RSCSL Website', status: 'ACTIVE' }],
    health: 'ON_TRACK',
  },
  {
    id: 'ashbi-client-3', name: 'Sima Qadeer Goss',
    domain: null,
    contacts: [{ name: 'Sima Qadeer Goss', email: null, phone: null }],
    status: 'LEAD',
    _count: { projects: 0, threads: 2, contacts: 1 },
    lastContactDate: '2026-05-01',
    notes: 'Next steps pending. Initial conversation happened but no project scope defined yet.',
    projects: [],
    health: 'AT_RISK',
  },
  {
    id: 'ashbi-client-4', name: 'Alexander H. (Upwork)',
    domain: null,
    contacts: [{ name: 'Alexander H.', email: null, phone: null }],
    status: 'LEAD',
    _count: { projects: 0, threads: 3, contacts: 1 },
    lastContactDate: '2026-05-06',
    notes: 'Upwork client. Last message May 6 — needs response.',
    projects: [],
    health: 'AT_RISK',
  },
  {
    id: 'ashbi-client-5', name: 'Constantin M. (Upwork)',
    domain: null,
    contacts: [{ name: 'Constantin M.', email: null, phone: null }],
    status: 'LEAD',
    _count: { projects: 0, threads: 3, contacts: 1 },
    lastContactDate: '2026-05-07',
    notes: 'Upwork client. Sent 2 messages on May 7 — needs urgent response.',
    projects: [],
    health: 'AT_RISK',
  },
  {
    id: 'ashbi-client-6', name: 'David N. (Upwork)',
    domain: null,
    contacts: [{ name: 'David N.', email: null, phone: null }],
    status: 'LEAD',
    _count: { projects: 0, threads: 2, contacts: 1 },
    lastContactDate: '2026-05-07',
    notes: 'Upwork client. Last message May 7.',
    projects: [],
    health: 'AT_RISK',
  },
];

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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
        className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
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
  const [expandedClient, setExpandedClient] = useState(null);
  const [onboardForm, setOnboardForm] = useState({
    name: '', email: '', contactName: '', retainerTier: '1999', notes: ''
  });
  const [onboardResult, setOnboardResult] = useState(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

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

  // Use API data if available, otherwise fall back to hardcoded Ashbi Design clients
  const displayClients = (clients && clients.length > 0) ? clients : ASHBI_DESIGN_CLIENTS;

  const filtered = displayClients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.domain?.toLowerCase().includes(search.toLowerCase())
  );

  // Sort: AT_RISK first, then by last contact date (oldest first)
  const sorted = [...filtered].sort((a, b) => {
    const aRisk = a.health === 'AT_RISK' ? -1 : 0;
    const bRisk = b.health === 'AT_RISK' ? -1 : 0;
    if (aRisk !== bRisk) return aRisk - bRisk;
    const aDate = a.lastContactDate || a.updatedAt || '';
    const bDate = b.lastContactDate || b.updatedAt || '';
    return aDate.localeCompare(bDate);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">{displayClients.length} total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowHealth(!showHealth); if (!showHealth) refetchHealth(); }}
            className={cn(
              'px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors',
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
            <button onClick={() => { setShowOnboarding(false); setOnboardResult(null); }}>
              <X className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          {onboardResult ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
                <h3 className="font-semibold text-green-800 dark:text-green-300 mb-2">Client onboarded!</h3>
                <ul className="text-sm text-green-700 dark:text-green-400 space-y-1">
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
                <Button type="submit" loading={onboardMutation.isPending} leftIcon={<UserPlus className="w-4 h-4" />}>
                  Onboard Client
                </Button>
                <Button variant="ghost" type="button" onClick={() => setShowOnboarding(false)}>Cancel</Button>
              </div>
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
                  green: { border: 'border-green-500/30 bg-green-50 dark:bg-green-950/20', score: 'text-green-700 dark:text-green-400' },
                  yellow: { border: 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20', score: 'text-yellow-700 dark:text-yellow-400' },
                  red: { border: 'border-red-500/30 bg-red-50 dark:bg-red-950/20', score: 'text-red-700 dark:text-red-400' },
                }[color];
                return (
                  <button
                    key={client.id}
                    onClick={() => navigate(`/client/${client.id}`)}
                    className={cn('p-3 rounded-lg border text-left transition-all hover:shadow-md', classes.border)}
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
                        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
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
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm"
        />
      </div>

      {/* Client List */}
      {sorted.length === 0 ? (
        search ? (
          <Card className="p-12 text-center">
            <Building className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">No clients match your search</h3>
          </Card>
        ) : (
          <EmptyClients onAddClient={() => document.getElementById('add-client-btn')?.click()} />
        )
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
                const primaryEmail = client.contacts?.[0]?.email || (client._count?.contacts > 0 ? null : null);
                const isAtRisk = client.health === 'AT_RISK';

                return (
                  <>
                    <tr key={client.id} className={cn(
                      'hover:bg-muted/30 transition-colors',
                      isAtRisk && 'bg-red-50/30 dark:bg-red-950/10'
                    )}>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                          className="flex items-center gap-3 text-left w-full"
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                            isAtRisk
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
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
                        {client.contacts?.[0]?.phone ? (
                          <span className="flex items-center gap-0.5">
                            <Phone className="w-3 h-3" />{client.contacts[0].phone}
                          </span>
                        ) : primaryEmail ? (
                          <span className="flex items-center gap-0.5">
                            <Mail className="w-3 h-3" />{primaryEmail}
                          </span>
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
                          {formatDate(client.lastContactDate || client.updatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                          isAtRisk
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : client.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {isAtRisk ? 'AT RISK' : client.status === 'ACTIVE' ? 'Active' : client.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/client/${client.id}`} className="text-muted-foreground hover:text-primary">
                          <ChevronRight className="w-5 h-5" />
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
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
