import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Users, Plus, Search, Play, Pause, Mail, Sparkles, ChevronRight,
  Building2, Tag, Calendar, MoreHorizontal, X, Loader2, Send
} from 'lucide-react';

const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-yellow-100 text-yellow-700',
  REPLIED: 'bg-green-100 text-green-700',
  CONVERTED: 'bg-purple-100 text-purple-700',
  DEAD: 'bg-muted text-muted-foreground',
};

const SEQUENCE_STATUS_COLORS = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
};

function AddLeadModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', title: '', industry: '', linkedinUrl: '', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const lead = await api.addOutreachLead(form);
      onAdded(lead);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to add lead');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Lead</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Company</label>
              <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Industry</label>
              <input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">LinkedIn URL</label>
            <input value={form.linkedinUrl} onChange={e => setForm(f => ({ ...f, linkedinUrl: e.target.value }))}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Add Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GenerateEmailModal({ lead, onClose }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await api.generateOutreachEmail({ leadId: lead.id });
      setEmail(result.email);
    } catch (err) {
      setEmail('Failed to generate email: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Generate Outreach Email</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Generating personalized email for <strong>{lead.name}</strong> at <strong>{lead.company || 'their company'}</strong>
        </p>
        {!email && (
          <button onClick={generate} disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate with Gemini</>}
          </button>
        )}
        {email && (
          <div className="space-y-3">
            <textarea value={email} onChange={e => setEmail(e.target.value)} rows={8}
              className="w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
            <div className="flex gap-2">
              <button onClick={copy}
                className="flex-1 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors">
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
              <button onClick={generate} disabled={loading}
                className="py-2 px-3 text-sm text-muted-foreground hover:text-foreground">
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateSequenceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', targetIndustry: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const seq = await api.createOutreachSequence({
        ...form,
        steps: [{ subject: 'Quick note from Ashbi Design', body: 'Hi {{name}},\n\nI came across your brand and loved what you\'re building. Ashbi Design helps CPG/DTC brands like yours with fast-turnaround branding, packaging, and Shopify development.\n\nWould you be open to a 15-min call this week?\n\nCameron Ashley\nAshbi Design', delayDays: 0 }]
      });
      onCreated(seq);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Sequence</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Sequence Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
              placeholder="e.g. Supplement Brands Q1"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Target Industry</label>
            <input value={form.targetIndustry} onChange={e => setForm(f => ({ ...f, targetIndustry: e.target.value }))}
              placeholder="e.g. Supplements, Skincare, Food & Bev"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Sequence
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Outreach() {
  const [tab, setTab] = useState('leads');
  const [showAddLead, setShowAddLead] = useState(false);
  const [showCreateSequence, setShowCreateSequence] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ['outreach-leads', statusFilter],
    queryFn: () => api.getOutreachLeads(statusFilter ? { status: statusFilter } : {}),
  });

  const { data: sequences = [], isLoading: seqLoading } = useQuery({
    queryKey: ['outreach-sequences'],
    queryFn: api.getOutreachSequences,
  });

  const toggleSequence = useMutation({
    mutationFn: ({ id, status }) => api.updateOutreachSequence(id, { status }),
    onSuccess: () => queryClient.invalidateQueries(['outreach-sequences']),
  });

  const runSequence = useMutation({
    mutationFn: (id) => api.runOutreachSequence(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['outreach-leads']);
      alert(`Sequence run complete: ${data.sent} emails sent, ${data.failed} failed.`);
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Users className="w-7 h-7 text-primary" /> Outreach Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage leads and automated outreach sequences</p>
        </div>
        <div className="flex gap-2">
          {tab === 'leads' && (
            <button onClick={() => setShowAddLead(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Plus className="w-4 h-4" /> Add Lead
            </button>
          )}
          {tab === 'sequences' && (
            <button onClick={() => setShowCreateSequence(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Plus className="w-4 h-4" /> New Sequence
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {['leads', 'sequences'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium capitalize transition-colors',
              tab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            )}>
            {t} {t === 'leads' ? `(${leads.length})` : `(${sequences.length})`}
          </button>
        ))}
      </div>

      {/* Leads Tab */}
      {tab === 'leads' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex gap-2 flex-wrap">
            {['', 'NEW', 'CONTACTED', 'REPLIED', 'CONVERTED', 'DEAD'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1 text-xs rounded-full transition-colors',
                  statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}>
                {s || 'All'}
              </button>
            ))}
          </div>

          {leadsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : leads.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No leads yet</p>
              <p className="text-sm">Add your first lead to get started</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Company</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Last Contact</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map(lead => (
                    <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{lead.name}</div>
                        <div className="text-xs text-muted-foreground">{lead.email}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{lead.company || '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{lead.title || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[lead.status] || 'bg-muted text-muted-foreground')}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                        {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelectedLead(lead)}
                          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium">
                          <Sparkles className="w-3.5 h-3.5" /> Email
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sequences Tab */}
      {tab === 'sequences' && (
        <div>
          {seqLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : sequences.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No sequences yet</p>
              <p className="text-sm">Create a sequence to automate your outreach</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sequences.map(seq => {
                const steps = (() => { try { return JSON.parse(seq.steps || '[]'); } catch { return []; } })();
                return (
                  <div key={seq.id} className="bg-card rounded-xl border border-border p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">{seq.name}</h3>
                        {seq.targetIndustry && (
                          <p className="text-xs text-muted-foreground mt-0.5">{seq.targetIndustry}</p>
                        )}
                      </div>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', SEQUENCE_STATUS_COLORS[seq.status])}>
                        {seq.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
                      <span>{seq._count?.leads || 0} lead{(seq._count?.leads || 0) !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleSequence.mutate({ id: seq.id, status: seq.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
                        className="flex items-center gap-1.5 flex-1 justify-center py-2 text-xs font-medium bg-muted hover:bg-muted/80 rounded-lg transition-colors">
                        {seq.status === 'ACTIVE' ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Resume</>}
                      </button>
                      <button
                        onClick={() => runSequence.mutate(seq.id)}
                        disabled={seq.status !== 'ACTIVE' || runSequence.isPending}
                        className="flex items-center gap-1.5 flex-1 justify-center py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                        {runSequence.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Run Next Step
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAddLead && (
        <AddLeadModal
          onClose={() => setShowAddLead(false)}
          onAdded={() => queryClient.invalidateQueries(['outreach-leads'])}
        />
      )}
      {showCreateSequence && (
        <CreateSequenceModal
          onClose={() => setShowCreateSequence(false)}
          onCreated={() => queryClient.invalidateQueries(['outreach-sequences'])}
        />
      )}
      {selectedLead && (
        <GenerateEmailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </div>
  );
}
