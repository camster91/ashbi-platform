import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Mail, Sparkles, Loader2, X, Check, Archive, Tag, Edit3,
  RefreshCw, Send, ChevronRight, AlertTriangle, User, Clock
} from 'lucide-react';

const TAG_COLORS = {
  'needs-reply': 'bg-red-100 text-red-700',
  'urgent': 'bg-orange-100 text-orange-700',
  'client': 'bg-blue-100 text-blue-700',
  'lead': 'bg-purple-100 text-purple-700',
  'info-only': 'bg-gray-100 text-gray-600',
  'spam': 'bg-yellow-100 text-yellow-700',
};

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  REVIEWED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-gray-100 text-gray-600',
};

function DraftEditor({ draft, onClose, onApproved }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateEmailDraft(draft.id, { subject, body });
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    try {
      await save();
      await api.approveEmailDraft(draft.id);
      onApproved();
      onClose();
    } catch (err) {
      alert('Approve failed: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Option {draft.option} — {draft.tone || 'professional'}</span>
        <div className="flex gap-1">
          <button onClick={save} disabled={saving}
            className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded transition-colors flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Edit3 className="w-3 h-3" />} Save
          </button>
          <button onClick={approve} disabled={approving}
            className="px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors flex items-center gap-1">
            {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
          </button>
        </div>
      </div>
      <input value={subject} onChange={e => setSubject(e.target.value)}
        className="w-full px-3 py-1.5 text-sm bg-muted rounded border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
        className="w-full px-3 py-2 text-sm bg-muted rounded border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono" />
    </div>
  );
}

function EmailDetail({ item, onClose, onUpdated }) {
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();

  const generateDrafts = async () => {
    setGenerating(true);
    try {
      await api.generateEmailDrafts(item.id);
      queryClient.invalidateQueries(['email-queue']);
      onUpdated();
    } catch (err) {
      alert('Failed to generate drafts: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const archive = async () => {
    try {
      await api.archiveEmailItem(item.id);
      queryClient.invalidateQueries(['email-queue']);
      onClose();
    } catch (err) {
      alert('Archive failed: ' + err.message);
    }
  };

  const tags = JSON.parse(item.tags || '[]');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold truncate flex-1">{item.subject}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <User className="w-3.5 h-3.5" /> {item.senderName || item.senderEmail}
          </span>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[item.status])}>
            {item.status}
          </span>
          {tags.map(tag => (
            <span key={tag} className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TAG_COLORS[tag] || 'bg-gray-100 text-gray-600')}>
              {tag}
            </span>
          ))}
        </div>

        {/* AI Summary */}
        {item.aiSummary && (
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1">
              <Sparkles className="w-3.5 h-3.5" /> AI Summary
            </div>
            <p className="text-sm">{item.aiSummary}</p>
          </div>
        )}

        {/* Original email body */}
        <div className="bg-muted/50 rounded-lg p-4 mb-4 max-h-48 overflow-y-auto">
          <p className="text-xs font-medium text-muted-foreground mb-2">Original Email</p>
          <pre className="text-sm whitespace-pre-wrap font-sans">{item.bodyText}</pre>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-4">
          <button onClick={generateDrafts} disabled={generating}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'Generating...' : 'Generate Reply Drafts'}
          </button>
          <button onClick={archive}
            className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
            <Archive className="w-4 h-4" /> Archive
          </button>
        </div>

        {/* Drafts */}
        {item.drafts && item.drafts.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Reply Drafts</p>
            {item.drafts.map(draft => (
              <DraftEditor
                key={draft.id}
                draft={draft}
                onClose={() => {}}
                onApproved={() => {
                  queryClient.invalidateQueries(['email-queue']);
                  onUpdated();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmailAgent() {
  const [selectedItem, setSelectedItem] = useState(null);
  const [tagFilter, setTagFilter] = useState('');
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['email-queue', tagFilter],
    queryFn: () => api.getEmailQueue(tagFilter ? { tag: tagFilter } : {}),
  });

  const scan = async () => {
    setScanning(true);
    try {
      const result = await api.scanEmailInbox();
      queryClient.invalidateQueries(['email-queue']);
      alert(`Scanned ${result.scanned} threads, triaged ${result.triaged} new items`);
    } catch (err) {
      alert('Scan failed: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  const pendingCount = items.filter(i => i.status === 'PENDING').length;
  const needsReply = items.filter(i => {
    const tags = JSON.parse(i.tags || '[]');
    return tags.includes('needs-reply');
  }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Mail className="w-7 h-7 text-primary" /> Email Triage Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered inbox triage — scan, tag, draft replies</p>
        </div>
        <button onClick={scan} disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {scanning ? 'Scanning...' : 'Scan Inbox'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground font-medium">Pending Review</p>
          <p className="text-2xl font-bold mt-1">{pendingCount}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground font-medium">Needs Reply</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{needsReply}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground font-medium">Total Triaged</p>
          <p className="text-2xl font-bold mt-1">{items.length}</p>
        </div>
      </div>

      {/* Tag filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'needs-reply', 'urgent', 'client', 'lead', 'info-only', 'spam'].map(tag => (
          <button key={tag} onClick={() => setTagFilter(tag)}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors',
              tagFilter === tag ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}>
            {tag || 'All'}
          </button>
        ))}
      </div>

      {/* Queue list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No emails in triage queue</p>
          <p className="text-sm">Click "Scan Inbox" to triage new messages</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const tags = JSON.parse(item.tags || '[]');
            const hasDrafts = item.drafts && item.drafts.length > 0;
            return (
              <div key={item.id} onClick={() => setSelectedItem(item)}
                className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer group">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[item.status])}>
                        {item.status}
                      </span>
                      {tags.map(tag => (
                        <span key={tag} className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TAG_COLORS[tag] || 'bg-gray-100 text-gray-600')}>
                          {tag}
                        </span>
                      ))}
                      {hasDrafts && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <Send className="w-3 h-3" /> {item.drafts.length} drafts
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{item.subject}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      From: {item.senderName || item.senderEmail}
                    </p>
                    {item.aiSummary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{item.aiSummary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedItem && (
        <EmailDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            queryClient.invalidateQueries(['email-queue']);
            // Refresh selected item
            const refreshed = items.find(i => i.id === selectedItem.id);
            if (refreshed) setSelectedItem(refreshed);
          }}
        />
      )}
    </div>
  );
}
