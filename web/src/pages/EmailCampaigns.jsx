import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import {
  Mail, Loader2, X, Plus, Trash2, Send, Eye, Edit3, ChevronRight, Clock, Users, ChevronLeft
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

function CreateSequenceModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [serviceType, setServiceType] = useState('full_service');
  const [targetIndustry, setTargetIndustry] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.generateColdEmailSequence({ name, serviceType, targetIndustry });
      toast.success('Sequence created');
      onCreated();
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
          <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">New Email Campaign</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Campaign Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Q1 DTC Outreach"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
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
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create Campaign</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function SequenceDetail({ sequence, onClose }) {
  const emails = typeof sequence.emails === 'string' ? JSON.parse(sequence.emails || '[]') : (sequence.emails || []);

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
        <div className="mb-4 grid grid-cols-4 gap-4 text-center">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-2xl font-bold text-primary">{sequence.totalSent || 0}</div>
            <div className="text-xs text-muted-foreground">Sent</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-600">{sequence.totalOpened || 0}</div>
            <div className="text-xs text-muted-foreground">Opened</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-2xl font-bold text-purple-600">{sequence.totalReplied || 0}</div>
            <div className="text-xs text-muted-foreground">Replied</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-2xl font-bold text-orange-600">{sequence.totalProspects || 0}</div>
            <div className="text-xs text-muted-foreground">Prospects</div>
          </div>
        </div>
        <h3 className="text-sm font-semibold mb-3">Email Steps</h3>
        <div className="space-y-3">
          {emails.map((email, i) => (
            <div key={i} className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">Step {i + 1}</span>
                <span className="text-xs text-muted-foreground">Day {email.delayDays}</span>
                {email.purpose && <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{email.purpose}</span>}
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

export default function EmailCampaigns() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ['email-campaigns'],
    queryFn: api.getColdEmailSequences,
  });

  const activateSeq = useMutation({
    mutationFn: api.activateColdEmailSequence,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      toast.success('Campaign activated');
    },
    onError: (err) => toast.error(err.message),
  });

  const pauseSeq = useMutation({
    mutationFn: api.pauseColdEmailSequence,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
      toast.success('Campaign paused');
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteSeq = useMutation({
    mutationFn: api.deleteColdEmailSequence,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-campaigns'] }),
    onError: (err) => toast.error(err.message),
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
            <Mail className="w-7 h-7 text-primary" /> Email Campaigns
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Create and manage cold email sequences</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Plus className="w-4 h-4" /> New Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
          <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No campaigns yet</p>
          <p className="text-sm">Create your first email campaign to get started</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">
            Create Campaign
          </button>
        </div>
      ) : (
        <div className="space-y-3">
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
                    {seq.totalProspects > 0 && <span><Users className="w-3 h-3 inline mr-0.5" />{seq.totalProspects}</span>}
                    <span><Clock className="w-3 h-3 inline mr-0.5" />{new Date(seq.createdAt).toLocaleDateString('en-CA')}</span>
                    {seq.totalSent > 0 && <span className="text-green-600">{seq.totalSent} sent</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {seq.status === 'DRAFT' && (
                    <button onClick={(e) => { e.stopPropagation(); activateSeq.mutate(seq.id); }}
                      className="p-2 text-muted-foreground hover:text-green-600" title="Activate">
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                  {seq.status === 'ACTIVE' && (
                    <button onClick={(e) => { e.stopPropagation(); pauseSeq.mutate(seq.id); }}
                      className="p-2 text-muted-foreground hover:text-orange-600" title="Pause">
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this campaign?')) deleteSeq.mutate(seq.id); }}
                    className="p-2 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateSequenceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['email-campaigns'] })}
        />
      )}
      {selectedSeq && (
        <SequenceDetail sequence={selectedSeq} onClose={() => setSelectedSeq(null)} />
      )}
    </div>
  );
}