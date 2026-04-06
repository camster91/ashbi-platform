import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import {
  Mail, Sparkles, Loader2, X, Plus, Trash2, Upload, Copy, Check,
  ChevronRight, Clock, Users, Eye, Edit3
} from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  NEW: 'bg-muted text-muted-foreground',
  CONTACTED: 'bg-blue-100 text-blue-700',
  REPLIED: 'bg-purple-100 text-purple-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
  UNSUBSCRIBED: 'bg-red-100 text-red-700',
};

const SERVICE_LABELS = {
  web_design: 'Web Design',
  branding: 'Branding',
  seo: 'SEO',
  full_service: 'Full Service',
};

function GenerateSequenceModal({ onClose, onGenerated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState('full_service');
  const [targetIndustry, setTargetIndustry] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [painPoint, setPainPoint] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.generateColdEmailSequence({ name, serviceType, targetIndustry, companyName, painPoint });
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
          <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Generate Email Sequence</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Campaign Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Q1 DTC Skincare Outreach"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Service Type</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="full_service">Full Service</option>
                <option value="web_design">Web Design</option>
                <option value="branding">Branding</option>
                <option value="seo">SEO</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Target Industry</label>
              <input value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} placeholder="e.g. Skincare, Supplements"
                className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Example Company (for personalization)</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. GlowUp Skincare"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Key Pain Point</label>
            <input value={painPoint} onChange={e => setPainPoint(e.target.value)} placeholder="e.g. outdated packaging, low conversion rate"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <p className="text-xs text-muted-foreground">Generates a 5-email cold outreach sequence with personalization placeholders.</p>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating 5 Emails...</> : <><Sparkles className="w-4 h-4" /> Generate Sequence</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function ImportProspectsModal({ onClose, onImported, sequences }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [loading, setLoading] = useState(false);

  const importProspects = async () => {
    const lines = text.trim().split('\n').filter(Boolean);
    const prospects = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      return { name: parts[0], email: parts[1], company: parts[2], industry: parts[3], painPoint: parts[4] };
    }).filter(p => p.name && p.email);

    if (prospects.length === 0) { toast.error('No valid prospects (need name,email)'); return; }

    setLoading(true);
    try {
      const result = await api.importColdEmailProspects({ prospects, sequenceId: sequenceId || undefined });
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
        {sequences.length > 0 && (
          <div className="mb-3">
            <label className="text-xs font-medium text-muted-foreground">Assign to Sequence (optional)</label>
            <select value={sequenceId} onChange={e => setSequenceId(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">None</option>
              {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <p className="text-xs text-muted-foreground mb-3">One per line: Name, Email, Company, Industry, Pain Point</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
          placeholder="Sarah Johnson, sarah@glowup.com, GlowUp Skincare, Beauty, outdated packaging"
          className="w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
        <button onClick={importProspects} disabled={loading || !text.trim()}
          className="w-full mt-3 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
        </button>
      </div>
    </div>
  );
}

function SequenceDetail({ sequence, onClose }) {
  const [copied, setCopied] = useState(-1);
  const emails = Array.isArray(sequence.emails) ? sequence.emails : JSON.parse(sequence.emails || '[]');

  const copy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(-1), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{sequence.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[sequence.status])}>{sequence.status}</span>
              <span className="text-xs text-muted-foreground">{SERVICE_LABELS[sequence.serviceType] || sequence.serviceType}</span>
              {sequence.targetIndustry && <span className="text-xs text-muted-foreground">| {sequence.targetIndustry}</span>}
              {sequence._count && <span className="text-xs text-muted-foreground">| {sequence._count.prospects} prospects</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {emails.map((email, i) => (
            <div key={i} className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Email {i + 1}</span>
                  <span className="text-xs text-muted-foreground">Day {email.delayDays}</span>
                  {email.purpose && <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{email.purpose}</span>}
                </div>
                <button onClick={() => copy(`Subject: ${email.subject}\n\n${email.body}`, i)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-card hover:bg-muted rounded transition-colors">
                  {copied === i ? <><Check className="w-3 h-3 text-green-600" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Subject: {email.subject}</p>
              <p className="text-sm whitespace-pre-wrap">{email.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ColdEmail() {
  const [activeTab, setActiveTab] = useState('sequences');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const queryClient = useQueryClient();

  const { data: sequences = [], isLoading: seqLoading } = useQuery({
    queryKey: ['cold-email-sequences'],
    queryFn: api.getColdEmailSequences,
  });

  const { data: prospects = [], isLoading: prospLoading } = useQuery({
    queryKey: ['cold-email-prospects'],
    queryFn: () => api.getColdEmailProspects(),
  });

  const deleteSeq = useMutation({
    mutationFn: api.deleteColdEmailSequence,
    onSuccess: () => queryClient.invalidateQueries(['cold-email-sequences']),
  });

  const openSequence = async (seq) => {
    try {
      const full = await api.getColdEmailSequence(seq.id);
      setSelectedSeq(full);
    } catch {
      setSelectedSeq(seq);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Mail className="w-7 h-7 text-primary" /> Cold Email Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate personalized cold email sequences for agency services</p>
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
            <Sparkles className="w-4 h-4" /> New Campaign
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        <button onClick={() => setActiveTab('sequences')}
          className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center',
            activeTab === 'sequences' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          Campaigns ({sequences.length})
        </button>
        <button onClick={() => setActiveTab('prospects')}
          className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors text-center',
            activeTab === 'prospects' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          Prospects ({prospects.length})
        </button>
      </div>

      {/* Sequences Tab */}
      {activeTab === 'sequences' && (
        seqLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : sequences.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm">Generate your first cold email sequence</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sequences.map(seq => (
              <div key={seq.id} onClick={() => openSequence(seq)}
                className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">{seq.name}</h3>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[seq.status])}>{seq.status}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{SERVICE_LABELS[seq.serviceType] || seq.serviceType}</span>
                      {seq.targetIndustry && <span>{seq.targetIndustry}</span>}
                      {seq._count && <span><Users className="w-3 h-3 inline mr-0.5" />{seq._count.prospects} prospects</span>}
                      <span><Clock className="w-3 h-3 inline mr-0.5" />{new Date(seq.createdAt).toLocaleDateString()}</span>
                    </div>
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
            <p className="text-sm">Import prospects for your campaigns</p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Company</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.company || '—'}</td>
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

      {showGenerate && <GenerateSequenceModal onClose={() => setShowGenerate(false)} onGenerated={() => queryClient.invalidateQueries(['cold-email-sequences'])} />}
      {showImport && <ImportProspectsModal sequences={sequences} onClose={() => setShowImport(false)} onImported={() => queryClient.invalidateQueries(['cold-email-prospects'])} />}
      {selectedSeq && <SequenceDetail sequence={selectedSeq} onClose={() => setSelectedSeq(null)} />}
    </div>
  );
}
