import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Linkedin, Sparkles, Loader2, X, Plus, Trash2, Edit3, Users,
  ChevronRight, Clock, Building, User, Copy, Check, Upload
} from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  NEW: 'bg-gray-100 text-gray-600',
  CONNECTED: 'bg-green-100 text-green-700',
  IN_SEQUENCE: 'bg-blue-100 text-blue-700',
  REPLIED: 'bg-purple-100 text-purple-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
};

function GenerateSequenceModal({ onClose, onGenerated }) {
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
      alert('Failed: ' + err.message);
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
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const importProspects = async () => {
    const lines = text.trim().split('\n').filter(Boolean);
    const prospects = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      return { name: parts[0], company: parts[1], title: parts[2], industry: parts[3], linkedinUrl: parts[4], email: parts[5] };
    }).filter(p => p.name);

    if (prospects.length === 0) return alert('No valid prospects found');

    setLoading(true);
    try {
      const result = await api.importLinkedInProspects({ prospects });
      alert(`Imported ${result.imported} prospects`);
      onImported();
      onClose();
    } catch (err) {
      alert('Import failed: ' + err.message);
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

function SequenceDetail({ seq, onClose }) {
  const [copied, setCopied] = useState('');

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{seq.prospectName}</h2>
            <p className="text-sm text-muted-foreground">{seq.prospectTitle} at {seq.company} — {seq.industry}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
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
    onSuccess: () => queryClient.invalidateQueries(['linkedin-sequences']),
  });

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
      </div>

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
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600')}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showGenerate && <GenerateSequenceModal onClose={() => setShowGenerate(false)} onGenerated={() => queryClient.invalidateQueries(['linkedin-sequences'])} />}
      {showImport && <ImportProspectsModal onClose={() => setShowImport(false)} onImported={() => queryClient.invalidateQueries(['linkedin-prospects'])} />}
      {selectedSeq && <SequenceDetail seq={selectedSeq} onClose={() => setSelectedSeq(null)} />}
    </div>
  );
}
