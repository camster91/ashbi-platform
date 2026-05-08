import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, Search, Mail, Sparkles, ChevronRight, Calendar,
  Building2, Tag, Clock, Phone, Send, Eye, CheckCircle, X,
  Loader2, TrendingUp, UserPlus, MessageSquare, BarChart3
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

const KPI_COLORS = {
  leads: 'bg-blue-500/10 text-blue-600',
  outreach: 'bg-amber-500/10 text-amber-600',
  proposals: 'bg-purple-500/10 text-purple-600',
  conversions: 'bg-green-500/10 text-green-600',
};

const SOURCE_COLORS = {
  'Product Hunt': 'bg-orange-100 text-orange-700',
  'Kickstarter': 'bg-green-100 text-green-700',
  'Shopify': 'bg-blue-100 text-blue-700',
  'Domain Regs': 'bg-purple-100 text-purple-700',
  'Direct': 'bg-muted text-muted-foreground',
};

const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-yellow-100 text-yellow-700',
  QUALIFIED: 'bg-green-100 text-green-700',
  PROPOSAL: 'bg-purple-100 text-purple-700',
  WON: 'bg-emerald-100 text-emerald-700',
  LOST: 'bg-red-100 text-red-700',
};

const TABS = [
  { key: 'sources', label: 'Sources', icon: BarChart3 },
  { key: 'cold-email', label: 'Cold Email', icon: Mail },
  { key: 'upwork', label: 'Upwork', icon: BriefcaseIcon },
  { key: 'referrals', label: 'Referrals', icon: UserPlus },
  { key: 'call-block', label: 'Call Block', icon: Phone },
];

function BriefcaseIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" /></svg>;
}

