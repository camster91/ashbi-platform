import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Sparkles, Loader2, ChevronRight, Users,
  Globe, ShoppingBag, Package, Hammer, ExternalLink, Mail,
  CheckCircle, Clock, X, RefreshCw, Download, Send,
  TrendingUp, Database, Activity, BarChart3, Filter,
  ArrowUpDown, Heart, Zap
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

const SOURCE_FILTERS = [
  { key: 'all', label: 'All Sources', icon: Globe },
  { key: 'producthunt', label: 'Product Hunt', icon: Sparkles },
  { key: 'kickstarter', label: 'Kickstarter', icon: Hammer },
  { key: 'shopify', label: 'Shopify', icon: ShoppingBag },
  { key: 'domain_registration', label: 'Domains', icon: Package },
  { key: 'crunchbase', label: 'Crunchbase', icon: Database },
  { key: 'clutch', label: 'Clutch', icon: TrendingUp },
  { key: 'g2', label: 'G2', icon: BarChart3 },
  { key: 'builtin', label: 'BuiltIn', icon: Activity },
  { key: 'ycombinator', label: 'Y Combinator', icon: Zap },
];

const SCORE_FILTERS = [
  { key: 'all', label: 'All Scores' },
  { key: '8', label: '8+ (Hot)' },
  { key: '6', label: '6+ (Warm)' },
  { key: '4', label: '4+ (Cold)' },
];

const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-700',
  SCANNED: 'bg-gray-100 text-gray-700',
  QUALIFIED: 'bg-green-100 text-green-700',
  ENRICHED: 'bg-purple-100 text-purple-700',
  CONTACTED: 'bg-amber-100 text-amber-700',
  REPLIED: 'bg-emerald-100 text-emerald-700',
  CONVERTED: 'bg-teal-100 text-teal-700',
};

function ScoreBadge({ score }) {
  const color = score >= 8 ? 'bg-green-100 text-green-700 border-green-200'
    : score >= 6 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : score >= 4 ? 'bg-orange-100 text-orange-700 border-orange-200'
    : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={cn('inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium border', color)}>
      {score >= 8 && <Heart className="w-2.5 h-2.5" />}
      {score}/10
    </span>
  );
}

function SourceIcon({ source }) {
  const iconMap = {
    producthunt: Sparkles, kickstarter: Hammer, shopify: ShoppingBag,
    domain_registration: Package, crunchbase: Database, clutch: TrendingUp,
    g2: BarChart3, builtin: Activity, ycombinator: Zap
  };
  const Icon = iconMap[source] || Globe;
  return <Icon className="w-3 h-3" />;
}

function RunScanButton({ onScanComplete }) {
  const [scanning, setScanning] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const runScan = useMutation({
    mutationFn: () => api.request('/lead-intelligence/run', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] });
      toast.success(`Scan complete — ${data?.results?.discovered || 0} leads found`);
      onScanComplete?.();
    },
    onError: () => toast.error('Scan failed'),
  });

  const handleScan = async () => {
    setScanning(true);
    try { await runScan.mutateAsync(); } finally { setScanning(false); }
  };

  return (
    <button onClick={handleScan} disabled={scanning}
      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
      {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
        : <><Sparkles className="w-4 h-4" /> Run Full Scan</>}
    </button>
  );
}

