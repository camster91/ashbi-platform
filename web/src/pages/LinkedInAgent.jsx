import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import {
  Linkedin, Sparkles, Loader2, X, Plus, Trash2, Edit3, Users,
  ChevronRight, Clock, Building, User, Copy, Check, Upload,
  Play, Pause, Send, BarChart3, Target, AlertCircle, CheckCircle2
} from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  FAILED: 'bg-red-100 text-red-700',
  NEW: 'bg-muted text-muted-foreground',
  CONNECTED: 'bg-green-100 text-green-700',
  IN_SEQUENCE: 'bg-blue-100 text-blue-700',
  REPLIED: 'bg-purple-100 text-purple-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-yellow-50 text-yellow-600',
  SENT: 'bg-green-50 text-green-600',
};

function CampaignModal({ onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxPerDay, setMaxPerDay] = useState(20);
  const [loading, setLoading] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.createLinkedInCampaign({ name, description, maxConnectionsPerDay: maxPerDay });
      onSaved();
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
          <div className="flex items-center gap-2"><Target className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">New Campaign</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Campaign Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Q2 CPG Outreach"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Targeting CPG brands for branding project..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Max Connections/Day</label>
            <input type="number" value={maxPerDay} onChange={e => setMaxPerDay(Number(e.target.value))} min={1} max={100}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create Campaign</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function GenerateSequenceModal({ campaigns, onClose, onGenerated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState('CPG/DTC');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !company.trim()) return;
    setLoading(true);
    try {
      await api.generateLinkedInSequence({ prospectName: name, prospectTitle: title, company, industry, linkedinUrl, notes, campaignId: campaignId || undefined });
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
                <option value="Food &amp; Beverage">Food &amp; Beverage</option>
                <option value="Health &amp; Wellness">Health &amp; Wellness</option>
                <option value="Beauty &amp; Skincare">Beauty &amp; Skincare</option>
                <option value="Supplements">Supplements</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          {campaigns.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Campaign (optional)</label>
              <select value={campaignId} onChange={e => setCampaignId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">No campaign</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">LinkedIn URL</label>
            <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything notable..."
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
        <p className="text-xs text-muted-foreground mb-3">One per line: Name, Company, Title, Industry, LinkedIn URL, Email</p>
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

function SequenceDetail({ seq, rateLimit, onClose, onSend }) {
  const [copied, setCopied] = useState('');
  const toast = useToast();

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const canSend = rateLimit && rateLimit.remaining > 0;
  const nextMsgType = seq.sentCount === 0 ? 'connection' : seq.sentCount === 1 ? 'followup1' : seq.sentCount === 2 ? 'followup2' : null;
  const nextTiming = seq.sentCount === 0 ? 'Send now' : seq.sentCount === 1 ? 'Day 3 (scheduled)' : seq.sentCount === 2 ? 'Day 7 (scheduled)' : 'Complete';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{seq.prospectName}</h2>
            <p className="text-sm text-muted-foreground">{seq.prospectTitle} at {seq.company} — {seq.industry}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[seq.status])}>{seq.status}</span>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Sequence steps */}
        <div className="space-y-3">
          {[
            { label: 'Step 1: Connection Request', text: seq.connectionMsg, step: 0, sent: seq.sentCount > 0 },
            { label: 'Step 2: Follow-Up (Day 3)', text: seq.followUp1, step: 1, sent: seq.sentCount > 1 },
            { label: 'Step 3: Follow-Up (Day 7)', text: seq.followUp2, step: 2, sent: seq.sentCount > 2 },
          ].map(msg => (
            <div key={msg.label} className={cn('rounded-lg p-4 border', msg.sent ? 'bg-green-50 border-green-200' : 'bg-muted/50 border-border')}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{msg.label}</span>
                  {msg.sent
                    ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3 h-3" /> Sent</span>
                    : <span className="text-xs text-muted-foreground">{msg.step === 0 ? 'Send now' : msg.step === 1 ? 'Day 3' : 'Day 7'}</span>
                  }
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

        {/* Actions */}
        <div className="flex items-center gap-3 mt-5">
          {nextMsgType && seq.status !== 'COMPLETED' && seq.status !== 'FAILED' && (
            <>
              {nextMsgType === 'connection' && seq.status === 'DRAFT' && (
                <button onClick={() => onSend(seq.id, 'connection')}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                  <Play className="w-4 h-4" /> Start Sequence
                </button>
              )}
              {(seq.status === 'ACTIVE' || seq.status === 'PAUSED') && (
                <button onClick={() => onSend(seq.id, nextMsgType)}
                  disabled={!canSend && seq.status === 'ACTIVE'}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Send {nextMsgType === 'connection' ? 'Connection' : nextMsgType === 'followup1' ? 'Follow-up 1' : 'Follow-up 2'}
                </button>
              )}
              {seq.status === 'PAUSED' && (
                <button onClick={() => onSend(seq.id, 'resume')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                  <Play className="w-4 h-4" /> Resume
                </button>
              )}
            </>
          )}
          {seq.status === 'ACTIVE' && (
            <button onClick={() => onSend(seq.id, 'pause')}
              className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
          {rateLimit && seq.status === 'ACTIVE' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {rateLimit.remaining}/{rateLimit.limit} connections left today
            </span>
          )}
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

function CampaignDashboard({ campaigns, sequences, onSelectCampaign }) {
  if (campaigns.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Target className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No campaigns yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {campaigns.map(c => {
        const seqs = sequences.filter(s => s.campaignId === c.id);
        const active = seqs.filter(s => s.status === 'ACTIVE').length;
        const completed = seqs.filter(s => s.status === 'COMPLETED').length;
        return (
          <div key={c.id} onClick={() => onSelectCampaign(c.id)}
            className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-sm">{c.name}</h3>
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[c.status])}>{c.status}</span>
            </div>
            {c.description && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{c.description}</p>}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/50 rounded-lg p-2">
                <div className="text-lg font-bold">{seqs.length}</div>
                <div className="text-xs text-muted-foreground">Sequences</div>
              </div>
              <div className="bg-green-50 rounded-lg p-2">
                <div className="text-lg font-bold text-green-700">{active}</div>
                <div className="text-xs text-green-600">Active</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2">
                <div className="text-lg font-bold text-blue-700">{completed}</div>
                <div className="text-xs text-blue-600">Done</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="w-3 h-3" /> Max {c.maxConnectionsPerDay}/day
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LinkedInAgent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: sequences = [], isLoading: seqLoading } = useQuery({
    queryKey: ['linkedin-sequences'],
    queryFn: () => api.getLinkedInSequences(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
  });

  const { data: prospects = [], isLoading: prospLoading } = useQuery({
    queryKey: ['linkedin-prospects'],
    queryFn: () => api.getLinkedInProspects(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
  });

  const { data: campaigns = [], isLoading: campLoading } = useQuery({
    queryKey: ['linkedin-campaigns'],
    queryFn: api.getLinkedInCampaigns,
  });

  const { data: rateLimit } = useQuery({
    queryKey: ['linkedin-rate-limit'],
    queryFn: () => api.getLinkedInRateLimit(selectedCampaignId || undefined),
    refetchInterval: 60000,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['linkedin-messages', selectedCampaignId],
    queryFn: () => api.getLinkedInMessages(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
    enabled: activeTab === 'messages',
  });

  const deleteSeq = useMutation({
    mutationFn: api.deleteLinkedInSequence,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
      toast.success('Sequence deleted');
    },
  });

  const sendMessage = useMutation({
    mutationFn: ({ sequenceId, messageType }) => api.sendLinkedInMessage({ sequenceId, messageType, campaignId: selectedCampaignId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-rate-limit'] });
      toast.success('Message sent');
    },
    onError: (err) => toast.error(err.message),
  });

  const activateSeq = useMutation({
    mutationFn: (id) => api.activateLinkedInSequence(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
      toast.success('Sequence activated');
    },
  });

  const pauseSeq = useMutation({
    mutationFn: (id) => api.pauseLinkedInSequence(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] });
      toast.info('Sequence paused');
    },
  });

  const handleSend = (seqId, action) => {
    if (action === 'pause') {
      pauseSeq.mutate(seqId);
    } else if (action === 'resume') {
      activateSeq.mutate(seqId);
    } else {
      sendMessage.mutate({ sequenceId: seqId, messageType: action });
    }
  };

  const totalActive = sequences.filter(s => s.status === 'ACTIVE').length;
  const totalCompleted = sequences.filter(s => s.status === 'COMPLETED').length;
  const totalDraft = sequences.filter(s => s.status === 'DRAFT').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Linkedin className="w-7 h-7 text-primary" /> LinkedIn Outreach
          </h1>
          <p className="text-muted-foreground text-sm mt-1">CPG/DTC connection pipeline with day-3 and day-7 follow-ups</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'prospects' && (
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
              <Upload className="w-4 h-4" /> Import
            </button>
          )}
          <button onClick={() => setShowCampaign(true)}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
            <Target className="w-4 h-4" /> Campaign
          </button>
          <button onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <Sparkles className="w-4 h-4" /> New Sequence
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold">{sequences.length}</div>
          <div className="text-xs text-muted-foreground">Total Sequences</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <div className="text-2xl font-bold text-green-700">{totalActive}</div>
          <div className="text-xs text-green-600">Active</div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="text-2xl font-bold text-blue-700">{totalCompleted}</div>
          <div className="text-xs text-blue-600">Completed</div>
        </div>
        <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
          <div className="text-2xl font-bold text-orange-700">{rateLimit?.remaining ?? '—'}</div>
          <div className="text-xs text-orange-600">Connections Left Today</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        {['dashboard', 'sequences', 'prospects', 'messages'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center capitalize',
              activeTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {tab}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        campLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <CampaignDashboard campaigns={campaigns} sequences={sequences} onSelectCampaign={(id) => { setSelectedCampaignId(id); setActiveTab('sequences'); }} />
        )
      )}

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
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Send className="w-3 h-3" /> {seq.sentCount || 0}/3 sent
                      </span>
                      {seq.nextSendAt && seq.status === 'ACTIVE' && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Next: {new Date(seq.nextSendAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {seq.status === 'DRAFT' && (
                      <button onClick={(e) => { e.stopPropagation(); activateSeq.mutate(seq.id); }}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg" title="Activate">
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    {seq.status === 'ACTIVE' && (
                      <button onClick={(e) => { e.stopPropagation(); pauseSeq.mutate(seq.id); }}
                        className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg" title="Pause">
                        <Pause className="w-4 h-4" />
                      </button>
                    )}
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

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Send className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No messages sent yet</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Prospect</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Sent At</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(m => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{m.prospectName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">{m.messageType}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[m.status] || 'bg-muted text-muted-foreground')}>{m.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {m.sentAt ? new Date(m.sentAt).toLocaleString() : m.scheduledFor ? `Scheduled: ${new Date(m.scheduledFor).toLocaleDateString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showGenerate && <GenerateSequenceModal campaigns={campaigns} onClose={() => setShowGenerate(false)} onGenerated={() => { queryClient.invalidateQueries({ queryKey: ['linkedin-sequences'] }); setActiveTab('sequences'); }} />}
      {showImport && <ImportProspectsModal onClose={() => setShowImport(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ['linkedin-prospects'] })} />}
      {showCampaign && <CampaignModal onClose={() => setShowCampaign(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['linkedin-campaigns'] })} />}
      {selectedSeq && <SequenceDetail seq={selectedSeq} rateLimit={rateLimit} onClose={() => setSelectedSeq(null)} onSend={handleSend} />}
    </div>
  );
}