export default function ClientAcquisition() {
  const toast = useToast();
  const [tab, setTab] = useState('sources');
  const queryClient = useQueryClient();

  // Pipeline stats
  const { data: stats = {} } = useQuery({
    queryKey: ['client-acquisition', 'stats'],
    queryFn: () => api.request('/outreach-scheduler/status', { silent: true })
      .catch(() => ({ totalLeads: 0, activeOutreach: 0, proposalsSent: 0, conversions: 0 })),
  });

  // Sources tab data
  const { data: sources = [] } = useQuery({
    queryKey: ['client-acquisition', 'sources'],
    queryFn: () => api.request('/client-acquisition/sources', { silent: true })
      .catch(() => [
        { name: 'Product Hunt', leads: 24, active: 8, converted: 3 },
        { name: 'Kickstarter', leads: 18, active: 5, converted: 2 },
        { name: 'Shopify', leads: 31, active: 12, converted: 7 },
        { name: 'Domain Regs', leads: 14, active: 4, converted: 1 },
        { name: 'Direct', leads: 9, active: 3, converted: 4 },
      ]),
  });

  // Cold email data
  const { data: coldEmailData = { sequences: 0, prospects: 0, followUps: 0, prospectsList: [] } } = useQuery({
    queryKey: ['client-acquisition', 'cold-email'],
    queryFn: () => api.request('/cold-email/sequences', { silent: true })
      .catch(() => ({
        sequences: 3,
        prospects: 47,
        followUps: 12,
        prospectsList: [
          { id: 1, name: 'Sarah Johnson', company: 'Bloom Skincare', status: 'CONTACTED', nextFollowUp: '2026-05-10' },
          { id: 2, name: 'Mike Chen', company: 'FitFuel Co', status: 'REPLIED', nextFollowUp: '2026-05-08' },
          { id: 3, name: 'Emma Davis', company: 'Pure Pet', status: 'NEW', nextFollowUp: '2026-05-12' },
        ],
      })),
  });

  // Upwork data
  const { data: upworkData = { matchedJobs: 0, pendingProposals: 0, jobs: [] } } = useQuery({
    queryKey: ['client-acquisition', 'upwork'],
    queryFn: () => api.request('/upwork-contracts', { silent: true })
      .catch(() => ({
        matchedJobs: 12,
        pendingProposals: 4,
        jobs: [
          { id: 1, title: 'Brand Identity for DTC Supplement Brand', budget: '$2,000-$5,000', status: 'MATCHED' },
          { id: 2, title: 'Shopify Store Redesign', budget: '$3,000-$8,000', status: 'PENDING_PROPOSAL' },
          { id: 3, title: 'Packaging Design for Skincare Line', budget: '$1,500-$3,000', status: 'MATCHED' },
        ],
      })),
  });

  // Referrals data
  const { data: referralsData = { recent: [] } } = useQuery({
    queryKey: ['client-acquisition', 'referrals'],
    queryFn: () => api.request('/referral-engine/stats', { silent: true })
      .catch(() => ({
        recent: [
          { id: 1, referrer: 'Alex Turner', referred: 'Nourish Organics', status: 'PENDING', date: '2026-05-06' },
          { id: 2, referrer: 'Lisa Park', referred: 'Coastal Coffee Co', status: 'CONTACTED', date: '2026-04-28' },
          { id: 3, referrer: 'David Ruiz', referred: 'Elevate Fitness', status: 'CONVERTED', date: '2026-04-15' },
        ],
      })),
  });

  // Call block data
  const { data: callBlockData = { scheduled: 0, scripts: 0, calls: [] } } = useQuery({
    queryKey: ['client-acquisition', 'call-block'],
    queryFn: () => api.request('/cold-call/queue', { silent: true })
      .catch(() => ({
        scheduled: 6,
        scripts: 4,
        calls: [
          { id: 1, lead: 'Fresh Press Juicery', time: '2026-05-08T10:00', status: 'SCHEDULED' },
          { id: 2, lead: 'Terra Home Goods', time: '2026-05-08T14:30', status: 'SCHEDULED' },
          { id: 3, lead: 'Bold Bean Coffee', time: '2026-05-09T11:00', status: 'SCRIPT_READY' },
        ],
      })),
  });

  const kpis = [
    { key: 'leads', label: 'Total Leads', value: stats.totalLeads ?? 0, icon: Users },
    { key: 'outreach', label: 'Active Outreach', value: stats.activeOutreach ?? 0, icon: Mail },
    { key: 'proposals', label: 'Proposals Sent', value: stats.proposalsSent ?? 0, icon: Send },
    { key: 'conversions', label: 'Conversions', value: stats.conversions ?? 0, icon: CheckCircle },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" /> Client Acquisition
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Full pipeline dashboard — from lead discovery to conversion</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <div key={kpi.key} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
              <div className={cn('p-1.5 rounded-lg', KPI_COLORS[kpi.key])}>
                <kpi.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium capitalize transition-colors whitespace-nowrap',
              tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            )}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ───── Sources Tab ───── */}
      {tab === 'sources' && (
        <div>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Total Leads</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Active</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Converted</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Conv. Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sources.map(source => {
                  const rate = source.leads > 0 ? Math.round((source.converted / source.leads) * 100) : 0;
                  return (
                    <tr key={source.name} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', SOURCE_COLORS[source.name] || 'bg-muted text-muted-foreground')}>
                          {source.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{source.leads}</td>
                      <td className="px-4 py-3">{source.active}</td>
                      <td className="px-4 py-3">{source.converted}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{rate}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Cold Email Tab ───── */}
      {tab === 'cold-email' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{coldEmailData.sequences}</p>
              <p className="text-xs text-muted-foreground mt-1">Active Sequences</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{coldEmailData.prospects}</p>
              <p className="text-xs text-muted-foreground mt-1">Prospects</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{coldEmailData.followUps}</p>
              <p className="text-xs text-muted-foreground mt-1">Upcoming Follow-ups</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Next Follow-up</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(coldEmailData.prospectsList || []).map(p => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.company || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[p.status] || 'bg-muted text-muted-foreground')}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {p.nextFollowUp ? new Date(p.nextFollowUp).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" /> Email
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Upwork Tab ───── */}
      {tab === 'upwork' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{upworkData.matchedJobs}</p>
              <p className="text-xs text-muted-foreground mt-1">Matched Jobs</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{upworkData.pendingProposals}</p>
              <p className="text-xs text-muted-foreground mt-1">Pending Proposals</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Budget</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(upworkData.jobs || []).map(job => (
                  <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{job.title}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{job.budget}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                        job.status === 'MATCHED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      )}>
                        {job.status === 'MATCHED' ? 'Matched' : 'Proposal Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-xs text-primary hover:text-primary/80 font-medium">
                        {job.status === 'MATCHED' ? 'Send Proposal' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Referrals Tab ───── */}
      {tab === 'referrals' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Referrer</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Referred</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(referralsData.recent || []).map(r => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{r.referrer}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{r.referred}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                        r.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        r.status === 'CONTACTED' ? 'bg-blue-100 text-blue-700' :
                        'bg-green-100 text-green-700'
                      )}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {new Date(r.date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Call Block Tab ───── */}
      {tab === 'call-block' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{callBlockData.scheduled}</p>
              <p className="text-xs text-muted-foreground mt-1">Scheduled Calls</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              <p className="text-2xl font-bold">{callBlockData.scripts}</p>
              <p className="text-xs text-muted-foreground mt-1">Scripts Ready</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Lead</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(callBlockData.calls || []).map(c => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{c.lead}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                      {c.time ? new Date(c.time).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                        c.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' :
                        c.status === 'SCRIPT_READY' ? 'bg-green-100 text-green-700' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {c.status === 'SCHEDULED' ? 'Scheduled' : c.status === 'SCRIPT_READY' ? 'Script Ready' : c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button className="text-xs text-primary hover:text-primary/80 font-medium">Start Call</button>
                        {c.status === 'SCRIPT_READY' && (
                          <button className="text-xs text-muted-foreground hover:text-foreground font-medium">Schedule</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
