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
  Shield,
  Reply,
  ExternalLink,
  Loader2,
  Mail,
  Copy,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';
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
import Modal, { ModalFooter } from '../components/Modal';

// What saving a response does today: it is stored on the conversation for
// the team and is not sent or routed to anyone (sending is Reply via Gmail).
export const DRAFT_HINT = 'Saved drafts stay on this conversation. Nothing is sent to the client; use Reply via Gmail to send.';

const RESPONSE_STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Returned',
  SENT: 'Sent',
};

export function responseStatusLabel(status) {
  return RESPONSE_STATUS_LABELS[status] || String(status || '').replace(/_/g, ' ');
}

// AI analysis suggests a role, never a person: show it as a role.
const ASSIGNMENT_SUGGESTION_LABELS = {
  dev: 'Development',
  design: 'Design',
  account_lead: 'Account lead',
  anyone: 'Anyone',
};

export function assignmentSuggestionLabel(value) {
  return ASSIGNMENT_SUGGESTION_LABELS[value] || String(value || '').replace(/_/g, ' ');
}

/**
 * The /gmail/send body. Gmail ids are sent only when the conversation came
 * from Gmail: a hub-only conversation starts a new Gmail thread.
 */
export function buildGmailSendPayload({ to, subject, body, meta, hubThreadId }) {
  const payload = { to, subject, body, hubThreadId };
  if (meta?.gmailThreadId) payload.threadId = meta.gmailThreadId;
  if (meta?.lastMessageId) payload.in_reply_to = meta.lastMessageId;
  return payload;
}

