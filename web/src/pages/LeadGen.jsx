import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Target, Plus, Sparkles, ChevronRight, Building2, Mail,
  Linkedin, MoreHorizontal, X, Loader2, Users, Search,
  ArrowRight, GripVertical, MessageSquare
} from 'lucide-react';

const PIPELINE_COLUMNS = [
  { key: 'NEW', label: 'New Leads', color: 'bg-blue-500' },
  { key: 'CONTACTED', label: 'Contacted', color: 'bg-yellow-500' },
  { key: 'REPLIED', label: 'Replied', color: 'bg-green-500' },
  { key: 'MEETING', label: 'Meeting / Converted', color: 'bg-purple-500' },
  { key: 'DEAD', label: 'Dead', color: 'bg-muted-foreground/50' },
];

const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-yellow-100 text-yellow-700',
  REPLIED: 'bg-green-100 text-green-700',
  MEETING: 'bg-purple-100 text-purple-700',
  DEAD: 'bg-muted text-muted-foreground',
};

function LeadCard({ lead, onStatusChange, onGenerateSequence }) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-foreground truncate">{lead.name}</p>
          {lead.company && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building2 className="w-3 h-3" /> {lead.company}
            </p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showActions && (
            <div className="absolute right-0 top-6 z-10 bg-card border border-border rounded-lg shadow-lg py-1 w-44">
              {PIPELINE_COLUMNS.filter(c => c.key !== lead.status && c.key !== (lead.status === 'CONVERTED' ? 'MEETING' : '')).map(col => (
                <button
                  key={col.key}
                  onClick={() => { onStatusChange(lead.id, col.key === 'MEETING' ? 'CONVERTED' : col.key); setShowActions(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                >
                  <div className={cn('w-2 h-2 rounded-full', col.color)} />
                  Move to {col.label}
                </button>
              ))}
              <hr className="my-1 border-border" />
              <button
                onClick={() => { onGenerateSequence(lead.id); setShowActions(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 text-primary"
              >
                <Sparkles className="w-3 h-3" /> Generate Sequence
              </button>
            </div>
          )}
        </div>
      </div>
      {lead.title && <p className="text-xs text-muted-foreground">{lead.title}</p>}
      {lead.industry && (
        <span className="inline-block text-xs bg-muted px-2 py-0.5 rounded-full">{lead.industry}</span>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {lead.email && <Mail className="w-3 h-3" />}
        {lead.linkedinUrl && <Linkedin className="w-3 h-3" />}
        {lead.sequence && (
          <span className="flex items-center gap-1 text-primary">
            <MessageSquare className="w-3 h-3" /> Sequence
          </span>
        )}
      </div>
      {lead.notes && (
        <p className="text-xs text-muted-foreground line-clamp-2">{lead.notes}</p>
      )}
    </div>
  );
}

function FindLeadsModal({ onClose, onGenerated }) {
  const [form, setForm] = useState({ industry: 'CPG/DTC', targetType: '', location: 'North America', count: 10, notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.leadGenFindLeads(form);
      onGenerated(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to generate leads');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> AI Lead Finder
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Industry</label>
            <input
              value={form.industry}
              onChange={e => setForm({ ...form, industry: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              placeholder="e.g. CPG, DTC, Beauty, Food & Beverage"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Target Type</label>
            <input
              value={form.targetType}
              onChange={e => setForm({ ...form, targetType: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              placeholder="e.g. Shopify stores needing rebrand"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <input
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Count</label>
              <input
                type="number"
                value={form.count}
                onChange={e => setForm({ ...form, count: parseInt(e.target.value) || 10 })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                min={1}
                max={25}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              rows={2}
              placeholder="Any specific criteria or focus areas..."
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Find Leads</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function SequenceModal({ lead, sequence, onClose }) {
  if (!sequence) return null;

  const steps = typeof sequence === 'string' ? JSON.parse(sequence) : (sequence.steps || sequence);
  const stepList = typeof steps === 'string' ? JSON.parse(steps) : steps;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Outreach Sequence — {lead?.name}
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          {(Array.isArray(stepList) ? stepList : []).map((step, i) => (
            <div key={i} className="border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                  {step.step || i + 1}
                </span>
                <span className="text-sm font-medium capitalize flex items-center gap-1">
                  {step.channel === 'linkedin' ? <Linkedin className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                  {step.channel || 'email'}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  Day {step.delayDays || 0}
                </span>
              </div>
              {step.subject && (
                <p className="text-sm font-medium text-foreground mb-1">{step.subject}</p>
              )}
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LeadGen() {
  const queryClient = useQueryClient();
  const [showFindLeads, setShowFindLeads] = useState(false);
  const [sequenceModal, setSequenceModal] = useState(null);
  const [generatingSequence, setGeneratingSequence] = useState(null);

  const { data: pipelineData, isLoading } = useQuery({
    queryKey: ['lead-gen-pipeline'],
    queryFn: api.leadGenGetPipeline,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.leadGenUpdateStatus(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-gen-pipeline'] }),
  });

  const handleGenerateSequence = async (prospectId) => {
    setGeneratingSequence(prospectId);
    try {
      const result = await api.leadGenGenerateSequence(prospectId);
      setSequenceModal({ lead: result.lead, sequence: result.steps });
      queryClient.invalidateQueries({ queryKey: ['lead-gen-pipeline'] });
    } catch (err) {
      console.error('Failed to generate sequence:', err);
    } finally {
      setGeneratingSequence(null);
    }
  };

  const pipeline = pipelineData?.pipeline || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" /> Lead Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered lead generation and outreach sequences
          </p>
        </div>
        <button
          onClick={() => setShowFindLeads(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Find Leads
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {PIPELINE_COLUMNS.map(col => (
          <div key={col.key} className="bg-card border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className={cn('w-2 h-2 rounded-full', col.color)} />
              <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
            </div>
            <p className="text-2xl font-bold">{(pipeline[col.key] || []).length}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Kanban */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-4 min-h-[500px]">
          {PIPELINE_COLUMNS.map(col => (
            <div key={col.key} className="space-y-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <div className={cn('w-2 h-2 rounded-full', col.color)} />
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {(pipeline[col.key] || []).length}
                </span>
              </div>
              <div className="space-y-2 bg-muted/30 rounded-lg p-2 min-h-[400px]">
                {(pipeline[col.key] || []).map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                    onGenerateSequence={handleGenerateSequence}
                  />
                ))}
                {(pipeline[col.key] || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No leads</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generating indicator */}
      {generatingSequence && (
        <div className="fixed bottom-6 right-6 bg-card border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm">Generating outreach sequence...</span>
        </div>
      )}

      {/* Modals */}
      {showFindLeads && (
        <FindLeadsModal
          onClose={() => setShowFindLeads(false)}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['lead-gen-pipeline'] })}
        />
      )}
      {sequenceModal && (
        <SequenceModal
          lead={sequenceModal.lead}
          sequence={sequenceModal.sequence}
          onClose={() => setSequenceModal(null)}
        />
      )}
    </div>
  );
}
