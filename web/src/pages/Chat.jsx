import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, MessageSquare, Plus, Trash2, Loader2, Bot, User } from 'lucide-react';
import { api } from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || '';
const ashApi = {
  get: (path) => fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' } }).then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || 'Request failed')))),
  post: (path, body) => fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || 'Request failed')))),
  delete: (path) => fetch(`${API_BASE}${path}`, { method: 'DELETE', credentials: 'include' }).then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || 'Request failed'))))
};
import { cn } from '../lib/utils';

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(conversations) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of conversations) {
    const d = new Date(c.updatedAt);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) groups.Today.push(c);
    else if (d.getTime() === yesterday.getTime()) groups.Yesterday.push(c);
    else groups.Earlier.push(c);
  }
  return groups;
}

// Simple markdown renderer
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\n/g, '<br/>');
}

export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages, isThinking]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await ashApi.get('/api/ash-chat/conversations');
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations', e);
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadMessages = async (id) => {
    try {
      const data = await ashApi.get(`/api/ash-chat/conversations/${id}/messages`);
      setMessages(data.messages);
      setActiveId(id);
    } catch (e) {
      console.error('Failed to load messages', e);
    }
  };

  const handleNewChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    await ashApi.delete(`/api/ash-chat/conversations/${id}`);
    if (activeId === id) handleNewChat();
    setConversations(prev => prev.filter(c => c.id !== id));
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const tempUserMsg = { id: 'tmp-user', role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, tempUserMsg]);
    setInput('');
    setIsThinking(true);

    try {
      const result = await ashApi.post('/api/ash-chat/message', {
        message: text,
        ...(activeId ? { conversationId: activeId } : {})
      });

      const aiMsg = { id: result.messageId, role: 'assistant', content: result.response, createdAt: new Date().toISOString() };
      setMessages(prev => [...prev.filter(m => m.id !== 'tmp-user'), tempUserMsg, aiMsg]);
      setActiveId(result.conversationId);
      loadConversations();
    } catch (err) {
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(), role: 'assistant', content: `Error: ${err.message}`, createdAt: new Date().toISOString(), isError: true
      }]);
    } finally {
      setIsThinking(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const grouped = groupByDate(conversations);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm text-foreground">Chat with Ash</span>
          </div>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="New chat"
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {loadingConvs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No conversations yet</p>
          ) : (
            Object.entries(grouped).map(([label, convs]) =>
              convs.length > 0 ? (
                <div key={label}>
                  <p className="text-xs font-medium text-muted-foreground px-2 mb-1">{label}</p>
                  <div className="space-y-0.5">
                    {convs.map(c => (
                      <button
                        key={c.id}
                        onClick={() => loadMessages(c.id)}
                        className={cn(
                          'w-full text-left px-2 py-2 rounded-lg group flex items-start gap-2 transition-colors',
                          activeId === c.id
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted text-foreground'
                        )}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-medium truncate">{c.title}</span>
                          <span className="block text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</span>
                        </span>
                        <button
                          onClick={(e) => handleDeleteConversation(e, c.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            )
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center px-6 bg-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Ash</p>
              <p className="text-xs text-muted-foreground">Chief of Staff · Ashbi Design</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && !isThinking && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Hey, I'm Ash</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Chief of Staff at Ashbi Design. Ask me anything about the agency — clients, projects, revenue, tasks.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                {[
                  "What's our current MRR?",
                  "Which clients need attention?",
                  "Summarize active projects",
                  "Any overdue invoices?"
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="text-left text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className={cn(
                'max-w-[70%] rounded-2xl px-4 py-3 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : msg.isError
                  ? 'bg-destructive/10 text-destructive border border-destructive/20 rounded-bl-md'
                  : 'bg-muted text-foreground rounded-bl-md'
              )}>
                {msg.role === 'assistant' && !msg.isError ? (
                  <div
                    className="prose prose-sm max-w-none text-foreground"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className={cn(
                  'text-xs mt-1',
                  msg.role === 'user' ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground'
                )}>
                  {formatTime(msg.createdAt)}
                </p>
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-4 bg-card">
          <div className="flex gap-2 items-end max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Ash..."
              rows={1}
              className={cn(
                'flex-1 resize-none px-4 py-3 text-sm bg-background border border-border rounded-xl',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
                'transition-all duration-200 max-h-32'
              )}
              disabled={isThinking}
              style={{ height: 'auto', minHeight: '44px' }}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className={cn(
                'p-3 rounded-xl transition-all duration-200',
                input.trim() && !isThinking
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              {isThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
