import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { Button, Card } from '../components/ui';
import CreateClientModal from '../components/CreateClientModal';

const TIER_HOURS = { '999': 20, '1999': 40, '3999': 80 };
const TIER_LABEL = { '999': '$999/mo · 20 hrs', '1999': '$1,999/mo · 40 hrs', '3999': '$3,999/mo · 80 hrs' };

export default function Clients() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [search, setSearch] = useState('');
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

  const filtered = clients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.domain?.toLowerCase().includes(search.toLowerCase())
  );

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
          <p className="text-sm text-muted-foreground mt-1">{clients.length} total</p>
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
      {clients.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>
      )}

      {/* Client List */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Building className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">
            {search ? 'No clients match your search' : 'No clients yet'}
          </h3>
          {!search && (
            <p className="text-sm text-muted-foreground mt-1">
              Use "Onboard Client" to set up a complete client with retainer, or "Add Client" for a quick add.
            </p>
          )}
        </Card>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Domain</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Projects</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Threads</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((client) => (
                <tr key={client.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
                        {client.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{client.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {client._count?.contacts || 0} contact{(client._count?.contacts || 0) !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                    {client.domain || '—'}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <FolderOpen className="w-3 h-3" />
                      {client._count?.projects || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MessageSquare className="w-3 h-3" />
                      {client._count?.threads || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
                      client.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {client.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/client/${client.id}`} className="text-muted-foreground hover:text-primary">
                      <ChevronRight className="w-5 h-5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
