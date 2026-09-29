import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';
import { preferredScrollBehavior } from '../lib/motion';
import ConfirmDialog from './ConfirmDialog';
import LoadingState from './ui/LoadingState';
import QueryErrorState from './QueryErrorState';
import { Edit2, Trash2, Lock, Eye, Paperclip } from 'lucide-react';

// Chat visibility (docs/product-status.md): INTERNAL messages are staff-only;
// CLIENT messages are also shown to the client in their portal.
export function VisibilityBadge({ visibility }) {
  if (visibility === 'CLIENT') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" title="The client can read this message in their portal">
        <Eye className="h-3 w-3" aria-hidden="true" /> Visible to client
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground" title="Only your team can read this message">
      <Lock className="h-3 w-3" aria-hidden="true" /> Internal
    </span>
  );
}

function ChatAttachments({ messageId }) {
  const { data: attachments = [] } = useQuery({ queryKey: ['chat-attachments', messageId], queryFn: () => api.getAttachments('CHAT', messageId), staleTime: 30000 });
  if (!attachments.length) return null;
  return <ul className="mt-2 space-y-1">{attachments.map((file) => <li key={file.id}><a href={`/api/attachments/uploads/${encodeURIComponent(file.filename)}`} target="_blank" rel="noreferrer" className="text-xs underline">{file.originalName}</a></li>)}</ul>;
}

