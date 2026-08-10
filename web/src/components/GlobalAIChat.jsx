import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, X, Send, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { api } from '../lib/api';
import { preferredScrollBehavior } from '../lib/motion';

function formatTimeAgo(date) {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GlobalAIChat() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const drawerRef = useRef(null);

  const storageKey = user ? `ash-chat-history-${user.id}` : null;

  // Load history from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, [storageKey]);

  // Save history to localStorage
  useEffect(() => {
    if (!storageKey || messages.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {}
  }, [messages, storageKey]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages, isTyping]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handler = (e) => {
      if (isOpen && drawerRef.current && !drawerRef.current.contains(e.target) && !e.target.closest('[data-ai-chat-btn]')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  async function handleSend() {
    if (!input.trim() || isLoading) return;
    if (!user) return;

    const userMessage = { role: 'user', content: input.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsTyping(true);

    try {
      const data = await api.aiQuery(userMessage.content).catch(() => ({
        results: [],
      }));

      // Convert query results into a readable response
      const assistantContent = data.results?.length
        ? data.results.map(r => `**${r.name}** (${r.type}) — ${r.description}`).join('\n')
        : 'No results found for that query.';

      const assistantMessage = {
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I ran into an issue. Please try again.',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!user) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        data-ai-chat-btn
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-controls="global-ai-chat-drawer"
        className="fixed bottom-6 right-6 z-50 min-h-14 min-w-14 w-14 h-14 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 motion-reduce:transition-none flex items-center justify-center group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Open AI Chat"
      >
        <Bot className="w-6 h-6 group-hover:scale-110 transition-transform" />
        {isLoading && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent animate-pulse" />
        )}
      </button>

      {/* Drawer */}
      {isOpen && (
        <div
          id="global-ai-chat-drawer"
          ref={drawerRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="global-ai-chat-title"
          className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-[400px] max-h-[560px] rounded-xl shadow-2xl bg-card border border-border flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <h3 id="global-ai-chat-title" className="font-semibold text-foreground">Ask Ash</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-muted transition-colors motion-reduce:transition-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Ask me anything about your projects, clients, or tasks.</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex flex-col',
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted border border-border rounded-bl-md'
                    )}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 px-1">
                    {formatTimeAgo(msg.timestamp)}
                  </span>
                </div>
              ))
            )}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex items-start">
                <div role="status" aria-label="Ash is typing" className="bg-muted border border-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border bg-card shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                id="global-ai-chat-input"
                aria-label="Ask Ash about your work"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your projects..."
                rows={1}
                className="flex-1 min-h-11 px-4 py-2.5 border border-input rounded-xl bg-background text-sm text-foreground placeholder:text-muted-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary transition-colors motion-reduce:transition-none"
                style={{ maxHeight: '120px' }}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                aria-busy={isLoading}
                className={cn(
                  'min-h-11 min-w-11 rounded-xl flex items-center justify-center shrink-0 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  input.trim() && !isLoading
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
