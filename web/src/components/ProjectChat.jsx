import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';

export default function ProjectChat({ projectId }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
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
        queryClient.invalidateQueries(['chat', projectId]);
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (content) => api.sendChatMessage(projectId, { content }),
    onSuccess: () => {
      setMessage('');
    }
  });

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
    queryClient.invalidateQueries(['chat', projectId]);
  };

  // Format time
  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, msg) => {
    const date = new Date(msg.createdAt).toLocaleDateString();
    if (!groups[date]) groups[date] = [];
    groups[date].push(msg);
    return groups;
  }, {});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[500px] bg-white rounded-lg border">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date}>
            <div className="flex items-center justify-center my-4">
              <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {date === new Date().toLocaleDateString() ? 'Today' : date}
              </span>
            </div>
            {msgs.map((msg) => (
              <div
                key={msg.id}
                className={`flex mb-3 ${msg.authorId === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[70%] ${msg.authorId === user?.id ? 'order-2' : ''}`}>
                  {msg.authorId !== user?.id && (
                    <span className="text-xs text-gray-500 ml-1">{msg.author?.name}</span>
                  )}
                  <div
                    className={`rounded-lg px-4 py-2 ${
                      msg.authorId === user?.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${msg.authorId === user?.id ? 'text-blue-200' : 'text-gray-400'}`}>
                        {formatTime(msg.createdAt)}
                        {msg.isEdited && ' (edited)'}
                      </span>
                    </div>
                  </div>
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
                  <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
      </form>
    </div>
  );
}
