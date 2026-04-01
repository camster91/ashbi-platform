import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Phone, Sparkles, Loader2, X, Plus, Send, ChevronRight, Clock,
  User, Building, FileText, CheckCircle, MessageSquare, Trash2
} from 'lucide-react';

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  SCREENED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FOLLOW_UP_SENT: 'bg-purple-100 text-purple-700',
};

function NewCallModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [company, setCompany] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);

  const screen = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.screenCall({ callerName: name, callerNumber: number, callerCompany: company, context });
      onCreated();
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
          <div className="flex items-center gap-2"><Phone className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">New Incoming Call</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={screen} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Caller Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Sarah Johnson"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Phone Number</label>
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. +1 416 555 0123"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Company</label>
            <input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. GlowUp Skincare"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Context (optional)</label>
            <textarea value={context} onChange={e => setContext(e.target.value)} rows={2}
              placeholder="Any context about why they're calling..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Script...</> : <><Sparkles className="w-4 h-4" /> Generate Screening Script</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function CallDetail({ call, onClose, onUpdated }) {
  const [summary, setSummary] = useState(call.callSummary || call.summaryTemplate || '');
  const [notes, setNotes] = useState(call.callNotes || '');
  const [saving, setSaving] = useState(false);
  const [generatingFollowUp, setGeneratingFollowUp] = useState(false);
  const queryClient = useQueryClient();

  const questions = call.screeningQuestions || JSON.parse(call.screeningScript || '[]');
  const followUp = call.followUpEmail ? JSON.parse(call.followUpEmail) : null;

  const saveSummary = async () => {
    setSaving(true);
    try {
      await api.saveCallSummary({ callId: call.id, summary, notes });
      queryClient.invalidateQueries(['call-log']);
      onUpdated();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const generateFollowUp = async () => {
    setGeneratingFollowUp(true);
    try {
      await api.generateCallFollowUp(call.id);
      queryClient.invalidateQueries(['call-log']);
      onUpdated();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setGeneratingFollowUp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{call.callerName}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
              {call.callerNumber && <span><Phone className="w-3 h-3 inline mr-1" />{call.callerNumber}</span>}
              {call.callerCompany && <span><Building className="w-3 h-3 inline mr-1" />{call.callerCompany}</span>}
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[call.status])}>{call.status}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Screening Questions */}
        {questions.length > 0 && (
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-2">
              <Sparkles className="w-3.5 h-3.5" /> Screening Questions
            </div>
            <ol className="space-y-2">
              {questions.map((q, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-primary font-semibold">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Call Summary */}
        <div className="space-y-3 mb-4">
          <p className="text-sm font-medium">Call Summary</p>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={8}
            placeholder="Fill in your call summary here..."
            className="w-full px-4 py-3 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
          <p className="text-sm font-medium">Additional Notes</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Any extra notes..."
            className="w-full px-4 py-3 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-4">
          <button onClick={saveSummary} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Save Summary
          </button>
          {(call.callSummary || call.callNotes) && (
            <button onClick={generateFollowUp} disabled={generatingFollowUp}
              className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80 disabled:opacity-50">
              {generatingFollowUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Generate Follow-Up Email
            </button>
          )}
        </div>

        {/* Follow-up Email */}
        {followUp && (
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Follow-Up Email Draft</p>
            <p className="text-xs text-muted-foreground mb-1">Subject: {followUp.subject}</p>
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{followUp.body}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CallAgent() {
  const [showNewCall, setShowNewCall] = useState(false);
  const [selectedCall, setSelectedCall] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ['call-log', statusFilter],
    queryFn: () => api.getCallLog(statusFilter ? { status: statusFilter } : {}),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Phone className="w-7 h-7 text-primary" /> Call Screener Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered call screening, summaries, and follow-ups</p>
        </div>
        <button onClick={() => setShowNewCall(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Plus className="w-4 h-4" /> New Call
        </button>
      </div>

      {/* Status filters */}
      <div className="flex gap-2">
        {['', 'PENDING', 'COMPLETED', 'FOLLOW_UP_SENT'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Call log */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : calls.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Phone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No calls logged yet</p>
          <p className="text-sm">Click "New Call" when someone calls</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map(call => (
            <div key={call.id} onClick={() => setSelectedCall(call)}
              className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">{call.callerName}</h3>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[call.status])}>{call.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {call.callerCompany && <span><Building className="w-3 h-3 inline mr-0.5" />{call.callerCompany}</span>}
                    {call.callerNumber && <span><Phone className="w-3 h-3 inline mr-0.5" />{call.callerNumber}</span>}
                    <span><Clock className="w-3 h-3 inline mr-0.5" />{new Date(call.createdAt).toLocaleDateString()}</span>
                  </div>
                  {call.callSummary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{call.callSummary}</p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewCall && <NewCallModal onClose={() => setShowNewCall(false)} onCreated={() => queryClient.invalidateQueries(['call-log'])} />}
      {selectedCall && (
        <CallDetail
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          onUpdated={() => {
            queryClient.invalidateQueries(['call-log']);
            setSelectedCall(null);
          }}
        />
      )}
    </div>
  );
}