export default function ProjectChat({ projectId }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState('');
  const [attachmentRetry, setAttachmentRetry] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [visibility, setVisibility] = useState('INTERNAL');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  // Fetch messages
  const {
    data: messages = [],
    isLoading,
    isError: messagesError,
    error: messagesRequestError,
    refetch: refetchMessages,
    isFetching: messagesFetching,
  } = useQuery({
    queryKey: ['chat', projectId],
    queryFn: () => api.getChatMessages(projectId),
    refetchInterval: 30000
  });

  // Join project room on mount
  useEffect(() => {
    if (socket && projectId) {
      socket.emit('join-project', projectId);

      // Listen for new messages
      socket.on('chat:message', (newMessage) => {
        // Replies are nested under their parent: refetch the thread instead.
        if (newMessage.parentId) {
          queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
          return;
        }
        queryClient.setQueryData(['chat', projectId], (old = []) =>
          old.some((m) => m.id === newMessage.id) ? old : [...old, newMessage]
        );
      });

      // Listen for edits
      socket.on('chat:edited', (editedMessage) => {
        queryClient.setQueryData(['chat', projectId], (old = []) =>
          old.map(m => m.id === editedMessage.id ? editedMessage : m)
        );
      });

      // Listen for deletions
      socket.on('chat:deleted', ({ messageId, tombstoned }) => {
        if (tombstoned) {
          queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
          return;
        }
        queryClient.setQueryData(['chat', projectId], (old = []) =>
          old.filter(m => m.id !== messageId)
        );
      });

      // Listen for reactions
      socket.on('chat:reaction', ({ messageId, action, reaction, emoji, userId }) => {
        queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
      });

      // Listen for typing indicators
      socket.on('user-typing', ({ userId, isTyping }) => {
        setTypingUsers(prev => {
          if (isTyping) {
            return prev.includes(userId) ? prev : [...prev, userId];
          }
          return prev.filter(id => id !== userId);
        });
      });

      return () => {
        socket.emit('leave-project', projectId);
        socket.off('chat:message');
        socket.off('chat:edited');
        socket.off('chat:deleted');
        socket.off('chat:reaction');
        socket.off('user-typing');
      };
    }
  }, [socket, projectId, queryClient]);

  // Scroll to bottom on new messages
  useEffect(() => {
    // Scroll only the message list — scrollIntoView would also scroll the page.
    const list = messagesEndRef.current?.parentElement;
    list?.scrollTo?.({ top: list.scrollHeight, behavior: preferredScrollBehavior() });
  }, [messages]);

  const uploadMutation = useMutation({
    mutationFn: ({ attachment: retryAttachment, messageId }) => api.uploadAttachment(retryAttachment, 'CHAT', messageId),
    onSuccess: async (_, { messageId }) => {
      await queryClient.invalidateQueries({ queryKey: ['chat-attachments', messageId] });
      setAttachment(null);
      setAttachmentRetry(null);
      setSendError('');
    },
    onError: (_, retry) => {
      setAttachmentRetry(retry);
      setSendError('Message sent, but its attachment was not uploaded. Try again.');
    },
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (content) => api.sendChatMessage(projectId, { content, visibility }),
    onSuccess: (created) => {
      setMessage('');
      setSendError('');
      // Back to the safe default after each client-visible message, so the
      // next message is internal unless staff choose otherwise again.
      setVisibility('INTERNAL');
      if (attachment) uploadMutation.mutate({ attachment, messageId: created.id });
      else setAttachment(null);
    },
    onError: () => {
      setSendError('Message not sent. Try again.');
    }
  });
  const editMutation = useMutation({ mutationFn: ({ id, content }) => api.editChatMessage(projectId, id, content), onSuccess: () => { setEditingId(null); queryClient.invalidateQueries({ queryKey: ['chat', projectId] }); } });
  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteChatMessage(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
      setMessageToDelete(null);
    },
  });

  const requestMessageDeletion = (chatMessage) => {
    if (deleteMutation.isPending) return;
    deleteMutation.reset();
    setMessageToDelete(chatMessage);
  };

  const cancelMessageDeletion = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.reset();
    setMessageToDelete(null);
  };

  // Handle typing indicator
  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      socket?.emit('typing', { projectId, isTyping: true });
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket?.emit('typing', { projectId, isTyping: false });
    }, 2000);
  };

  // Send message
  const handleSend = (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    sendMutation.mutate(message.trim());
    setSendError('');
    setIsTyping(false);
    socket?.emit('typing', { projectId, isTyping: false });
  };

  // Add reaction
  const handleReaction = async (messageId, emoji) => {
    try {
      await api.addChatReaction(projectId, messageId, emoji);
    } catch (err) {
      // May already exist, try to remove
      await api.removeChatReaction(projectId, messageId, emoji);
    }
    queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
  };

  // Format time
  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, msg) => {
    const date = new Date(msg.createdAt).toLocaleDateString('en-CA');
    if (!groups[date]) groups[date] = [];
    groups[date].push(msg);
    return groups;
  }, {});

  if (isLoading) {
    return <LoadingState label="Loading messages…" compact className="h-64 text-muted-foreground" spinnerClassName="border-primary/20 border-t-primary" />;
  }

  return (
    <div className="flex flex-col h-[500px] bg-card text-card-foreground rounded-lg border border-border">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messagesError && (
          <QueryErrorState
            error={messagesRequestError}
            message="Project conversation could not be loaded"
            onRetry={refetchMessages}
            isRetrying={messagesFetching}
          />
        )}
        {Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date}>
            <div className="flex items-center justify-center my-4">
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                {date === new Date().toLocaleDateString('en-CA') ? 'Today' : date}
              </span>
            </div>
            {msgs.map((msg) => (
              <div
                key={msg.id}
                className={`flex mb-3 group ${msg.authorId === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[70%] ${msg.authorId === user?.id ? 'order-2' : ''}`}>
                  <div className={`flex items-center gap-2 mb-0.5 ${msg.authorId === user?.id ? 'justify-end' : ''}`}>
                    {msg.authorId !== user?.id && (
                      <span className="text-xs text-muted-foreground ml-1">{msg.author?.name || msg.externalAuthorName || 'Unknown sender'}</span>
                    )}
                    <VisibilityBadge visibility={msg.visibility} />
                  </div>
                  <div
                    className={`rounded-lg px-4 py-2 ${
                      msg.authorId === user?.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {msg.removedAt ? <p className="italic opacity-80">Message deleted</p> : editingId === msg.id ? <form onSubmit={(event) => { event.preventDefault(); if (editingContent.trim()) editMutation.mutate({ id: msg.id, content: editingContent.trim() }); }}><input autoFocus value={editingContent} onChange={(event) => setEditingContent(event.target.value)} className="w-full rounded px-2 py-1 bg-background text-foreground" /><div className="mt-2 flex gap-2"><button type="submit" className="text-xs underline">Save</button><button type="button" onClick={() => setEditingId(null)} className="text-xs underline">Cancel</button></div></form> : <p className="whitespace-pre-wrap">{msg.content}</p>}
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${msg.authorId === user?.id ? 'text-blue-50' : 'text-muted-foreground'}`}>
                        {formatTime(msg.createdAt)}
                        {msg.isEdited && ' (edited)'}
                      </span>
                    </div>
                  </div>
                  {!msg.removedAt && <ChatAttachments messageId={msg.id} />}
                  {msg.replies?.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-border pl-3" aria-label="Replies">
                      {msg.replies.map((replyMessage) => (
                        <li key={replyMessage.id} className="text-sm text-foreground">
                          <span className="text-xs text-muted-foreground">{replyMessage.author?.name || replyMessage.externalAuthorName || 'Unknown sender'}: </span>
                          {replyMessage.removedAt ? <em>Message deleted</em> : replyMessage.content}
                        </li>
                      ))}
                    </ul>
                  )}
                  {msg.authorId === user?.id && !msg.removedAt && editingId !== msg.id && <div className="mt-1 flex justify-end gap-1"><button type="button" onClick={() => { setEditingId(msg.id); setEditingContent(msg.content); }} aria-label="Edit your message" className="min-h-11 min-w-11 p-2 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button><button type="button" onClick={() => requestMessageDeletion(msg)} disabled={deleteMutation.isPending} aria-label="Delete your message" className="min-h-11 min-w-11 p-2 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button></div>}
                  {/* Reactions */}
                  {msg.reactions?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(
                        msg.reactions.reduce((acc, r) => {
                          acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                          return acc;
                        }, {})
                      ).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(msg.id, emoji)}
                          className="text-xs bg-muted hover:bg-muted/70 rounded px-1.5 py-0.5"
                        >
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Quick reactions */}
                  <div className="flex gap-1 mt-1">
                    {['👍', '❤️', '😊', '🎉'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(msg.id, emoji)}
                        className="text-xs hover:bg-muted rounded p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {!messagesError && messages.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            No messages yet. Start the conversation!
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-muted-foreground">
          Someone is typing...
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className={`border-t border-border p-3 ${visibility === 'CLIENT' ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
        <fieldset className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <legend className="sr-only">Who can read this message</legend>
          <label className={`inline-flex min-h-11 cursor-pointer items-center gap-1 rounded border px-2 ${visibility === 'INTERNAL' ? 'border-foreground/60 bg-muted font-semibold' : 'border-border'}`}>
            <input type="radio" name={`chat-visibility-${projectId}`} value="INTERNAL" checked={visibility === 'INTERNAL'} onChange={() => setVisibility('INTERNAL')} />
            <Lock className="h-3 w-3" aria-hidden="true" /> Internal (team only)
          </label>
          <label className={`inline-flex min-h-11 cursor-pointer items-center gap-1 rounded border px-2 ${visibility === 'CLIENT' ? 'border-amber-700 bg-amber-100 font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'border-border'}`}>
            <input type="radio" name={`chat-visibility-${projectId}`} value="CLIENT" checked={visibility === 'CLIENT'} onChange={() => setVisibility('CLIENT')} />
            <Eye className="h-3 w-3" aria-hidden="true" /> Visible to client
          </label>
          {visibility === 'CLIENT' && <span role="status" className="text-amber-900 dark:text-amber-200">The client will see this message in their portal.</span>}
        </fieldset>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file to this message"
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">Attach</span>
          </button>
          <input ref={fileInputRef} type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} tabIndex={-1} aria-hidden="true" className="hidden" />
          <input
            type="text"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              handleTyping();
            }}
            placeholder={visibility === 'CLIENT' ? 'Message the client...' : 'Message your team... (use @name to mention)'}
            aria-label={visibility === 'CLIENT' ? 'Message visible to the client' : 'Internal message to your team'}
            className="min-w-0 flex-1 border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!message.trim() || sendMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendMutation.isPending ? '...' : 'Send'}
          </button>
        </div>
        {attachment && <p className="mt-1 text-xs text-muted-foreground">Attaching {attachment.name}</p>}
        {sendError && <div role="alert" className="mt-2 flex items-center justify-between gap-2 text-sm text-destructive"><span>{sendError}</span><button type="button" onClick={() => attachmentRetry ? uploadMutation.mutate(attachmentRetry) : sendMutation.mutate(message.trim())} disabled={sendMutation.isPending || uploadMutation.isPending || (!attachmentRetry && !message.trim())} className="underline">Try again</button></div>}
      </form>
      <ConfirmDialog
        isOpen={Boolean(messageToDelete)}
        title="Permanently delete this message?"
        description={messageToDelete ? `\u201c${messageToDelete.content}\u201d This permanently removes the message from the project conversation and cannot be undone.` : ''}
        confirmLabel="Delete message permanently"
        onConfirm={() => messageToDelete && deleteMutation.mutate(messageToDelete.id)}
        onCancel={cancelMessageDeletion}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
    </div>
  );
}
