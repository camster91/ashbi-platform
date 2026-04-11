import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft,
  User,
  FolderOpen,
  Send,
  Sparkles,
  Clock,
  CheckCircle,
  MessageSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Mail,
  Shield,
  Reply,
  ExternalLink,
  X,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatDateTime,
  formatRelativeTime,
  getPriorityColor,
  getStatusColor,
  getSentimentIcon,
  cn,
} from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export default function Thread() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const [responseText, setResponseText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [showGmailReply, setShowGmailReply] = useState(false);
  const [gmailReplyText, setGmailReplyText] = useState('');
  const [gmailReplySubject, setGmailReplySubject] = useState('');
  const [gmailReplyTo, setGmailReplyTo] = useState('');
  const [gmailDraftMeta, setGmailDraftMeta] = useState(null); // { gmailThreadId, lastMessageId }

  const { data: thread, isLoading } = useQuery({
    queryKey: ['thread', id],
    queryFn: () => api.getThread(id),
  });

  const draftMutation = useMutation({
    mutationFn: () => api.draftResponse(id),
    onSuccess: (data) => {
      setResponseText(data.options[0]?.body || '');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (body) => api.createResponse(id, { subject: `Re: ${thread.subject}`, body, tone: 'professional' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      setResponseText('');
      toast.success('Response submitted for approval');
    },
    onError: () => toast.error('Failed to submit response'),
  });

  const noteMutation = useMutation({
    mutationFn: (content) => api.addNote(id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  const resolveMutation = useMutation({
    mutationFn: () => api.resolveThread(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      toast.success('Thread resolved');
    },
    onError: () => toast.error('Failed to resolve thread'),
  });

  const gmailDraftMutation = useMutation({
    mutationFn: () => api.gmailDraftReply(id),
    onSuccess: (data) => {
      setGmailReplyText(data.draft || '');
      setGmailReplySubject(data.subject || `Re: ${thread?.subject}`);
      setGmailReplyTo(data.to || '');
      setGmailDraftMeta({ gmailThreadId: data.gmailThreadId, lastMessageId: data.lastMessageId });
      setShowGmailReply(true);
    },
  });

  const gmailSendMutation = useMutation({
    mutationFn: () => api.gmailSend({
      to: gmailReplyTo,
      subject: gmailReplySubject,
      body: gmailReplyText,
      threadId: gmailDraftMeta?.gmailThreadId,
      in_reply_to: gmailDraftMeta?.lastMessageId,
      hubThreadId: id,
    }),
    onSuccess: () => {
      setShowGmailReply(false);
      setGmailReplyText('');
      setGmailReplyTo('');
      setGmailReplySubject('');
      setGmailDraftMeta(null);
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      toast.success('Reply sent via Gmail');
    },
    onError: () => toast.error('Failed to send Gmail reply'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!thread) {
    return <div className="text-center py-8 text-muted-foreground">Thread not found</div>;
  }

  const analysis = thread.aiAnalysis;
  const messages = thread.messages || [];
  const visibleMessages = showAllMessages ? messages : messages.slice(0, 3);
  const hasMoreMessages = messages.length > 3;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/inbox" className="p-2 hover:bg-secondary rounded-lg transition-colors mt-1">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-heading font-bold text-foreground">{thread.subject}</h1>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
            {thread.client && (
              <Link to={`/client/${thread.client.id}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                <User className="w-4 h-4" />
                {thread.client.name}
              </Link>
            )}
            {thread.project && (
              <Link to={`/project/${thread.project.id}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                <FolderOpen className="w-4 h-4" />
                {thread.project.name}
              </Link>
            )}
            {thread.slaDeadline && (
              <span className={cn('flex items-center gap-1', thread.slaBreached ? 'text-destructive' : 'text-warning')}>
                <Clock className="w-4 h-4" />
                SLA: {thread.slaBreached ? 'Breached' : formatRelativeTime(thread.slaDeadline)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn('px-2.5 py-1 text-sm font-medium rounded-lg', getPriorityColor(thread.priority))}>
            {thread.priority}
          </span>
          <span className={cn('px-2.5 py-1 text-sm font-medium rounded-lg', getStatusColor(thread.status))}>
            {thread.status.replace(/_/g, ' ')}
          </span>
          {thread.status !== 'RESOLVED' && (
            <>
              <button
                onClick={() => gmailDraftMutation.mutate()}
                disabled={gmailDraftMutation.isPending}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center gap-1.5 transition-all hover-lift disabled:opacity-60"
              >
                {gmailDraftMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Reply className="w-4 h-4" />
                )}
                {gmailDraftMutation.isPending ? 'Drafting...' : 'Reply via Gmail'}
              </button>
              <button
                onClick={() => resolveMutation.mutate()}
                className="px-3 py-1.5 text-sm bg-success text-success-foreground rounded-lg hover:opacity-90 flex items-center gap-1.5 transition-all hover-lift"
              >
                <CheckCircle className="w-4 h-4" />
                Resolve
              </button>
            </>
          )}
        </div>
      </div>

      {/* Gmail Reply Modal */}
      {showGmailReply && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-2xl shadow-xl animate-fade-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-heading font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                Reply via Gmail
              </h2>
              <button
                onClick={() => setShowGmailReply(false)}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">To</label>
                <input
                  type="email"
                  value={gmailReplyTo}
                  onChange={(e) => setGmailReplyTo(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Subject</label>
                <input
                  type="text"
                  value={gmailReplySubject}
                  onChange={(e) => setGmailReplySubject(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Message</label>
                <textarea
                  value={gmailReplyText}
                  onChange={(e) => setGmailReplyText(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono leading-relaxed"
                />
              </div>
              {gmailSendMutation.isError && (
                <p className="text-sm text-destructive">
                  Send failed. Please try again.
                </p>
              )}
              {gmailSendMutation.isSuccess && (
                <p className="text-sm text-success font-medium">
                  ✓ Email sent successfully via Gmail
                </p>
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/30 rounded-b-xl">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Sends via Gmail API
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowGmailReply(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-background border border-border rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => gmailSendMutation.mutate()}
                  disabled={!gmailReplyText || !gmailReplyTo || gmailSendMutation.isPending}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium transition-all"
                >
                  {gmailSendMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {gmailSendMutation.isPending ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {analysis && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
          <h3 className="font-heading font-semibold flex items-center gap-2 mb-3 text-foreground">
            <Sparkles className="w-4 h-4 text-accent" />
            AI Analysis
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-card rounded-lg p-3 border border-border">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Intent</span>
              <p className="font-medium mt-0.5">{analysis.intent?.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Sentiment</span>
              <p className="font-medium mt-0.5">{getSentimentIcon(analysis.sentiment)} {analysis.sentiment}</p>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Urgency</span>
              <p className={cn('font-medium mt-0.5', analysis.urgency === 'CRITICAL' && 'text-destructive')}>
                {analysis.urgency}
              </p>
            </div>
            {analysis.questionsToAnswer?.length > 0 && (
              <div className="bg-card rounded-lg p-3 border border-border">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">Questions</span>
                <p className="font-medium mt-0.5">{analysis.questionsToAnswer.length} to answer</p>
              </div>
            )}
          </div>
          {analysis.summary && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{analysis.summary}</p>
          )}
          {analysis.questionsToAnswer?.length > 0 && (
            <div className="mt-3 space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Questions to Address:</span>
              {analysis.questionsToAnswer.map((q, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded mt-0.5',
                    q.priority === 'must_answer' ? 'bg-destructive/10 text-destructive' :
                    q.priority === 'should_answer' ? 'bg-warning/10 text-warning' :
                    'bg-muted text-muted-foreground'
                  )}>{q.priority?.replace(/_/g, ' ')}</span>
                  <span>{q.question}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Messages */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-heading font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                Conversation
              </h2>
              <span className="text-sm text-muted-foreground">{messages.length} messages</span>
            </div>
            <div className="divide-y divide-border">
              {visibleMessages.map((message) => {
                const extracted = (() => { try { return message.aiExtracted ? JSON.parse(message.aiExtracted) : {}; } catch { return {}; } })();
                const isUpwork = extracted.tags?.includes?.('upwork') || extracted.source === 'gmail-sync' && message.senderEmail?.includes('@upwork.com');
                const upworkUrl = extracted.upworkUrl;

                return (
                  <div key={message.id} className={cn('p-5', message.direction === 'OUTBOUND' && 'bg-primary/[0.02]', isUpwork && 'border-l-4 border-l-green-500 bg-green-50/30')}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold',
                        message.direction === 'INBOUND' ? 'bg-secondary text-foreground' : 'bg-primary text-primary-foreground',
                        isUpwork && 'bg-green-100 text-green-700'
                      )}>
                        {isUpwork ? '🏢' : (message.senderName?.[0]?.toUpperCase() || 'U')}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{message.senderName || message.senderEmail}</span>
                          {isUpwork && (
                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Upwork</span>
                          )}
                          {!isUpwork && message.direction === 'INBOUND' && (
                            <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">Client</span>
                          )}
                          {message.direction === 'OUTBOUND' && (
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Team</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(message.receivedAt)}</span>
                      </div>
                      {isUpwork && upworkUrl && (
                        <a
                          href={upworkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex-shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Reply on Upwork
                        </a>
                      )}
                    </div>
                    <div className="pl-12 whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed">
                      {message.bodyText}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMoreMessages && !showAllMessages && (
              <button
                onClick={() => setShowAllMessages(true)}
                className="w-full py-3 text-sm text-primary hover:bg-primary/5 flex items-center justify-center gap-1 border-t border-border transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
                Show {messages.length - 3} more messages
              </button>
            )}
            {showAllMessages && hasMoreMessages && (
              <button
                onClick={() => setShowAllMessages(false)}
                className="w-full py-3 text-sm text-muted-foreground hover:bg-muted/50 flex items-center justify-center gap-1 border-t border-border transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
                Collapse
              </button>
            )}
          </div>

          {/* Internal Notes */}
          {thread.internalNotes?.length > 0 && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="font-heading font-semibold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  Internal Notes
                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Team only</span>
                </h2>
              </div>
              <div className="divide-y divide-border">
                {thread.internalNotes.map((note) => (
                  <div key={note.id} className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{note.author?.name}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(note.createdAt)}</span>
                    </div>
                    <p className="text-sm text-foreground/80">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response Composer */}
          {thread.status !== 'RESOLVED' && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex justify-between items-center">
                <h2 className="font-heading font-semibold">Compose Response</h2>
                <button
                  onClick={() => draftMutation.mutate()}
                  disabled={draftMutation.isPending}
                  className="text-sm text-accent hover:text-accent/80 flex items-center gap-1.5 font-medium transition-colors"
                >
                  <Sparkles className={cn('w-4 h-4', draftMutation.isPending && 'animate-pulse')} />
                  {draftMutation.isPending ? 'Generating...' : 'AI Draft'}
                </button>
              </div>
              <div className="p-5">
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  rows={6}
                  className="w-full p-3 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm leading-relaxed"
                  placeholder="Write your response..."
                />
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Cameron must approve before sending
                  </p>
                  <button
                    onClick={() => submitMutation.mutate(responseText)}
                    disabled={!responseText || submitMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-all hover-lift"
                  >
                    <Send className="w-4 h-4" />
                    {submitMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Note */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="font-heading font-semibold text-sm">Add Internal Note</h2>
            </div>
            <div className="p-4">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                className="w-full p-3 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                placeholder="Add a note for the team..."
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => noteMutation.mutate(noteText)}
                  disabled={!noteText || noteMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-secondary text-foreground rounded-lg hover:bg-secondary/80 disabled:opacity-50 transition-colors"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Thread Details */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-heading font-semibold mb-4">Details</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">Assigned to</dt>
                <dd className="font-medium">{thread.assignedTo?.name || <span className="text-muted-foreground italic">Unassigned</span>}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatRelativeTime(thread.createdAt)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">Last Activity</dt>
                <dd>{formatRelativeTime(thread.lastActivityAt)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">Messages</dt>
                <dd>{messages.length}</dd>
              </div>
              {thread.matchConfidence > 0 && (
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">Match Confidence</dt>
                  <dd className={cn('font-medium', thread.matchConfidence >= 0.85 ? 'text-success' : 'text-warning')}>
                    {Math.round(thread.matchConfidence * 100)}%
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Response Drafts */}
          {thread.responses?.length > 0 && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="font-heading font-semibold">Response Drafts</h3>
              </div>
              <ul className="divide-y divide-border">
                {thread.responses.map((response) => (
                  <li key={response.id} className="p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-medium rounded',
                        response.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        response.status === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-700' :
                        response.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-secondary text-muted-foreground'
                      )}>
                        {response.status?.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground">{response.draftedBy?.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{response.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Items from Analysis */}
          {analysis?.actionItems?.length > 0 && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="font-heading font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  Action Items
                </h3>
              </div>
              <ul className="divide-y divide-border">
                {analysis.actionItems.map((item, i) => (
                  <li key={i} className="p-4">
                    <p className="text-sm font-medium">{item.task}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">{item.assignmentSuggestion}</span>
                      <span className="text-xs text-muted-foreground">{item.estimatedEffort}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
