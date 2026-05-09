import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import {
  Linkedin, Sparkles, Loader2, X, Plus, Trash2, Edit3, Users,
  ChevronRight, Clock, Building, User, Copy, Check, Upload,
  Send, BarChart3, Activity, TrendingUp, AlertTriangle
} from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  NEW: 'bg-muted text-muted-foreground',
  CONNECTED: 'bg-green-100 text-green-700',
  IN_SEQUENCE: 'bg-blue-100 text-blue-700',
  REPLIED: 'bg-purple-100 text-purple-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-red-100 text-red-700',
};

const STATUS_BG = {
  NEW: 'bg-muted',
  CONNECTED: 'bg-green-50',
  IN_SEQUENCE: 'bg-blue-50',
  REPLIED: 'bg-purple-50',
  CONVERTED: 'bg-emerald-50',
};

function GenerateSequenceModal({ onClose, onGenerated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState('CPG/DTC');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !company.trim()) return;
    setLoading(true);
    try {
      await api.generateLinkedInSequence({ prospectName: name, prospectTitle: title, company, industry, linkedinUrl, notes });
      onGenerated();
      onClose();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Linkedin className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Generate Outreach Sequence</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Prospect Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Sarah Johnson"
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="VP Marketing"
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Company *</label>
              <input value={company} onChange={e => setCompany(e.target.value)} required placeholder="GlowUp Skincare"
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Industry</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="CPG/DTC">CPG/DTC</option>
                <option value="Shopify ecommerce">Shopify ecommerce</option>
                <option value="Food & Beverage">Food & Beverage</option>
                <option value="Health & Wellness">Health & Wellness</option>
                <option value="Beauty & Skincare">Beauty & Skincare</option>
                <option value="Supplements">Supplements</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">LinkedIn URL</label>
            <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything notable about this prospect..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating 3-Message Sequence...</> : <><Sparkles className="w-4 h-4" /> Generate Sequence</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function ImportProspectsModal({ onClose, onImported }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const importProspects = async () => {
    const lines = text.trim().split('\n').filter(Boolean);
    const prospects = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      return { name: parts[0], company: parts[1], title: parts[2], industry: parts[3], linkedinUrl: parts[4], email: parts[5] };
    }).filter(p => p.name);

    if (prospects.length === 0) { toast.error('No valid prospects found'); return; }

    setLoading(true);
    try {
      const result = await api.importLinkedInProspects({ prospects });
      toast.success(`Imported ${result.imported} prospects`);
      onImported();
      onClose();
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Upload className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Import Prospects</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">One prospect per line: Name, Company, Title, Industry, LinkedIn URL, Email</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
          placeholder="Sarah Johnson, GlowUp Skincare, VP Marketing, Beauty, https://linkedin.com/in/sarah, sarah@glowup.com"
          className="w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
        <button onClick={importProspects} disabled={loading || !text.trim()}
          className="w-full mt-3 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
        </button>
      </div>
    </div>
  );
}

function SequenceDetail({ seq, onClose, onSend }) {
  const [copied, setCopied] = useState('');
  const toast = useToast();

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSendConnection = async (prospectId) => {
    try {
      const result = await api.sendLinkedInConnection({ sequenceId: seq.id, prospectId });
      toast.success('Connection request tracked');
      onSend?.();
    } catch (err) {
      toast.error('Failed: ' + (err.data?.error || err.message));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{seq.prospectName}</h2>
            <p className="text-sm text-muted-foreground">{seq.prospectTitle} at {seq.company} — {seq.industry}</p>
          </div>
          <div className="flex items-center gap-2">
            {seq.status === 'DRAFT' && onSend && (
              <button onClick={() => handleSendConnection(seq.prospectId)}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                <Send className="w-4 h-4" /> Send Connection
              </button>
            )}
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="space-y-4">
          {[
            { label: 'Connection Request', text: seq.connectionMsg, timing: 'Send now' },
            { label: 'Follow-Up 1', text: seq.followUp1, timing: '3 days after connection' },
            { label: 'Follow-Up 2', text: seq.followUp2, timing: '7 days after connection' },
          ].map(msg => (
            <div key={msg.label} className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-sm font-medium">{msg.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{msg.timing}</span>
                </div>
                <button onClick={() => copy(msg.text, msg.label)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-card hover:bg-muted rounded transition-colors">
                  {copied === msg.label ? <><Check className="w-3 h-3 text-green-600" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
            </div>
          ))}
        </div>

        {seq.linkedinUrl && (
          <a href={seq.linkedinUrl} target="_blank" rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
            <Linkedin className="w-4 h-4" /> Open LinkedIn Profile
          </a>
        )}
      </div>
    </div>
  );
}

// ── Campaign Dashboard ────────────────────────────────────────────

function CampaignDashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['linkedin-stats'],
    queryFn: api.getLinkedInStats,
    refetchInterval: 30_000,
  });

  const { data: sequences = [] } = useQuery({
    queryKey: ['linkedin-sequences'],
    queryFn: api.getLinkedInSequences,
  });

  const { data: prospects = [] } = useQuery({
    queryKey: ['linkedin-prospects'],
    queryFn: () => api.getLinkedInProspects(),
  });

  const sendConnectionMut = useMutation({
    mutationFn: (data) => api.sendLinkedInConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-prospects'] });
      toast.success('Connection request sent');
    },
    onError: (err) => toast.error('Failed: ' + (err.data?.error || err.message)),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const ds = stats?.dailyUsage || {};
  const ps = stats?.prospects || {};
  const ss = stats?.sequences || {};

  const pByStatus = ps.byStatus || {};
  const sByStatus = ss.byStatus || {};

  const pipeline = [
    { label: 'NEW', count: pByStatus.NEW || 0, color: 'bg-muted' },
    { label: 'CONNECTED', count: pByStatus.CONNECTED || 0, color: 'bg-green-400' },
    { label: 'IN SEQUENCE', count: pByStatus.IN_SEQUENCE || 0, color: 'bg-blue-400' },
    { label: 'REPLIED', count: pByStatus.REPLIED || 0, color: 'bg-purple-400' },
    { label: 'CONVERTED', count: pByStatus.CONVERTED || 0, color: 'bg-emerald-400' },
  ];

  const draftedSeqs = sequences.filter(s => s.status === 'DRAFT');
  const activeSeqs = sequences.filter(s => s.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      {/* Daily Usage Meter */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Connections Today</span>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{ds.connectionsSent || 0}</span>
            <span className="text-sm text-muted-foreground">/ {ds.connectionLimit || 20}</span>
          </div>
          <div className="mt-2 w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', (ds.connectionsSent || 0) >= (ds.connectionLimit || 20) ? 'bg-red-500' : 'bg-green-500')}
              style={{ width: `${Math.min(100, ((ds.connectionsSent || 0) / (ds.connectionLimit || 20)) * 100)}%` }} />
          </div>
          {ds.connectionsRemaining === 0 && (
            <p className="mt-2 text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Limit reached</p>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Messages Today</span>
            <Send className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{ds.messagesSent || 0}</span>
            <span className="text-sm text-muted-foreground">/ {ds.messageLimit || 50}</span>
          </div>
          <div className="mt-2 w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', (ds.messagesSent || 0) >= (ds.messageLimit || 50) ? 'bg-red-500' : 'bg-amber-500')}
              style={{ width: `${Math.min(100, ((ds.messagesSent || 0) / (ds.messageLimit || 50)) * 100)}%` }} />
          </div>
        </div>
      </div>

      {/* Prospect Pipeline */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Prospect Pipeline
        </h3>
        <div className="flex gap-2">
          {pipeline.map(stage => (
            <div key={stage.label} className="flex-1 text-center">
              <div className="text-2xl font-bold">{stage.count}</div>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <div className={cn('w-2 h-2 rounded-full', stage.color)} />
                <span className="text-xs text-muted-foreground">{stage.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sequence Activation */}
      {draftedSeqs.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" /> Ready to Activate ({draftedSeqs.length})
          </h3>
          <div className="space-y-2">
            {draftedSeqs.slice(0, 5).map(seq => (
              <div key={seq.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-3">
                <div>
                  <span className="text-sm font-medium">{seq.prospectName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{seq.company}</span>
                </div>
                <button
                  onClick={() => sendConnectionMut.mutate({ sequenceId: seq.id, prospectId: seq.prospectId || seq.id })}
                  disabled={sendConnectionMut.isPending || (ds.connectionsSent || 0) >= (ds.connectionLimit || 20)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                  <Send className="w-3 h-3" /> Connect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Sequences */}
      {activeSeqs.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-600" /> Active Sequences ({activeSeqs.length})
          </h3>
          <div className="space-y-2">
            {activeSeqs.map(seq => (
              <div key={seq.id} className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3">
                <div>
                  <span className="text-sm font-medium">{seq.prospectName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{seq.company}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ACTIVE</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Prospects" value={ps.total || 0} />
        <StatCard label="Total Sequences" value={ss.total || 0} />
        <StatCard label="Converted" value={pByStatus.CONVERTED || 0} highlight />
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <div className={cn('bg-card rounded-xl border border-border p-4', highlight && 'border-emerald-200 bg-emerald-50/50')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', highlight && 'text-emerald-600')}>{value}</p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function LinkedInAgent() {
  const [activeTab, setActiveTab] = useState('sequences');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const queryClient = useQueryClient();

  const { data: sequences = [], isLoading: seqLoading } = useQuery({
    queryKey: ['linkedin-sequences'],
    queryFn: api.getLinkedInSequences,
  });

  const { data: prospects = [], isLoading: prospLoading } = useQuery({
    queryKey: ['linkedin-prospects'],
    queryFn: () => api.getLinkedInProspects(),
  });

  const deleteSeq = useMutation({
    mutationFn: api.deleteLinkedInSequence,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] }),
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
    queryClient.invalidateQueries({ queryKey: ['linkedin-prospects'] });
    queryClient.invalidateQueries({ queryKey: ['linkedin-stats'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Linkedin className="w-7 h-7 text-primary" /> LinkedIn Outreach Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate personalized connection sequences for CPG/DTC prospects</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'prospects' && (
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
              <Upload className="w-4 h-4" /> Import
            </button>
          )}
          <button onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <Sparkles className="w-4 h-4" /> New Sequence
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        <button onClick={() => setActiveTab('sequences')}
          className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center',
            activeTab === 'sequences' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          Sequences ({sequences.length})
        </button>
        <button onClick={() => setActiveTab('prospects')}
          className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center',
            activeTab === 'prospects' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          Prospects ({prospects.length})
        </button>
        <button onClick={() => setActiveTab('campaign')}
          className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center',
            activeTab === 'campaign' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          <BarChart3 className="w-4 h-4 inline mr-1" /> Campaign
        </button>
      </div>

      {/* Campaign Tab */}
      {activeTab === 'campaign' && <CampaignDashboard />}

      {/* Sequences Tab */}
      {activeTab === 'sequences' && (
        seqLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : sequences.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Linkedin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No sequences yet</p>
            <p className="text-sm">Generate your first outreach sequence</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sequences.map(seq => (
              <div key={seq.id} onClick={() => setSelectedSeq(seq)}
                className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">{seq.prospectName}</h3>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[seq.status])}>{seq.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {seq.prospectTitle && `${seq.prospectTitle} at `}{seq.company} — {seq.industry}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{seq.connectionMsg}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete?')) deleteSeq.mutate(seq.id); }}
                      className="p-2 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Prospects Tab */}
      {activeTab === 'prospects' && (
        prospLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : prospects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No prospects yet</p>
            <p className="text-sm">Import prospects or they'll be added from sequences</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Company</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.company || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.title || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[p.status] || 'bg-muted text-muted-foreground')}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showGenerate && <GenerateSequenceModal onClose={() => setShowGenerate(false)} onGenerated={refreshAll} />}
      {showImport && <ImportProspectsModal onClose={() => setShowImport(false)} onImported={refreshAll} />}
      {selectedSeq && <SequenceDetail seq={selectedSeq} onClose={() => setSelectedSeq(null)} onSend={refreshAll} />}
    </div>
  );
}
