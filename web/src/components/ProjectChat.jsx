import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';
import { preferredScrollBehavior } from '../lib/motion';
import LoadingState from './ui/LoadingState';
import { Edit2, Trash2 } from 'lucide-react';

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
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [attachment, setAttachment] = useState(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Fetch messages
  const { data: messages = [], isLoading } = useQuery({
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
        queryClient.setQueryData(['chat', projectId], (old = []) => [...old, newMessage]);
      });

      // Listen for edits
      socket.on('chat:edited', (editedMessage) => {
        queryClient.setQueryData(['chat', projectId], (old = []) =>
          old.map(m => m.id === editedMessage.id ? editedMessage : m)
        );
      });

      // Listen for deletions
      socket.on('chat:deleted', ({ messageId }) => {
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
    messagesEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content) => {
      const created = await api.sendChatMessage(projectId, { content });
      if (attachment) {
        await api.uploadAttachment(attachment, 'CHAT', created.id);
        await queryClient.invalidateQueries({ queryKey: ['chat-attachments', created.id] });
      }
      return created;
    },
    onSuccess: () => {
      setMessage('');
      setAttachment(null);
      setSendError('');
    },
    onError: () => {
      setSendError('Message not sent. Try again.');
    }
  });
  const editMutation = useMutation({ mutationFn: ({ id, content }) => api.editChatMessage(projectId, id, content), onSuccess: () => { setEditingId(null); queryClient.invalidateQueries({ queryKey: ['chat', projectId] }); } });
  const deleteMutation = useMutation({ mutationFn: (id) => api.deleteChatMessage(projectId, id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', projectId] }) });

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
    return <LoadingState label="Loading messages…" compact className="h-64 text-gray-600" spinnerClassName="border-blue-200 border-t-blue-600" />;
  }

  return (
    <div className="flex flex-col h-[500px] bg-white rounded-lg border">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date}>
            <div className="flex items-center justify-center my-4">
              <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {date === new Date().toLocaleDateString('en-CA') ? 'Today' : date}
              </span>
            </div>
            {msgs.map((msg) => (
              <div
                key={msg.id}
                className={`flex mb-3 group ${msg.authorId === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[70%] ${msg.authorId === user?.id ? 'order-2' : ''}`}>
                  {msg.authorId !== user?.id && (
                    <span className="text-xs text-gray-500 ml-1">{msg.author?.name || msg.externalAuthorName || 'Unknown sender'}</span>
                  )}
                  <div
                    className={`rounded-lg px-4 py-2 ${
                      msg.authorId === user?.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {editingId === msg.id ? <form onSubmit={(event) => { event.preventDefault(); if (editingContent.trim()) editMutation.mutate({ id: msg.id, content: editingContent.trim() }); }}><input autoFocus value={editingContent} onChange={(event) => setEditingContent(event.target.value)} className="w-full rounded px-2 py-1 text-gray-900" /><div className="mt-2 flex gap-2"><button type="submit" className="text-xs underline">Save</button><button type="button" onClick={() => setEditingId(null)} className="text-xs underline">Cancel</button></div></form> : <p className="whitespace-pre-wrap">{msg.content}</p>}
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${msg.authorId === user?.id ? 'text-blue-200' : 'text-gray-400'}`}>
                        {formatTime(msg.createdAt)}
                        {msg.isEdited && ' (edited)'}
                      </span>
                    </div>
                  </div>
                  <ChatAttachments messageId={msg.id} />
                  {msg.authorId === user?.id && editingId !== msg.id && <div className="mt-1 flex justify-end gap-1"><button type="button" onClick={() => { setEditingId(msg.id); setEditingContent(msg.content); }} aria-label="Edit your message" className="min-h-11 min-w-11 p-2 text-gray-500 hover:text-blue-600"><Edit2 className="w-3.5 h-3.5" /></button><button type="button" onClick={() => window.confirm('Delete this message?') && deleteMutation.mutate(msg.id)} aria-label="Delete your message" className="min-h-11 min-w-11 p-2 text-gray-500 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></div>}
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
                          className="text-xs bg-gray-100 hover:bg-gray-200 rounded px-1.5 py-0.5"
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
                        className="text-xs hover:bg-gray-100 rounded p-1"
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
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No messages yet. Start the conversation!
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-gray-500">
          Someone is typing...
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="border-t p-3">
        <div className="flex gap-2">
          <input type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} aria-label="Attach a file to this message" className="max-w-32 text-xs" />
          <input
            type="text"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              handleTyping();
            }}
            placeholder="Type a message... (use @name to mention)"
            className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!message.trim() || sendMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendMutation.isPending ? '...' : 'Send'}
          </button>
        </div>
        {attachment && <p className="mt-1 text-xs text-gray-500">Attaching {attachment.name}</p>}
        {sendError && <div role="alert" className="mt-2 flex items-center justify-between gap-2 text-sm text-red-600"><span>{sendError}</span><button type="button" onClick={() => sendMutation.mutate(message.trim())} disabled={!message.trim() || sendMutation.isPending} className="underline">Try again</button></div>}
      </form>
    </div>
  );
}