/** The one line under the Gmail reply that says where it sends from. */
export function gmailConnectionLine({ checking, failed, status }) {
  if (checking) return 'Checking the Gmail connection…';
  if (status && !status.connected) return 'Copy the reply and send it from your own email.';
  if (status?.email) return `Sends from ${status.email}.`;
  if (failed) return "The Gmail connection couldn't be checked, so sending may fail.";
  return 'Sends through the connected Gmail mailbox.';
}

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
  const [gmailDraftNotice, setGmailDraftNotice] = useState('');
  const [gmailCopied, setGmailCopied] = useState(false);

  const {
    data: thread,
    isLoading,
    isError: threadError,
    error: threadRequestError,
    refetch: refetchThread,
    isFetching: threadFetching,
  } = useQuery({
    queryKey: ['thread', id],
    queryFn: () => api.getThread(id),
  });

  // Only checked while the Gmail reply is open: whether this workspace has a
  // connected mailbox, so the modal never promises a send it cannot make.
  const gmailStatusQuery = useQuery({
    queryKey: ['gmail-status'],
    queryFn: () => api.getGmailStatus(),
    enabled: showGmailReply,
    staleTime: 60_000,
    retry: false,
  });
  const gmailStatus = gmailStatusQuery.data;
  const gmailNotConnected = gmailStatus ? !gmailStatus.connected : false;

  const draftMutation = useMutation({
    mutationFn: () => api.draftResponse(id),
    onSuccess: (data) => {
      setResponseText(data.options?.[0]?.body || '');
      // The AI draft is also saved on the conversation as a draft.
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
    },
  });

  // Saves the text as a draft on this conversation. Nothing is sent.
  const saveDraftMutation = useMutation({
    mutationFn: (body) => api.createResponse(id, { subject: `Re: ${thread.subject}`, body, tone: 'professional' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      setResponseText('');
      toast.success('Draft saved', 'It is listed under Saved drafts. Nothing was sent to the client.');
    },
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
      gmailSendMutation.reset();
      setGmailReplyText(data.draft || '');
      setGmailReplySubject(data.subject || `Re: ${thread?.subject}`);
      setGmailReplyTo(data.to || '');
      setGmailDraftMeta({ gmailThreadId: data.gmailThreadId, lastMessageId: data.lastMessageId });
      setGmailDraftNotice(data.notice?.message || '');
      setGmailCopied(false);
      setShowGmailReply(true);
    },
  });

  const gmailSendMutation = useMutation({
    mutationFn: () => api.gmailSend(buildGmailSendPayload({
      to: gmailReplyTo,
      subject: gmailReplySubject,
      body: gmailReplyText,
      meta: gmailDraftMeta,
      hubThreadId: id,
    })),
    onSuccess: () => {
      setShowGmailReply(false);
      setGmailReplyText('');
      setGmailReplyTo('');
      setGmailReplySubject('');
      setGmailDraftMeta(null);
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      toast.success('Reply sent via Gmail');
    },
  });

  const copyGmailReply = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${gmailReplySubject}\n\n${gmailReplyText}`);
      setGmailCopied(true);
    } catch {
      toast.error('Could not copy', 'Select the message text and copy it yourself.');
    }
  };

  const closeGmailReply = () => {
    if (gmailSendMutation.isPending) return;
    gmailSendMutation.reset();
    setShowGmailReply(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingState label="Loading conversation…" compact />
      </div>
    );
  }

  if (threadError) {
    return (
      <QueryErrorState
        error={threadRequestError}
        message="Conversation could not be loaded"
        onRetry={refetchThread}
        isRetrying={threadFetching}
      />
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
      {/* Stacks on phones: title first, then badges and actions on their own row. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4" data-testid="thread-header">
        <div className="flex min-w-0 flex-1 items-start gap-2 md:gap-4">
        <Link to="/inbox" aria-label="Back to inbox" className="inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0 pt-2">
          <h1 className="text-xl font-heading font-bold text-foreground break-words">{thread.subject}</h1>
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
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0 md:justify-end">
          <span className={cn('px-2.5 py-1 text-sm font-medium rounded-lg', getPriorityColor(thread.priority))}>
            {thread.priority}
          </span>
          <span className={cn('px-2.5 py-1 text-sm font-medium rounded-lg', getStatusColor(thread.status))}>
            {thread.status.replace(/_/g, ' ')}
          </span>
          {thread.status !== 'RESOLVED' && (
            <>
              <button
                type="button"
                onClick={() => gmailDraftMutation.mutate()}
                disabled={gmailDraftMutation.isPending}
                className="min-h-11 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center gap-1.5 transition-all hover-lift disabled:opacity-60"
              >
                {gmailDraftMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Reply className="w-4 h-4" />
                )}
                {gmailDraftMutation.isPending ? 'Drafting...' : 'Reply via Gmail'}
              </button>
              <button
                type="button"
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                className="min-h-11 px-3 py-1.5 text-sm bg-success text-success-foreground rounded-lg hover:opacity-90 flex items-center gap-1.5 transition-all hover-lift"
              >
                <CheckCircle className="w-4 h-4" />
                Resolve
              </button>
            </>
          )}
        </div>
      </div>

      {gmailDraftMutation.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {gmailDraftMutation.error.message || 'The Gmail draft could not be prepared. Try again without leaving this conversation.'}
        </p>
      )}

      {/* Gmail Reply Modal */}
      <Modal isOpen={showGmailReply} onClose={closeGmailReply} title="Reply via Gmail" size="lg" showCloseButton={!gmailSendMutation.isPending}>
        <form onSubmit={(event) => { event.preventDefault(); gmailSendMutation.mutate(); }} className="space-y-4">
              {gmailNotConnected && (
                <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  <p className="font-medium">Gmail isn&apos;t connected</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {gmailStatus?.error || "This workspace has no connected Gmail mailbox, so this reply can't be sent from here."}
                  </p>
                </div>
              )}
              {gmailDraftNotice && (
                <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  {gmailDraftNotice}
                </p>
              )}
              <div>
                <label htmlFor="gmail-reply-to" className="block text-sm font-medium mb-1.5">To</label>
                <input
                  id="gmail-reply-to"
                  type="email"
                  value={gmailReplyTo}
                  onChange={(e) => setGmailReplyTo(e.target.value)}
                  disabled={gmailSendMutation.isPending}
                  className="w-full px-3 py-2 border border-border bg-background rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/20"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label htmlFor="gmail-reply-subject" className="block text-sm font-medium mb-1.5">Subject</label>
                <input
                  id="gmail-reply-subject"
                  type="text"
                  value={gmailReplySubject}
                  onChange={(e) => setGmailReplySubject(e.target.value)}
                  disabled={gmailSendMutation.isPending}
                  className="w-full px-3 py-2 border border-border bg-background rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/20"
                  required
                />
              </div>
              <div>
                <label htmlFor="gmail-reply-message" className="block text-sm font-medium mb-1.5">Message</label>
                <textarea
                  id="gmail-reply-message"
                  value={gmailReplyText}
                  onChange={(e) => setGmailReplyText(e.target.value)}
                  rows={10}
                  disabled={gmailSendMutation.isPending}
                  className="w-full px-3 py-2 border border-border bg-background rounded-lg text-base resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono leading-relaxed"
                  required
                />
              </div>
              {gmailSendMutation.error && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {gmailSendMutation.error.message || 'Email could not be sent.'} Your draft is still available.
                </p>
              )}
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {gmailConnectionLine({
              checking: gmailStatusQuery.isLoading,
              failed: gmailStatusQuery.isError,
              status: gmailStatus,
            })}
          </div>
          <ModalFooter>
            <button type="button" onClick={closeGmailReply} disabled={gmailSendMutation.isPending} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancel</button>
            {gmailNotConnected && (
              <button type="button" onClick={copyGmailReply} disabled={!gmailReplyText.trim()} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                <Copy className="w-4 h-4" aria-hidden="true" />
                {gmailCopied ? 'Copied' : 'Copy reply'}
              </button>
            )}
            <button type="submit" disabled={gmailNotConnected || gmailStatusQuery.isLoading || !gmailReplyText.trim() || !gmailReplyTo.trim() || !gmailReplySubject.trim() || gmailSendMutation.isPending} className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {gmailSendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
              {gmailSendMutation.isPending ? 'Sending…' : 'Send email'}
            </button>
          </ModalFooter>
        </form>
      </Modal>

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
                  <div key={message.id} className={cn('p-5', message.direction === 'OUTBOUND' && 'bg-primary/[0.02]', isUpwork && 'border-l-4 border-l-success bg-success/[0.02]')}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold',
                        message.direction === 'INBOUND' ? 'bg-secondary text-foreground' : 'bg-primary text-primary-foreground',
                        isUpwork && 'bg-success/10 text-success'
                      )}>
                        {isUpwork ? '🏢' : (message.senderName?.[0]?.toUpperCase() || 'U')}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{message.senderName || message.senderEmail}</span>
                          {isUpwork && (
                            <span className="text-xs bg-success/10 text-success px-1.5 py-0.5 rounded font-medium">Upwork</span>
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
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-success text-success-foreground rounded-lg hover:bg-success/90 transition-colors flex-shrink-0"
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
                  <span className="text-xs bg-warning/10 text-warning px-1.5 py-0.5 rounded">Team only</span>
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
                  type="button"
                  onClick={() => draftMutation.mutate()}
                  disabled={draftMutation.isPending}
                  className="text-sm text-primary dark:text-accent hover:opacity-80 flex items-center gap-1.5 font-medium transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Sparkles className={cn('w-4 h-4', draftMutation.isPending && 'animate-pulse')} />
                  {draftMutation.isPending ? 'Generating...' : 'AI Draft'}
                </button>
              </div>
              <div className="p-5">
                {draftMutation.error && (
                  <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {draftMutation.error.message || 'The AI draft could not be written.'} You can still write the response yourself.
                  </p>
                )}
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  rows={6}
                  aria-label="Response"
                  className="w-full p-3 border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm leading-relaxed"
                  placeholder="Write your response..."
                />
                {saveDraftMutation.error && (
                  <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {saveDraftMutation.error.message || 'The draft could not be saved.'} Your text is still here; try again.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    {DRAFT_HINT}
                  </p>
                  <button
                    type="button"
                    onClick={() => saveDraftMutation.mutate(responseText)}
                    disabled={!responseText.trim() || saveDraftMutation.isPending}
                    className="min-h-11 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm font-medium transition-all hover-lift"
                  >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    {saveDraftMutation.isPending ? 'Saving…' : 'Save draft'}
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
                aria-label="Internal note"
                className="w-full p-3 border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
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
                <h3 className="font-heading font-semibold">Saved drafts</h3>
              </div>
              <ul className="divide-y divide-border">
                {thread.responses.map((response) => (
                  <li key={response.id} className="p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-medium rounded',
                        response.status === 'APPROVED' ? 'bg-success/10 text-success' :
                        response.status === 'PENDING_APPROVAL' ? 'bg-warning/10 text-warning' :
                        response.status === 'REJECTED' ? 'bg-destructive/10 text-destructive' :
                        'bg-secondary text-muted-foreground'
                      )}>
                        {responseStatusLabel(response.status)}
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
                      <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">{assignmentSuggestionLabel(item.assignmentSuggestion)}</span>
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
