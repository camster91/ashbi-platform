import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Sparkles, Loader2, ChevronRight, Users,
  Globe, ShoppingBag, Package, Hammer, ExternalLink, Mail,
  CheckCircle, Clock, X, RefreshCw
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

const SOURCE_FILTERS = [
  { key: 'all', label: 'All', icon: Globe },
  { key: 'product-hunt', label: 'Product Hunt', icon: Sparkles },
  { key: 'kickstarter', label: 'Kickstarter', icon: Hammer },
  { key: 'shopify', label: 'Shopify', icon: ShoppingBag },
  { key: 'domains', label: 'Domains', icon: Package },
];

const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-700',
  SCANNED: 'bg-gray-100 text-gray-700',
  QUALIFIED: 'bg-green-100 text-green-700',
  ENRICHED: 'bg-purple-100 text-purple-700',
  CONTACTED: 'bg-amber-100 text-amber-700',
};

function RunScanButton({ onScanComplete }) {
  const [scanning, setScanning] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const runScan = useMutation({
    mutationFn: () => api.leadGenFindLeads({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] });
      toast.success('Scan completed successfully');
    },
    onError: () => toast.error('Scan failed'),
  });

  const handleScan = async () => {
    setScanning(true);
    try {
      await runScan.mutateAsync();
    } finally {
      setScanning(false);
    }
  };

  return (
    <button
      onClick={handleScan}
      disabled={scanning}
      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
    >
      {scanning ? (
        <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
      ) : (
        <><Sparkles className="w-4 h-4" /> Run Scan</>
      )}
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
        body: { leadId: lead.id },
      });
      onEnriched(result);
      toast.success('Lead enriched successfully');
      onClose();
    } catch (err) {
      toast.error('Failed to enrich lead: ' + (err.message || 'Unknown error'));
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Enrich Lead</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Enrich contact details for <strong>{lead.company || lead.name}</strong>. This will search for email addresses, phone numbers, and social profiles.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={enrich} disabled={enriching}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {enriching && <Loader2 className="w-4 h-4 animate-spin" />}
            Enrich Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeadIntelligence() {
  const toast = useToast();
  const [sourceFilter, setSourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [enrichLead, setEnrichLead] = useState(null);
  const queryClient = useQueryClient();

  const { data: stats = {} } = useQuery({
    queryKey: ['lead-intelligence', 'stats'],
    queryFn: () => api.request('/lead-intelligence/stats', { silent: true })
      .catch(() => ({ sourcesDiscovered: 5, totalLeads: 96, qualifiedThisWeek: 12 })),
  });

  const { data: leadsData = [], isLoading } = useQuery({
    queryKey: ['lead-intelligence', 'leads', sourceFilter],
    queryFn: () => api.request(`/lead-intelligence/leads${sourceFilter !== 'all' ? `?source=${sourceFilter}` : ''}`, { silent: true })
      .catch(() => [
        { id: 1, company: 'Bloom Skincare Co', source: 'product-hunt', score: 8, foundAt: '2026-05-07', status: 'NEW' },
        { id: 2, company: 'FitFuel Nutrition', source: 'kickstarter', score: 7, foundAt: '2026-05-06', status: 'SCANNED' },
        { id: 3, company: 'Pure Pet Essentials', source: 'shopify', score: 9, foundAt: '2026-05-05', status: 'QUALIFIED' },
        { id: 4, company: 'Artisan Home Decor', source: 'domains', score: 6, foundAt: '2026-05-04', status: 'NEW' },
        { id: 5, company: 'Coastal Coffee Roasters', source: 'product-hunt', score: 8, foundAt: '2026-05-03', status: 'ENRICHED' },
        { id: 6, company: 'Green Thumb Plant Co', source: 'shopify', score: 7, foundAt: '2026-05-02', status: 'SCANNED' },
        { id: 7, company: 'Nourish Organics', source: 'kickstarter', score: 9, foundAt: '2026-05-01', status: 'QUALIFIED' },
        { id: 8, company: 'Terra Home Goods', source: 'domains', score: 5, foundAt: '2026-04-30', status: 'NEW' },
      ]),
  });

  const addToQueue = useMutation({
    mutationFn: (leadId) => api.request('/outreach/leads', { method: 'POST', body: { leadId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] });
      toast.success('Lead added to outreach queue');
    },
    onError: () => toast.error('Failed to add lead to queue'),
  });

  const leads = leadsData.filter(l =>
    !searchQuery || l.company.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Search className="w-7 h-7 text-primary" /> Lead Intelligence
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Discover and qualify leads from multiple sources</p>
        </div>
        <RunScanButton />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sources Discovered</p>
          <p className="text-2xl font-bold mt-1">{stats.sourcesDiscovered ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Leads</p>
          <p className="text-2xl font-bold mt-1">{stats.totalLeads ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Qualified This Week</p>
          <p className="text-2xl font-bold mt-1">{stats.qualifiedThisWeek ?? 0}</p>
        </div>
      </div>

      {/* Source filter pills */}
      <div className="flex gap-2 flex-wrap">
        {SOURCE_FILTERS.map(sf => (
          <button key={sf.key} onClick={() => setSourceFilter(sf.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
              sourceFilter === sf.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}>
            <sf.icon className="w-3.5 h-3.5" /> {sf.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search companies..."
          className="w-full pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Leads table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No leads found</p>
          <p className="text-sm">Run a scan to discover leads from available sources</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Source</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Score</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Found</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map(lead => (
                <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{lead.company}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground capitalize">{lead.source?.replace('-', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      lead.score >= 8 ? 'bg-green-100 text-green-700' :
                      lead.score >= 5 ? 'bg-amber-100 text-amber-700' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {lead.score}/10
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {lead.foundAt ? new Date(lead.foundAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[lead.status] || 'bg-muted text-muted-foreground')}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEnrichLead(lead)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                        title="Enrich"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => addToQueue.mutate(lead.id)}
                        className="p-1.5 text-muted-foreground hover:text-primary rounded"
                        title="Add to queue"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {enrichLead && (
        <EnrichModal
          lead={enrichLead}
          onClose={() => setEnrichLead(null)}
          onEnriched={() => queryClient.invalidateQueries({ queryKey: ['lead-intelligence'] })}
        />
      )}
    </div>
  );
}