function EnrichModal({ lead, onClose, onEnriched }) {
  const [enriching, setEnriching] = useState(false);
  const toast = useToast();

  const enrich = async () => {
    setEnriching(true);
    try {
      const result = await api.request('/lead-intelligence/enrich', {
        method: 'POST',
        body: { domain: lead.company || lead.domain, leadId: lead.id },
      });
      onEnriched(result);
      toast.success('Lead enriched successfully');
      onClose();
    } catch (err) {
      toast.error('Failed to enrich lead: ' + (err.message || 'Unknown error'));
    } finally { setEnriching(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Enrich Lead</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Enrich contact details for <strong>{lead.company || lead.name}</strong>. This will search for email addresses, phone numbers, social profiles, and technology stack.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={enrich} disabled={enriching}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {enriching && <Loader2 className="w-4 h-4 animate-spin" />} Enrich Now
          </button>
        </div>
      </div>
    </div>
  );
}

function exportLeadsCSV(leads) {
  const headers = ['Company', 'Source', 'Score', 'Status', 'Email', 'Industry', 'Found'];
  const rows = leads.map(l => [
    l.company || l.name || '', l.source || '', l.score || '', l.status || '',
    l.email || '', l.industry || '', l.foundAt || l.discoveredAt || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `lead-intelligence-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export default function LeadIntelligence() {
  const toast = useToast();
  const [sourceFilter, setSourceFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [enrichLead, setEnrichLead] = useState(null);
  const [showHealth, setShowHealth] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['lead-intelligence', 'stats'],
    queryFn: () => api.request('/lead-intelligence/stats', { silent: true })
      .catch(() => ({ totalDiscovered: 0, bySource: {}, conversion: { contactedRate: 0, convertedRate: 0 } })),
  });

  const { data: sourceHealth } = useQuery({
    queryKey: ['lead-intelligence', 'source-health'],
    queryFn: () => api.request('/lead-intelligence/source-health', { silent: true })
      .catch(() => ({ sources: [] })),
    enabled: showHealth,
  });

  const { data: leadsData = { leads: [] }, isLoading } = useQuery({
    queryKey: ['lead-intelligence', 'leads', sourceFilter, scoreFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (scoreFilter !== 'all') params.set('minScore', scoreFilter);
      params.set('limit', '100');
      const result = await api.request(`/lead-intelligence/leads?${params}`, { silent: true });
      return result || { leads: [] };
    },
  });

  const { data: sources = { sources: [] } } = useQuery({
    queryKey: ['lead-intelligence', 'sources'],
    queryFn: () => api.request('/lead-intelligence/sources', { silent: true })
      .catch(() => ({ sources: [] })),
  });

  const addBatchToSequence = useMutation({
    mutationFn: (leadIds) => api.request('/outreach/leads/batch', {
      method: 'POST', body: { leadIds: [...leadIds] }
    }).catch(() => {
      // Fallback: add individually
      return Promise.allSettled(
        [...leadIds].map(id => api.request('/outreach/leads', { method: 'POST', body: { leadId: id } }))
      );
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] });
      toast.success(`${selectedLeads.size} leads added to outreach queue`);
      setSelectedLeads(new Set());
    },
    onError: () => toast.error('Failed to add leads to queue'),
  });

  const leads = (leadsData.leads || []).filter(l =>
    !searchQuery || (l.company || l.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSelect = useCallback((id) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedLeads.size === leads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.map(l => l.id)));
    }
  }, [leads, selectedLeads.size]);

  const totalSources = sources.sources?.length || 9;
  const activeSources = sourceHealth?.sources?.filter(s => s.healthy).length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Search className="w-7 h-7 text-primary" /> Lead Intelligence
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Discover and qualify leads from {totalSources} sources — {activeSources} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedLeads.size > 0 && (
            <>
              <button onClick={() => exportLeadsCSV(leads.filter(l => selectedLeads.has(l.id)))}
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">
                <Download className="w-3.5 h-3.5" /> Export {selectedLeads.size}
              </button>
              <button onClick={() => addBatchToSequence.mutate(selectedLeads)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                <Send className="w-3.5 h-3.5" /> Add to Sequence
              </button>
            </>
          )}
          <RunScanButton />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Leads</p>
          <p className="text-2xl font-bold mt-1">{statsLoading ? '—' : (stats?.totalDiscovered ?? 0)}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Sources</p>
          <p className="text-2xl font-bold mt-1">{activeSources}/{totalSources}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact Rate</p>
          <p className="text-2xl font-bold mt-1">{stats?.conversion?.contactedRate ?? 0}%</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Converted</p>
          <p className="text-2xl font-bold mt-1">{stats?.conversion?.converted ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last 7 Days</p>
          <p className="text-2xl font-bold mt-1">{stats?.recentActivity?.last7Days ?? 0}</p>
        </div>
      </div>

      {/* Source health panel (collapsible) */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <button onClick={() => setShowHealth(!showHealth)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" /> Source Health
          </span>
          <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', showHealth && 'rotate-90')} />
        </button>
        {showHealth && (
          <div className="border-t border-border px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {(sourceHealth?.sources || sources?.sources || []).map(src => {
                const healthSrc = sourceHealth?.sources?.find(s => s.id === src.id) || {};
                const healthy = healthSrc.healthy ?? true;
                return (
                  <div key={src.id} className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-xs border',
                    healthy ? 'bg-green-50/50 border-green-200 text-green-800' : 'bg-muted/50 border-border text-muted-foreground'
                  )}>
                    <div className={cn('w-2 h-2 rounded-full', healthy ? 'bg-green-500' : 'bg-gray-400')} />
                    <span className="font-medium truncate">{src.name}</span>
                    {healthSrc.leads30d > 0 && <span className="ml-auto text-muted-foreground">{healthSrc.leads30d}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Source filter pills */}
        <div className="flex gap-1 flex-wrap">
          {SOURCE_FILTERS.map(sf => (
            <button key={sf.key} onClick={() => setSourceFilter(sf.key)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                sourceFilter === sf.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}>
              <sf.icon className="w-3 h-3" /> {sf.label}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-border" />
        {/* Score filter */}
        <div className="flex gap-1">
          {SCORE_FILTERS.map(sf => (
            <button key={sf.key} onClick={() => setScoreFilter(sf.key)}
              className={cn(
                'px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                scoreFilter === sf.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}>
              {sf.label}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-border" />
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search companies..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
      </div>

      {/* Leads table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No leads found</p>
          <p className="text-sm">Run a scan to discover leads from {totalSources} sources</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-3 font-medium text-muted-foreground w-8">
                  <input type="checkbox" checked={selectedLeads.size === leads.length && leads.length > 0}
                    onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-3 py-3 font-medium text-muted-foreground">Company</th>
                <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden md:table-cell">Source</th>
                <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden md:table-cell">Score</th>
                <th className="text-left px-3 py-3 font-medium text-muted-foreground hidden lg:table-cell">Found</th>
                <th className="text-left px-3 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map(lead => (
                <tr key={lead.id} className={cn(
                  'hover:bg-muted/30 transition-colors',
                  selectedLeads.has(lead.id) && 'bg-primary/5'
                )}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selectedLeads.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)} className="rounded" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{lead.company || lead.name}</div>
                    {lead.email && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{lead.email}</div>}
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground capitalize">
                      <SourceIcon source={lead.source} />
                      {lead.source?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {lead.foundAt ? new Date(lead.foundAt).toLocaleDateString('en-CA') : '—'}
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <ScoreBadge score={lead.score} />
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {lead.discoveredAt ? new Date(lead.discoveredAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[lead.status] || 'bg-muted text-muted-foreground')}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setEnrichLead(lead)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                        title="Enrich lead">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.request('/outreach/leads', { method: 'POST', body: { leadId: lead.id } });
                            toast.success('Lead added to outreach');
                          } catch { toast.error('Failed'); }
                        }}
                        className="p-1.5 text-muted-foreground hover:text-primary rounded"
                        title="Add to outreach queue">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length >= 100 && (
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground text-center">
              Showing 100 leads. Refine filters to see more.
            </div>
          )}
        </div>
      )}

      {/* By Source breakdown */}
      {stats?.bySource && Object.values(stats.bySource).some(v => v > 0) && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold mb-3">Leads by Source</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(stats.bySource)
              .filter(([, v]) => v > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([source, count]) => (
                <div key={source} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SourceIcon source={source} />
                    <span className="capitalize">{source.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min((count / (stats?.totalDiscovered || 1)) * 100, 100)}%` }} />
                    </div>
                    <span className="text-xs font-medium">{count}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {enrichLead && (
        <EnrichModal lead={enrichLead}
          onClose={() => setEnrichLead(null)}
          onEnriched={() => queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] })} />
      )}
    </div>
  );
}
